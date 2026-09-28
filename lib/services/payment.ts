import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { grantCredits } from "@/lib/services/credits";
import { buildDuitNowPayload } from "@/lib/services/duitnow";
import { redeemCoupon } from "@/lib/services/coupons";
import type { PaymentDoc, SubscriptionDoc } from "@/lib/domain/types";

/**
 * Credit packages. Each purchase grants the listed credits (1 credit = RM 1,
 * credits never expire) and activates a 30-day subscription — uploads and
 * scanning require an active subscription. Prices in sen.
 */
export const PLANS = {
  starter: { name: "Starter", price: 29900, credits: 1000 },
  professional: { name: "Professional", price: 49900, credits: 5000 },
  enterprise: { name: "Enterprise", price: 99900, credits: 20000 },
} as const;

export type PlanKey = keyof typeof PLANS;

export interface PaymentProvider {
  name: string;
  /** Create a payment session and return a QR payload + provider reference. */
  createPayment(input: { amountSen: number; plan: string; interval: string; userId: string }): Promise<{
    providerRef: string;
    qrPayload: string;
  }>;
  /** Verify a webhook signature and parse the event. */
  verifyWebhook(rawBody: string, signature: string | null): { providerRef: string; status: "paid" | "failed" } | null;
  /** Query the provider for the authoritative payment status (server-side verification). */
  fetchStatus(providerRef: string): Promise<"paid" | "pending" | "failed">;
}

/**
 * Mock Touch 'n Go eWallet provider for development. Implements the real lifecycle
 * (initiate → QR → paid → verify → activate) with HMAC-signed webhooks.
 * Swap in the production TNGD merchant adapter behind this same interface.
 */
