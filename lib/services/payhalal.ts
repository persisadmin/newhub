import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * PayHalal hosted-payment adapter (V1 redirect flow).
 *
 * Docs: https://souqa-fintech.gitbook.io/api-docs
 *
 * Flow:
 *   1. We build a signed payment URL and send the customer to PayHalal.
 *   2. PayHalal hosts the page (FPX / card / e-wallet), then returns the
 *      customer to our redirect URL.
 *   3. PayHalal calls our notification URL server-to-server with the outcome.
 *   4. We verify the callback hash, cross-check the amount against our own
 *      record, and reconcile with PayHalal before granting credits.
 *
 * Hash contracts (verified against the integration guide):
 *   request  = sha256(secret + amount + currency + product_description + order_id
 *                     + customer_name + customer_email + customer_phone)
 *   callback = sha256(...same..., + transaction_id + status)
 *   reconcile= md5(merchant_id + app_id + secret)
 *
 * Fields are concatenated with NO separators. Because the hash covers the exact
 * values sent, the request hash is always derived from the same object that is
 * transmitted — never built twice from separate inputs.
 */

export type PayHalalMode = "live" | "uat";

export interface PayHalalConfig {
  appId: string;
  appSecret: string;
  /** Merchant email — required for the reconciliation API. */
  merchantId: string;
  mode: PayHalalMode;
}

/** Configured only when both the app id and secret are present. */
export function getPayHalalConfig(): PayHalalConfig | null {
  const env = getEnv();
  const appId = env.PAYHALAL_APP_ID?.trim();
  const appSecret = env.PAYHALAL_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    merchantId: env.PAYHALAL_MERCHANT_ID?.trim() ?? "",
    mode: env.PAYHALAL_MODE === "live" ? "live" : "uat",
  };
}

export function isPayHalalConfigured(): boolean {
  return getPayHalalConfig() !== null;
}

export interface PayHalalEndpoints {
  payUrl: string;
  reconcileUrl: string;
}

export function payHalalEndpoints(mode: PayHalalMode): PayHalalEndpoints {
  return mode === "live"
    ? {
        payUrl: "https://api.payhalal.my/pay",
        reconcileUrl: "https://api-merchant.payhalal.my/single_transaction_reconcile.php",
      }
    : {
        payUrl: "https://api-testing.payhalal.my/pay",
        reconcileUrl: "https://api-merchant-uat.payhalal.my/single_transaction_reconcile.php",
      };
}

/* ---------------- hashing ---------------- */

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Sen → PayHalal's decimal string, e.g. 29900 → "299.00". */
export function formatPayHalalAmount(amountSen: number): string {
  return (amountSen / 100).toFixed(2);
}

/* ---------------- payment request ---------------- */

