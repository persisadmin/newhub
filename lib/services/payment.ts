import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import { grantCredits } from "@/lib/services/credits";
import { buildDuitNowPayload } from "@/lib/services/duitnow";
import { redeemCoupon, discountedPriceSen } from "@/lib/services/coupons";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { HttpError } from "@/lib/api";
import {
  amountMatchesSen,
  callbackAppMatches,
  getPayHalalConfig,
  reconcileTransaction,
  verifyCallbackHash,
  type PayHalalCallback,
} from "@/lib/services/payhalal";
import { PACKAGES, type PackageKey } from "@/lib/packages";
import type { PaymentDoc, SubscriptionDoc } from "@/lib/domain/types";

/**
 * Credit packages — re-exported from lib/packages.ts, the single source of
 * truth shared with the settings page and landing pages. Each purchase grants
 * the listed credits (1 credit = RM 1, credits never expire) and activates a
 * 30-day subscription — uploads and scanning require an active subscription.
 * Prices in sen.
 */
export const PLANS = PACKAGES;

export type PlanKey = PackageKey;

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

/** How the customer pays. DuitNow presents a QR; PayHalal redirects to a hosted page. */
export type CheckoutMethod = "duitnow_qr" | "payhalal";

export async function initiatePayment(
  userId: ObjectId,
  plan: PlanKey,
  interval: "monthly" | "yearly" = "monthly",
  couponCode?: string,
  method: CheckoutMethod = "duitnow_qr"
) {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date();

  // One pending payment per user: expire any previous unpaid attempt.
  await db.collection<PaymentDoc>("payments").updateMany(
    { userId, status: { $in: ["qr_presented", "initiated"] } },
    { $set: { status: "expired", updatedAt: now } }
  );

  // Coupon: percentage discount (or legacy fixed price) off the package price.
  // Customers always pay the exact final amount. The user document also
  // supplies PayHalal's required customer fields.
  const userDoc = await db.collection("users").findOne(
    { _id: userId },
    { projection: { email: 1, name: 1, phone: 1 } }
  );

  let baseSen: number = PLANS[plan].price;
  let redeemedCode: string | undefined;
  if (couponCode) {
    const coupon = await redeemCoupon(couponCode, { plan, email: (userDoc?.email as string) ?? null }); // throws CouponError when invalid
    baseSen = discountedPriceSen(baseSen, coupon);
    redeemedCode = coupon.code;
  }
  const amountSen = baseSen;

  /* ---- PayHalal: hosted redirect checkout (FPX / card / e-wallet) ---- */
  if (method === "payhalal") {
    const cfg = getPayHalalConfig();
    if (!cfg) {
      throw new HttpError(503, "PayHalal is not available right now. Please choose another payment method.", "PAYHALAL_NOT_CONFIGURED");
    }
    // Our order id doubles as PayHalal's order_id and our providerRef.
    const orderId = `PS${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    // Hand off to our own route, which POSTs the signed form to PayHalal.
    // PayHalal rejects GET with HTTP 405, so we cannot redirect straight there.
    const redirectUrl = `/api/payments/payhalal/start?ref=${encodeURIComponent(orderId)}`;
    const inserted = await db.collection<PaymentDoc>("payments").insertOne({
      userId, plan, interval, amount: amountSen, currency: "MYR",
      status: "initiated", provider: "payhalal", method: "payhalal",
      providerRef: orderId, baseAmount: baseSen, couponCode: redeemedCode,
      createdAt: now, updatedAt: now,
    } as PaymentDoc);
    await audit({
      userId, action: "payment.initiated", entityType: "payment", entityId: inserted.insertedId,
      newValue: { plan, interval, amountSen, couponCode: redeemedCode, provider: "payhalal", mode: cfg.mode },
      source: "payment",
    });
    return {
      paymentId: String(inserted.insertedId), providerRef: orderId, redirectUrl,
      amountSen, provider: "payhalal", method, couponCode: redeemedCode,
    };
  }

  /* ---- DuitNow QR: merchant-presented QR scanned in a banking app ---- */
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
    status: "qr_presented", provider: providerName, method: "duitnow_qr", providerRef, qrPayload,
    baseAmount: baseSen, couponCode: redeemedCode,
    createdAt: now, updatedAt: now,
  } as PaymentDoc);
  await audit({ userId, action: "payment.initiated", entityType: "payment", entityId: res.insertedId, newValue: { plan, interval, amountSen, couponCode: redeemedCode, provider: providerName }, source: "payment" });
  return { paymentId: String(res.insertedId), providerRef, qrPayload, amountSen, provider: providerName, method: "duitnow_qr" as const, couponCode: redeemedCode };
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

  // Receipt email — best-effort; failure must not roll back activation.
  try {
    const userDoc = await db.collection("users").findOne({ _id: payment.userId }, { projection: { email: 1 } });
    if (userDoc?.email) {
      await sendPaymentReceiptEmail(userDoc.email as string, {
        planName: PLANS[planKey]?.name ?? payment.plan,
        amountMyr: (payment.amount / 100).toFixed(2),
        credits,
        providerRef: payment.providerRef,
      });
    }
  } catch (err) {
    logger.error("payment.receipt_email_failed", { paymentId: String(payment._id), error: String(err) });
  }
}

/** Server-side verification + subscription activation. Never trust the client. */
export async function verifyAndActivate(providerRef: string): Promise<{ verified: boolean; status: string }> {
  await ensureIndexes();
  const db = await getDb();
  const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef });
  if (!payment) return { verified: false, status: "not_found" };
  if (payment.status === "verified") return { verified: true, status: "verified" };

  // PayHalal is verified by asking PayHalal directly about the transaction id
  // we captured from its signed callback.
  if (payment.provider === "payhalal") {
    if (!payment.providerTransactionId) return { verified: false, status: "pending" };
    const rec = await reconcileTransaction(payment.providerTransactionId);
    if (rec.status !== "paid") return { verified: false, status: rec.status };
    if (!amountMatchesSen(rec.amount, payment.amount)) {
      logger.error("payhalal.amount_mismatch_on_verify", {
        providerRef, expectedSen: payment.amount, reported: rec.amount,
      });
      return { verified: false, status: "amount_mismatch" };
    }
    await activatePayment(payment);
    return { verified: true, status: "verified" };
  }

  const provider = getPaymentProvider();
  const remote = await provider.fetchStatus(providerRef);
  if (remote !== "paid") return { verified: false, status: remote };

  await activatePayment(payment);
  return { verified: true, status: "verified" };
}

/* ---------------- PayHalal callback ---------------- */

export type PayHalalCallbackOutcome = "ok" | "failed" | "rejected" | "not_found" | "amount_mismatch";

/**
 * Handle PayHalal's server-to-server notification.
 *
 * Trust model: the callback is hash-signed with the app secret, so a valid hash
 * proves PayHalal sent it. We still cross-check the amount against our own
 * record before granting anything, and activation itself is idempotent.
 * `verifyAndActivate` adds a second, independent confirmation (reconciliation)
 * for customers returning through the redirect URL.
 */
export async function handlePayHalalCallback(
  data: PayHalalCallback
): Promise<{ outcome: PayHalalCallbackOutcome; message?: string }> {
  const cfg = getPayHalalConfig();
  if (!cfg) return { outcome: "rejected", message: "not configured" };
  if (!callbackAppMatches(cfg, data)) return { outcome: "rejected", message: "app_id mismatch" };
  if (!verifyCallbackHash(cfg, data)) return { outcome: "rejected", message: "bad hash" };

  const orderId = data.order_id;
  if (!orderId) return { outcome: "rejected", message: "missing order_id" };

  await ensureIndexes();
  const db = await getDb();

  // Persist the raw callback for audit/dispute, whatever the outcome.
  await db.collection("payment_notifications").insertOne({
    source: "payhalal",
    providerRef: orderId,
    transactionId: data.transaction_id ?? null,
    status: data.status ?? null,
    channel: data.channel ?? null,
    amount: data.amount ?? null,
    raw: data,
    createdAt: new Date(),
  }).catch((err) => logger.warn("payhalal.callback_log_failed", { error: String(err) }));

  const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef: orderId });
  if (!payment) return { outcome: "not_found", message: "unknown order" };

  // Idempotent: a repeat notification is a success, not a second grant.
  if (payment.status === "verified") return { outcome: "ok" };

  if (data.status !== "SUCCESS") {
    await db.collection<PaymentDoc>("payments").updateOne(
      { _id: payment._id },
      { $set: { status: "failed", providerTransactionId: data.transaction_id, channel: data.channel, updatedAt: new Date() } }
    );
    logger.warn("payhalal.callback_not_success", { providerRef: orderId, status: data.status });
    return { outcome: "failed", message: data.status };
  }

  // Never trust the posted amount — compare it with what we charged.
  if (!amountMatchesSen(data.amount, payment.amount)) {
    logger.error("payhalal.amount_mismatch", {
      providerRef: orderId, expectedSen: payment.amount, reported: data.amount,
    });
    return { outcome: "amount_mismatch", message: "amount mismatch" };
  }

  await db.collection<PaymentDoc>("payments").updateOne(
    { _id: payment._id },
    { $set: { providerTransactionId: data.transaction_id, channel: data.channel, updatedAt: new Date() } }
  );
  await markPaymentPaid(orderId);
  await activatePayment({
    ...payment,
    providerTransactionId: data.transaction_id,
    channel: data.channel,
  });
  logger.info("payhalal.activated", {
    providerRef: orderId, transactionId: data.transaction_id, channel: data.channel,
  });
  return { outcome: "ok" };
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