const mockTngProvider: PaymentProvider = {
  name: "tng_mock",
  async createPayment({ amountSen, plan, interval, userId }) {
    const env = getEnv();
    const providerRef = `MOCK-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const qrPayload = JSON.stringify({
      wallet: "TNG-eWallet",
      merchant: env.TNG_MERCHANT_ID || "PERSIS-DEV-MERCHANT",
      ref: providerRef,
      amount: (amountSen / 100).toFixed(2),
      currency: "MYR",
      plan,
      interval,
      userId,
    });
    return { providerRef, qrPayload };
  },
  verifyWebhook(rawBody, signature) {
    const secret = getEnv().TNG_WEBHOOK_SECRET;
    if (!secret || !signature) return null;
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    try {
      const evt = JSON.parse(rawBody) as { providerRef: string; status: "paid" | "failed" };
      return { providerRef: evt.providerRef, status: evt.status };
    } catch {
      return null;
    }
  },
  async fetchStatus(providerRef) {
    const db = await getDb();
    const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef });
    if (!payment) return "failed";
    if (payment.status === "verified") return "paid";
    if (payment.status === "paid_pending_verify") return getEnv().TNG_PROVIDER === "mock" || getEnv().TNG_MOCK_AUTO_VERIFY ? "paid" : "pending";
    if (payment.status === "failed" || payment.status === "expired") return "failed";
    return "pending";
  },
};

export function getPaymentProvider(): PaymentProvider {
  // Provider is swappable via TNG_PROVIDER env; only the mock ships by default.
  return mockTngProvider;
}

export async function initiatePayment(userId: ObjectId, plan: PlanKey, interval: "monthly" | "yearly" = "monthly", couponCode?: string) {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date();

  // One pending QR per user: expire any previous unpaid QRs.
  await db.collection<PaymentDoc>("payments").updateMany(
    { userId, status: { $in: ["qr_presented", "initiated"] } },
    { $set: { status: "expired", updatedAt: now } }
  );

  // Coupon (e.g. RM0.10 test purchases) overrides the price entirely.
  // Customers always pay the EXACT listed price — the QR carries the amount
  // (tag 54) and a unique payment reference (tag 62) for reconciliation.
  let baseSen: number = PLANS[plan].price;
  let redeemedCode: string | undefined;
  if (couponCode) {
    const coupon = await redeemCoupon(couponCode); // throws CouponError when invalid
    baseSen = coupon.priceSen;
    redeemedCode = coupon.code;
  }
  const amountSen = baseSen;

  const provider = getPaymentProvider();
  const created = await provider.createPayment({
    amountSen, plan, interval, userId: String(userId),
  });
  // When DuitNow merchant details are configured, present a real dynamic QR
  // with a clean alphanumeric bridge reference (tag 62) for matching.
  let providerRef = created.providerRef;
  const bridgeRef = `PS${crypto.randomBytes(7).toString("hex").toUpperCase()}`;
  const duitnow = buildDuitNowPayload({ amountMyr: (amountSen / 100).toFixed(2), reference: bridgeRef });
  if (duitnow) providerRef = bridgeRef;
  const qrPayload = duitnow ?? created.qrPayload;
  const providerName = duitnow ? "duitnow_bridge" : provider.name;

  const res = await db.collection<PaymentDoc>("payments").insertOne({
    userId, plan, interval, amount: amountSen, currency: "MYR",
    status: "qr_presented", provider: providerName, providerRef, qrPayload,
    baseAmount: baseSen, couponCode: redeemedCode,
    createdAt: now, updatedAt: now,
  } as PaymentDoc);
  await audit({ userId, action: "payment.initiated", entityType: "payment", entityId: res.insertedId, newValue: { plan, interval, amountSen, couponCode: redeemedCode, provider: providerName }, source: "payment" });
  return { paymentId: String(res.insertedId), providerRef, qrPayload, amountSen, provider: providerName, couponCode: redeemedCode };
}

/** Mark a payment as paid by the wallet (called by webhook or dev simulator). */
export async function markPaymentPaid(providerRef: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<PaymentDoc>("payments").updateOne(
    { providerRef, status: { $in: ["qr_presented", "initiated"] } },
    { $set: { status: "paid_pending_verify", updatedAt: new Date() } }
  );
  return res.modifiedCount > 0;
}

/**
 * Activate a payment that has been confirmed by a trusted source
 * (provider fetchStatus, TNG notification bridge match, or admin confirm).
 * Sets verified, activates/extends the subscription and grants credits.
 */
export async function activatePayment(payment: PaymentDoc): Promise<void> {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date();
  await db.collection<PaymentDoc>("payments").updateOne(
    { _id: payment._id, status: { $ne: "verified" } },
    { $set: { status: "verified", verifiedAt: now, updatedAt: now } }
  );

  const periodMs = payment.interval === "yearly" ? 365 : 30;
  const end = new Date(now.getTime() + periodMs * 24 * 60 * 60 * 1000);
  await db.collection<SubscriptionDoc>("subscriptions").updateOne(
    { userId: payment.userId },
    {
      $set: {
        plan: payment.plan as SubscriptionDoc["plan"], interval: payment.interval as SubscriptionDoc["interval"], status: "active",
        currentPeriodStart: now, currentPeriodEnd: end, updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  // Grant the package's credits (never expire; usable while subscribed).
  const planKey = payment.plan as PlanKey;
  const credits = PLANS[planKey]?.credits ?? 0;
  if (credits > 0) {
    await grantCredits(payment.userId, credits, `${PLANS[planKey].name} package — ${credits.toLocaleString()} credits`, payment._id);
  }
  await audit({ userId: payment.userId, action: "payment.verified", entityType: "payment", entityId: payment._id, newValue: { providerRef: payment.providerRef }, source: "payment" });
  await audit({ userId: payment.userId, action: "subscription.activated", entityType: "subscription", entityId: payment.userId, newValue: { plan: payment.plan, interval: payment.interval }, source: "payment" });
}

/** Server-side verification + subscription activation. Never trust the client. */
export async function verifyAndActivate(providerRef: string): Promise<{ verified: boolean; status: string }> {
  await ensureIndexes();
  const db = await getDb();
  const provider = getPaymentProvider();
  const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef });
  if (!payment) return { verified: false, status: "not_found" };
  if (payment.status === "verified") return { verified: true, status: "verified" };

  const remote = await provider.fetchStatus(providerRef);
  if (remote !== "paid") return { verified: false, status: remote };

  await activatePayment(payment);
  return { verified: true, status: "verified" };
}

/**
 * Confirm a payment from a trusted off-band signal (TNG phone notification
 * match or admin manual confirm) and activate it immediately.
 */
export async function confirmAndActivate(providerRef: string): Promise<{ ok: boolean; reason?: string }> {
  await ensureIndexes();
  const db = await getDb();
  const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef });
  if (!payment) return { ok: false, reason: "not_found" };
  if (payment.status === "verified") return { ok: true };
  if (payment.status === "expired" || payment.status === "failed") return { ok: false, reason: payment.status };
  await markPaymentPaid(providerRef);
  await activatePayment({ ...payment, status: "paid_pending_verify" });
  return { ok: true };
}