export interface PaymentRequestInput {
  amountSen: number;
  productDescription: string;
  /** Becomes PayHalal's order_id and our providerRef. */
  orderId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface PayHalalPaymentRequest {
  app_id: string;
  amount: string;
  currency: string;
  product_description: string;
  order_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  language: string;
  hash: string;
}

/**
 * Build the signed request. The hash is derived from the very object we send,
 * so the two can never disagree.
 */
export function buildPaymentRequest(
  cfg: PayHalalConfig,
  input: PaymentRequestInput
): { payUrl: string; params: PayHalalPaymentRequest } {
  const params: Omit<PayHalalPaymentRequest, "hash"> = {
    app_id: cfg.appId,
    amount: formatPayHalalAmount(input.amountSen),
    currency: "MYR",
    product_description: input.productDescription,
    order_id: input.orderId,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone,
    language: "en",
  };
  const hash = sha256(
    cfg.appSecret +
      params.amount +
      params.currency +
      params.product_description +
      params.order_id +
      params.customer_name +
      params.customer_email +
      params.customer_phone
  );
  return { payUrl: payHalalEndpoints(cfg.mode).payUrl, params: { ...params, hash } };
}

/**
 * Full redirect URL. The docs support GET as well as POST for V1, so a plain
 * redirect avoids rendering an auto-submitting form.
 */
export function buildPaymentUrl(cfg: PayHalalConfig, input: PaymentRequestInput): string {
  const { payUrl, params } = buildPaymentRequest(cfg, input);
  const qs = new URLSearchParams(params as unknown as Record<string, string>);
  return `${payUrl}?${qs.toString()}`;
}

/* ---------------- callback verification ---------------- */

export interface PayHalalCallback {
  app_id?: string;
  amount?: string;
  currency?: string;
  product_description?: string;
  order_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  transaction_id?: string;
  status?: string;
  channel?: string;
  hash?: string;
}

/**
 * Verify a callback's hash. Returns false when the hash is absent or does not
 * match — callers must treat that as untrusted.
 */
export function verifyCallbackHash(cfg: PayHalalConfig, data: PayHalalCallback): boolean {
  const provided = data.hash;
  if (!provided) return false;
  const expected = sha256(
    cfg.appSecret +
      (data.amount ?? "") +
      (data.currency ?? "") +
      (data.product_description ?? "") +
      (data.order_id ?? "") +
      (data.customer_name ?? "") +
      (data.customer_email ?? "") +
      (data.customer_phone ?? "") +
      (data.transaction_id ?? "") +
      (data.status ?? "")
  );
  return hexEqual(expected, provided);
}

/** PayHalal app_id must match ours — rejects callbacks meant for another app. */
export function callbackAppMatches(cfg: PayHalalConfig, data: PayHalalCallback): boolean {
  return !data.app_id || data.app_id === cfg.appId;
}

/* ---------------- reconciliation ---------------- */

export type ReconcileStatus = "paid" | "pending" | "failed" | "unknown";

export interface ReconcileResult {
  found: boolean;
  status: ReconcileStatus;
  /** Amount as returned by PayHalal (decimal string), for cross-checking. */
  amount?: string;
  source?: string;
  mode?: string;
  raw?: unknown;
}

function normaliseReconcileStatus(raw: string | undefined): ReconcileStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "SUCCESS":
    case "PAID":
      return "paid";
    case "PENDING":
    case "PROCESSING":
      return "pending";
    case "FAIL":
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
      return "failed";
    default:
      return "unknown";
  }
}

/**
 * Ask PayHalal for the authoritative status of a transaction. This is the
 * server-side check that means we never activate credits on a client's word.
 */
export async function reconcileTransaction(transactionId: string): Promise<ReconcileResult> {
  const cfg = getPayHalalConfig();
  if (!cfg) return { found: false, status: "unknown" };
  if (!cfg.merchantId) {
    logger.warn("payhalal.reconcile_no_merchant_id");
    return { found: false, status: "unknown" };
  }

  const { reconcileUrl } = payHalalEndpoints(cfg.mode);
  const hash = md5(cfg.merchantId + cfg.appId + cfg.appSecret);
  const url = `${reconcileUrl}?${new URLSearchParams({ transaction_id: transactionId, merchant_id: cfg.merchantId, hash })}`;

  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    if (!res.ok) {
      logger.warn("payhalal.reconcile_http_error", { status: res.status, body: text.slice(0, 200) });
      return { found: false, status: "unknown" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      logger.warn("payhalal.reconcile_unparseable", { body: text.slice(0, 200) });
      return { found: false, status: "unknown" };
    }
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!row || typeof row !== "object") return { found: false, status: "unknown" };
    const r = row as Record<string, unknown>;
    if (typeof r.error === "string") {
      logger.warn("payhalal.reconcile_error", { error: r.error });
      return { found: false, status: "unknown" };
    }
    return {
      found: true,
      status: normaliseReconcileStatus(typeof r.status === "string" ? r.status : undefined),
      amount: typeof r.amount === "string" ? r.amount : undefined,
      source: typeof r.source === "string" ? r.source : undefined,
      mode: typeof r.mode === "string" ? r.mode : undefined,
      raw: row,
    };
  } catch (err) {
    logger.error("payhalal.reconcile_failed", { error: String(err) });
    return { found: false, status: "unknown" };
  }
}

/** Compare a PayHalal decimal amount ("299.0000") with our sen amount. */
export function amountMatchesSen(decimalAmount: string | undefined, amountSen: number): boolean {
  if (decimalAmount == null) return false;
  const parsed = Number(decimalAmount);
  if (!Number.isFinite(parsed)) return false;
  return Math.round(parsed * 100) === Math.round(amountSen);
}
