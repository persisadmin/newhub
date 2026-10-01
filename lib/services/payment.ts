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
import {
  ChipError,
  chipAmountMatchesSen,
  createChipPurchase,
  fetchChipPurchase,
  getChipConfig,
  getChipPublicKey,
  isChipFailedStatus,
  isChipPaidStatus,
  verifyChipSignature,
  type ChipCheckoutMethod,
} from "@/lib/services/chip";
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

/** How the customer pays. Chip redirects to a hosted page (FPX online banking
 *  or DuitNow QR); PayHalal and DuitNow are legacy providers kept for history. */
export type CheckoutMethod = "chip_fpx" | "chip_duitnow_qr" | "payhalal" | "duitnow_qr";

export async function initiatePayment(
  userId: ObjectId,
  plan: PlanKey,
  interval: "monthly" | "yearly" = "monthly",
  couponCode?: string,
  method: CheckoutMethod = "chip_fpx"
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

  /* ---- CHIP In Asia: hosted checkout (FPX online banking / DuitNow QR) ---- */
  if (method === "chip_fpx" || method === "chip_duitnow_qr") {
    const cfg = getChipConfig();
    if (!cfg) {
      throw new HttpError(503, "Online payment is temporarily unavailable. Please try again shortly or contact support.", "CHIP_NOT_CONFIGURED");
    }
    const chipMethod = method as ChipCheckoutMethod;
    // Our order id is sent as the purchase `reference` and is our providerRef.
    const orderId = `PS${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    // Chip needs absolute return URLs (sent per-purchase, so no dashboard setup).
    const base = (getEnv().NEXTAUTH_URL ?? "").replace(/\/+$/, "");
    let purchase;
    try {
      purchase = await createChipPurchase(cfg, {
        amountSen,
        reference: orderId,
        customerEmail: (userDoc?.email as string) ?? "",
        productName: `PERSIS ${PLANS[plan].name} package`,
        method: chipMethod,
        successRedirect: `${base}/api/payments/chip/return?outcome=success&ref=${encodeURIComponent(orderId)}`,
        failureRedirect: `${base}/api/payments/chip/return?outcome=failure&ref=${encodeURIComponent(orderId)}`,
        cancelRedirect: `${base}/settings`,
        successCallback: base ? `${base}/api/payments/chip/callback` : undefined,
      });
    } catch (err) {
      if (err instanceof ChipError) {
        logger.error("chip.initiate_failed", { status: err.status, method: chipMethod, error: err.message });
        throw new HttpError(502, `The payment gateway could not start this payment (${err.message}). Please try again.`, "CHIP_CREATE_FAILED");
      }
      throw err;
    }
    const inserted = await db.collection<PaymentDoc>("payments").insertOne({
      userId, plan, interval, amount: amountSen, currency: "MYR",
      status: "initiated", provider: "chip", method,
      providerRef: orderId, providerTransactionId: purchase.id,
      baseAmount: baseSen, couponCode: redeemedCode,
      createdAt: now, updatedAt: now,
    } as PaymentDoc);
    await audit({
      userId, action: "payment.initiated", entityType: "payment", entityId: inserted.insertedId,
      newValue: { plan, interval, amountSen, couponCode: redeemedCode, provider: "chip", method, purchaseId: purchase.id },
      source: "payment",
    });
    // checkout_url is a plain GET page — redirect the browser straight there.
    return {
      paymentId: String(inserted.insertedId), providerRef: orderId,
      redirectUrl: purchase.checkoutUrl,
      amountSen, provider: "chip", method, couponCode: redeemedCode,
    };
  }

  /* ---- PayHalal: hosted redirect checkout (FPX / card / e-wallet) ---- */
  if (method === "payhalal") {
    const cfg = getPayHalalConfig();
    if (!cfg) {
      throw new HttpError(503, "Online payment is temporarily unavailable. Please try again shortly or contact support.", "PAYHALAL_NOT_CONFIGURED");
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

  // Chip is verified by asking Chip directly about the purchase id we stored
  // at creation time. `paid`/`cleared`/`settled` all mean the money is in.
  if (payment.provider === "chip") {
    const cfg = getChipConfig();
    if (!cfg) return { verified: false, status: "not_configured" };
    if (!payment.providerTransactionId) return { verified: false, status: "pending" };
    const purchase = await fetchChipPurchase(cfg, payment.providerTransactionId);
    if (!purchase) return { verified: false, status: "not_found" };
    if (isChipPaidStatus(purchase.status)) {
      if (!chipAmountMatchesSen(purchase.totalSen, payment.amount)) {
        logger.error("chip.amount_mismatch_on_verify", {
          providerRef, expectedSen: payment.amount, reported: purchase.totalSen,
        });
        return { verified: false, status: "amount_mismatch" };
      }
      await activatePayment(payment);
      return { verified: true, status: "verified" };
    }
    if (isChipFailedStatus(purchase.status)) {
      await db.collection<PaymentDoc>("payments").updateOne(
        { _id: payment._id },
        { $set: { status: "failed", updatedAt: new Date() } }
      );
      return { verified: false, status: purchase.status };
    }
    return { verified: false, status: purchase.status };
  }

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
  // The text/amountsSen/matched fields mirror the DuitNow bridge documents so
  // the admin notification log can render PayHalal callbacks without crashing.
  const callbackAmountSen =
    data.amount != null && Number.isFinite(Number(data.amount))
      ? Math.round(Number(data.amount) * 100)
      : null;
  await db.collection("payment_notifications").insertOne({
    source: "payhalal",
    providerRef: orderId,
    transactionId: data.transaction_id ?? null,
    status: data.status ?? null,
    channel: data.channel ?? null,
    amount: data.amount ?? null,
    text:
      `PayHalal ${data.status ?? "?"} · ${data.channel ?? "?"} · order ${orderId}` +
      (data.transaction_id ? ` · txn ${data.transaction_id}` : ""),
    amountsSen: callbackAmountSen != null ? [callbackAmountSen] : [],
    matched: data.status === "SUCCESS",
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

/* ---------------- CHIP In Asia callback ---------------- */

export type ChipCallbackOutcome = "ok" | "failed" | "rejected" | "not_found" | "amount_mismatch" | "not_configured";

/**
 * Handle CHIP's signed `success_callback` delivery.
 *
 * Trust model: the body is RSA-signed (X-Signature) with a key whose public
 * half Chip serves at GET /public_key/, so a valid signature proves Chip sent
 * it. We still cross-check the amount against our own record before granting
 * anything, and activation is idempotent. `verifyAndActivate` adds a second,
 * independent confirmation (GET /purchases/{id}/) for returning customers.
 *
 * `rawBody` must be the exact request body bytes — the signature covers them,
 * so re-serialising the parsed object would break verification.
 */
export async function handleChipCallback(
  rawBody: string,
  signature: string | null
): Promise<{ outcome: ChipCallbackOutcome; message?: string }> {
  const cfg = getChipConfig();
  if (!cfg) return { outcome: "not_configured", message: "chip not configured" };
  const publicKey = await getChipPublicKey(cfg);
  if (!publicKey) return { outcome: "rejected", message: "no public key available" };
  if (!verifyChipSignature(rawBody, signature, publicKey)) {
    logger.warn("chip.callback_bad_signature");
    return { outcome: "rejected", message: "bad signature" };
  }

  let purchase: Record<string, unknown>;
  try {
    purchase = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { outcome: "rejected", message: "unparseable body" };
  }

  const orderId = typeof purchase.reference === "string" ? purchase.reference : null;
  if (!orderId) return { outcome: "rejected", message: "missing reference" };
  const status = typeof purchase.status === "string" ? purchase.status : null;
  const purchaseId = typeof purchase.id === "string" ? purchase.id : null;
  const totalSen = (purchase.purchase as Record<string, unknown> | undefined)?.total;

  await ensureIndexes();
  const db = await getDb();

  // Persist the raw callback for audit/dispute, whatever the outcome.
  const amountsSen = Number.isFinite(Number(totalSen)) ? [Math.round(Number(totalSen))] : [];
  await db.collection("payment_notifications").insertOne({
    source: "chip",
    providerRef: orderId,
    transactionId: purchaseId,
    status,
    channel: null,
    amount: amountsSen.length ? amountsSen[0] / 100 : null,
    text: `Chip ${status ?? "?"} · order ${orderId}` + (purchaseId ? ` · purchase ${purchaseId.slice(0, 8)}…` : ""),
    amountsSen,
    matched: isChipPaidStatus(status),
    raw: purchase,
    createdAt: new Date(),
  }).catch((err) => logger.warn("chip.callback_log_failed", { error: String(err) }));

  const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef: orderId });
  if (!payment) return { outcome: "not_found", message: "unknown order" };

  // Idempotent: a repeat delivery is a success, not a second grant.
  if (payment.status === "verified") return { outcome: "ok" };

  if (!isChipPaidStatus(status)) {
    // Only a terminal outcome flips the payment to failed; "created"/"viewed"
    // etc. are still in flight, so we leave the payment open.
    if (isChipFailedStatus(status)) {
      await db.collection<PaymentDoc>("payments").updateOne(
        { _id: payment._id },
        { $set: { status: "failed", updatedAt: new Date() } }
      );
      logger.warn("chip.callback_failed_status", { providerRef: orderId, status });
      return { outcome: "failed", message: status ?? "unknown" };
    }
    return { outcome: "ok", message: `in flight (${status ?? "unknown"})` };
  }

  // Never trust the delivered amount — compare it with what we charged.
  if (!chipAmountMatchesSen(totalSen, payment.amount)) {
    logger.error("chip.amount_mismatch", {
      providerRef: orderId, expectedSen: payment.amount, reported: totalSen,
    });
    return { outcome: "amount_mismatch", message: "amount mismatch" };
  }

  if (purchaseId && payment.providerTransactionId !== purchaseId) {
    await db.collection<PaymentDoc>("payments").updateOne(
      { _id: payment._id },
      { $set: { providerTransactionId: purchaseId, updatedAt: new Date() } }
    );
  }
  await markPaymentPaid(orderId);
  await activatePayment({ ...payment, providerTransactionId: purchaseId ?? payment.providerTransactionId });
  logger.info("chip.activated", { providerRef: orderId, purchaseId, status });
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
