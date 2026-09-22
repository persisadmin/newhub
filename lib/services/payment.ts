import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/audit";
import type { PaymentDoc, SubscriptionDoc } from "@/lib/domain/types";

export const PLANS = {
  starter: { name: "Starter", monthly: 9900, yearly: 99000 },      // sen
  professional: { name: "Professional", monthly: 24900, yearly: 249000 },
  enterprise: { name: "Enterprise", monthly: 59900, yearly: 599000 },
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

export async function initiatePayment(userId: ObjectId, plan: PlanKey, interval: "monthly" | "yearly") {
  await ensureIndexes();
  const db = await getDb();
  const amountSen = PLANS[plan][interval];
  const provider = getPaymentProvider();
  const { providerRef, qrPayload } = await provider.createPayment({
    amountSen, plan, interval, userId: String(userId),
  });
  const now = new Date();
  const res = await db.collection<PaymentDoc>("payments").insertOne({
    userId, plan, interval, amount: amountSen, currency: "MYR",
    status: "qr_presented", provider: provider.name, providerRef, qrPayload,
    createdAt: now, updatedAt: now,
  } as PaymentDoc);
  await audit({ userId, action: "payment.initiated", entityType: "payment", entityId: res.insertedId, newValue: { plan, interval, amountSen }, source: "payment" });
  return { paymentId: String(res.insertedId), providerRef, qrPayload, amountSen };
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

  const now = new Date();
  await db.collection<PaymentDoc>("payments").updateOne(
    { providerRef },
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
  await audit({ userId: payment.userId, action: "payment.verified", entityType: "payment", entityId: payment._id, newValue: { providerRef }, source: "payment" });
  await audit({ userId: payment.userId, action: "subscription.activated", entityType: "subscription", entityId: payment.userId, newValue: { plan: payment.plan, interval: payment.interval }, source: "payment" });
  return { verified: true, status: "verified" };
}
