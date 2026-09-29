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
 *   reconcile= md5(merchant_id + app_key + secret)   ← note: app KEY, not app id
 *
 * Fields are concatenated with NO separators. Because the hash covers the exact
 * values sent, the request hash is always derived from the same object that is
 * transmitted — never built twice from separate inputs.
 */

export type PayHalalMode = "live" | "uat";

export interface PayHalalConfig {
  appId: string;
  /** App key from the dashboard (distinct from the app id) — used only for reconciliation. */
  appKey: string;
  appSecret: string;
  /** Merchant email — required for the reconciliation API. */
  merchantId: string;
  mode: PayHalalMode;
}

/** Configured only when both the app id and secret are present. */
/**
 * App keys are prefixed `app-live-…` (production) or `app-testing-…` (UAT);
 * older keys use a bare `live-…`. Verified against PayHalal's UAT endpoint.
 */
function inferModeFromAppKey(appKey: string): PayHalalMode {
  const key = appKey.toLowerCase();
  if (key.startsWith("app-live-") || key.startsWith("live-")) return "live";
  if (key.startsWith("app-testing-") || key.startsWith("testing-")) return "uat";
  return "uat";
}

export function getPayHalalConfig(): PayHalalConfig | null {
  const env = getEnv();
  // NOTE: the `app_id` request parameter is PayHalal's app KEY
  // (app-live-… / app-testing-…), NOT the dashboard's "App ID" field.
  const appId = env.PAYHALAL_APP_ID?.trim();
  const appSecret = env.PAYHALAL_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  // Explicit PAYHALAL_MODE wins; otherwise infer it from the app key.
  const mode: PayHalalMode = env.PAYHALAL_MODE ?? inferModeFromAppKey(appId);
  return {
    appId,
    appKey: env.PAYHALAL_APP_KEY?.trim() ?? "",
    appSecret,
    merchantId: env.PAYHALAL_MERCHANT_ID?.trim() ?? "",
    mode,
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
 * PayHalal's docs write the formula as `sha256(APP_SECRET.AMOUNT.CURRENCY.…)`.
 * In PHP the `.` is the string concatenation operator, so the fields are joined
 * with NO separator — that is the "plain" variant, and the one we send. The
 * self-test also tries a literal dot-separated variant so PayHalal itself can
 * settle which one it actually expects.
 */
export type HashVariant = "plain" | "dotted";

export function computeRequestHash(
  cfg: PayHalalConfig,
  params: Omit<PayHalalPaymentRequest, "hash">,
  variant: HashVariant = "plain"
): string {
  const parts = [
    cfg.appSecret,
    params.amount,
    params.currency,
    params.product_description,
    params.order_id,
    params.customer_name,
    params.customer_email,
    params.customer_phone,
  ];
  return sha256(variant === "dotted" ? parts.join(".") : parts.join(""));
}

/**
 * Build the signed request. The hash is derived from the very object we send,
 * so the two can never disagree.
 */
export function buildPaymentRequest(
  cfg: PayHalalConfig,
  input: PaymentRequestInput,
  variant: HashVariant = "plain"
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
  const hash = computeRequestHash(cfg, params, variant);
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
  if (!cfg.merchantId || !cfg.appKey) {
    logger.warn("payhalal.reconcile_missing_credentials", { merchantId: Boolean(cfg.merchantId), appKey: Boolean(cfg.appKey) });
    return { found: false, status: "unknown" };
  }

  const { reconcileUrl } = payHalalEndpoints(cfg.mode);
  // md5(merchant_id + app_key + app_secret) — the app KEY, not the app id.
  const hash = md5(cfg.merchantId + cfg.appKey + cfg.appSecret);
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

/* ---------------- live diagnostics ---------------- */

/**
 * Admin self-test. We normally hand the customer's browser to PayHalal and
 * never see the response, which makes a rejected payment link impossible to
 * debug. This opens the same URL server-side and reports exactly what PayHalal
 * answers — for both hash variants — plus a credential probe against the
 * reconciliation API. No payment is created; nothing is charged.
 */

export interface SelfTestAttempt {
  variant: HashVariant;
  label: string;
  url: string;
  status: number | null;
  location: string | null;
  accepted: boolean;
  snippet: string;
  error?: string;
}

export interface PayHalalSelfTest {
  configured: boolean;
  mode: PayHalalMode | null;
  payUrl: string | null;
  reconcileUrl: string | null;
  credentials: {
    appId: string;
    appIdLength: number;
    secretLength: number;
    hasAppKey: boolean;
    hasMerchantId: boolean;
    merchantId: string | null;
  };
  attempts: SelfTestAttempt[];
  reconcile: { attempted: boolean; status: number | null; body: string; error?: string };
  /** Configuration smells detected before any network call. */
  warnings: string[];
  conclusion: string;
}

function maskSecretish(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

/** Strip HTML so an error page becomes readable text in the admin UI. */
function plainText(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

const REJECT_HINTS = [
  "invalid", "error", "denied", "failed", "not found", "unauthor",
  "reject", "tidak sah", "wrong",
];

/**
 * A business-rule rejection means PayHalal parsed the request, but its
 * validation order puts these checks BEFORE credential checks, so they do not
 * prove the hash is correct.
 */
const BUSINESS_RULE_HINTS = ["minimum amount", "maximum amount", "duplicate order"];

function looksRejected(status: number, text: string): boolean {
  if (status >= 400) return true;
  const t = text.toLowerCase();
  return REJECT_HINTS.some((h) => t.includes(h));
}

/**
 * Submit the checkout form the same way the browser will.
 *
 * PayHalal's V1 endpoint rejects GET with HTTP 405 "Method not allowed", so the
 * production flow must POST. This probe has to use the same method, or it
 * measures something the customer never experiences.
 */
async function probePaymentUrl(
  payUrl: string,
  params: Record<string, string>,
  variant: HashVariant,
  label: string,
  method: "POST" | "GET" = "POST"
): Promise<SelfTestAttempt> {
  const url = method === "GET" ? `${payUrl}?${new URLSearchParams(params)}` : payUrl;
  try {
    const res = await fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? new URLSearchParams(params).toString() : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400;
    const snippet = isRedirect ? "" : plainText(await res.text());
    // A redirect means the gateway accepted the request and is sending the
    // browser on to the payment UI. A 200 without rejection keywords also
    // means it rendered a payment page rather than an error.
    const accepted = isRedirect || (res.status === 200 && !looksRejected(res.status, snippet));
    return {
      variant, label, url,
      status: res.status,
      location,
      accepted,
      snippet: snippet || (location ? `redirect → ${location}` : ""),
    };
  } catch (err) {
    return { variant, label, url, status: null, location: null, accepted: false, snippet: "", error: String(err) };
  }
}

/** Defaults to RM10.00 — PayHalal rejects anything below its RM5.00 minimum. */
export async function payHalalSelfTest(amountSen = 1000): Promise<PayHalalSelfTest> {
  const cfg = getPayHalalConfig();
  const result: PayHalalSelfTest = {
    configured: !!cfg,
    mode: cfg?.mode ?? null,
    payUrl: cfg ? payHalalEndpoints(cfg.mode).payUrl : null,
    reconcileUrl: cfg ? payHalalEndpoints(cfg.mode).reconcileUrl : null,
    credentials: {
      appId: cfg ? maskSecretish(cfg.appId) : "",
      appIdLength: cfg?.appId.length ?? 0,
      secretLength: cfg?.appSecret.length ?? 0,
      hasAppKey: !!cfg?.appKey,
      hasMerchantId: !!cfg?.merchantId,
      merchantId: cfg?.merchantId ? maskSecretish(cfg.merchantId) : null,
    },
    attempts: [],
    reconcile: { attempted: false, status: null, body: "" },
    warnings: [],
    conclusion: "",
  };

  if (cfg) {
    // The single most common misconfiguration: using the dashboard's "App ID"
    // field where the app KEY belongs.
    if (!cfg.appId.toLowerCase().startsWith("app-")) {
      result.warnings.push(
        'PAYHALAL_APP_ID does not look like a PayHalal app KEY (expected prefix "app-", e.g. app-live-… or ' +
          'app-testing-…). The dashboard\'s "App ID" field is a different value and is rejected as app_id.'
      );
    }
    if (!cfg.appSecret.toLowerCase().startsWith("secret-")) {
      result.warnings.push(
        'PAYHALAL_APP_SECRET does not start with "secret-" — check you copied the Secret and not the App Key.'
      );
    }
    // The app key and secret must come from the SAME PayHalal app. Mixing the
    // live key with the testing secret (or vice versa) is answered with
    // "SHA256 Signature invalid." — verified against both endpoints.
    const keyIsTesting = cfg.appId.toLowerCase().startsWith("app-testing-");
    const secretIsTesting = cfg.appSecret.toLowerCase().startsWith("secret-testing-");
    if (keyIsTesting !== secretIsTesting) {
      result.warnings.push(
        `PAYHALAL_APP_ID and PAYHALAL_APP_SECRET appear to come from DIFFERENT environments ` +
          `(app key = ${keyIsTesting ? "testing" : "live"}, secret = ${secretIsTesting ? "testing" : "live"}). ` +
          `That is answered with "SHA256 Signature invalid." — copy both values from the same PayHalal app.`
      );
    }
  }

  if (!cfg) {
    result.conclusion =
      "PayHalal is not configured: set PAYHALAL_APP_ID and PAYHALAL_APP_SECRET (and PAYHALAL_APP_KEY for reconciliation).";
    return result;
  }

  const input: PaymentRequestInput = {
    amountSen,
    productDescription: "PERSIS self-test",
    orderId: `SELFTEST${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    customerName: "",
    customerEmail: "",
    customerPhone: "",
  };

  const variants: Array<{ variant: HashVariant; label: string }> = [
    { variant: "plain", label: "plain concatenation, no separators (what we currently send)" },
    { variant: "dotted", label: "dot-separated: APP_SECRET.AMOUNT.CURRENCY.…" },
  ];
  for (const v of variants) {
    const { payUrl, params } = buildPaymentRequest(cfg, input, v.variant);
    result.attempts.push(
      await probePaymentUrl(payUrl, params as unknown as Record<string, string>, v.variant, v.label, "POST")
    );
  }

  // Credential probe: reconciling a non-existent transaction distinguishes
  // "credentials rejected" from "credentials fine, transaction missing".
  if (cfg.merchantId && cfg.appKey) {
    const hash = md5(cfg.merchantId + cfg.appKey + cfg.appSecret);
    const url = `${payHalalEndpoints(cfg.mode).reconcileUrl}?${new URLSearchParams({
      transaction_id: "SELFTEST",
      merchant_id: cfg.merchantId,
      hash,
    })}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      result.reconcile = { attempted: true, status: res.status, body: plainText(await res.text()) };
    } catch (err) {
      result.reconcile = { attempted: true, status: null, body: "", error: String(err) };
    }
  }

  const accepted = result.attempts.filter((a) => a.accepted);
  const combined = result.attempts.map((a) => a.snippet.toLowerCase()).join(" | ");
  const businessRule = result.attempts.find((a) =>
    BUSINESS_RULE_HINTS.some((h) => a.snippet.toLowerCase().includes(h))
  );

  if (accepted.some((a) => a.variant === "plain")) {
    result.conclusion =
      "PayHalal ACCEPTED the POST form and our plain-concatenation hash. The checkout hand-off is working end to end.";
  } else if (combined.includes("invalid app id") || combined.includes("app_id") || combined.includes("app id")) {
    result.conclusion =
      `PayHalal does not recognise app_id ${result.credentials.appId}. This parameter must be the app KEY ` +
      `(app-live-… or app-testing-…), NOT the dashboard's "App ID" field. Copy the "App Key" value into ` +
      `PAYHALAL_APP_ID and the "Secret" into PAYHALAL_APP_SECRET.`;
  } else if (combined.includes("hash") || combined.includes("signature")) {
    result.conclusion =
      `PayHalal rejected the SIGNATURE. PAYHALAL_APP_SECRET is most likely not the secret belonging to app id ` +
      `${result.credentials.appId} — the dashboard's "App Key" is a different value.`;
  } else if (businessRule) {
    result.conclusion =
      `PayHalal parsed the POST and rejected it on a business rule — "${businessRule.snippet}". ` +
      `This check runs before credential validation, so it does NOT prove the hash; raise the amount and re-run to reach the credential checks.`;
  } else if (accepted.some((a) => a.variant === "dotted")) {
    result.conclusion =
      "PayHalal rejected our plain hash but ACCEPTED the dot-separated variant. The hash format must be changed to dot-separated.";
  } else {
    const detail = result.attempts
      .map((a) => `${a.variant} → HTTP ${a.status ?? "n/a"}: ${a.snippet || a.error || "no body"}`)
      .join("  |  ");
    result.conclusion =
      `PayHalal did not accept either variant. Responses: ${detail}. ` +
      `Check that PAYHALAL_APP_SECRET belongs to app id ${result.credentials.appId}, and that the app is activated for live payments.`;
  }
  return result;
}
