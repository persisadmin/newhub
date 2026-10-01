import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * CHIP In Asia (CHIP Collect) adapter — hosted checkout.
 *
 * Canonical spec : https://docs.chip-in.asia/openapi/chip-collect.yaml
 * Docs           : https://docs.chip-in.asia/chip-collect/overview/quickstart
 * Signatures     : https://docs.chip-in.asia/chip-collect/overview/webhook-signatures
 *
 * Contract facts below were read out of the OpenAPI spec itself, not just the
 * prose docs, because the two disagree often enough to matter:
 *
 *   base URL      https://gate.chip-in.asia/api/v1
 *   auth          Authorization: Bearer <secret_key>
 *   create        POST /purchases/            (trailing slash is required)
 *   amounts       smallest currency unit — 1000 == RM 10.00
 *   response      { id, status: "created", checkout_url }
 *   status check  GET /purchases/{id}/        → status becomes "paid"
 *   methods       payment_method_whitelist enum includes "fpx" (FPX B2C),
 *                 "fpx_b2b1" (business banking) and "duitnow_qr"
 *   callback      success_callback receives a POST of the full Purchase object,
 *                 signed with X-Signature: base64 RSA PKCS#1 v1.5 over the
 *                 SHA-256 digest of the RAW request body bytes
 *   public key    GET /public_key/ returns a JSON-ENCODED PEM string, so the
 *                 body must be JSON-decoded before handing it to crypto
 *   ports         success_callback must not spell out a port — Chip rejects
 *                 :3000 and even :443. The redirect fields have no such rule.
 *
 * Unlike PayHalal, checkout_url is a normal GET page, so we can redirect the
 * browser straight at it — no signed POST-form interstitial is needed.
 */

export const CHIP_DEFAULT_BASE_URL = "https://gate.chip-in.asia/api/v1";

/** The two checkout options we offer customers. */
export type ChipCheckoutMethod = "chip_fpx" | "chip_duitnow_qr";

export interface ChipConfig {
  secretKey: string;
  brandId: string;
  baseUrl: string;
  /** Whitelist sent for the "online banking" option. */
  fpxMethods: string[];
  /** Whitelist sent for the "DuitNow QR" option. */
  qrMethods: string[];
}

function splitList(raw: string | undefined, fallback: string[]): string[] {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

export function getChipConfig(): ChipConfig | null {
  const env = getEnv();
  const secretKey = env.CHIP_SECRET_KEY?.trim();
  const brandId = env.CHIP_BRAND_ID?.trim();
  if (!secretKey || !brandId) return null;
  return {
    secretKey,
    brandId,
    baseUrl: (env.CHIP_BASE_URL?.trim() || CHIP_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    fpxMethods: splitList(env.CHIP_FPX_METHODS, ["fpx"]),
    qrMethods: splitList(env.CHIP_DUITNOW_METHODS, ["duitnow_qr"]),
  };
}

export function isChipConfigured(): boolean {
  return getChipConfig() !== null;
}

export function chipWhitelistFor(cfg: ChipConfig, method: ChipCheckoutMethod): string[] {
  return method === "chip_fpx" ? cfg.fpxMethods : cfg.qrMethods;
}

/* ------------------------------- statuses ------------------------------- */

/** Money is in — `cleared`/`settled` are later stages of a successful payment. */
const PAID_STATUSES = new Set(["paid", "cleared", "settled"]);
/** Terminal outcomes that will never become paid. */
const FAILED_STATUSES = new Set([
  "error", "blocked", "cancelled", "expired",
  "released", "refunded", "chargeback",
]);

export function isChipPaidStatus(status: unknown): boolean {
  return typeof status === "string" && PAID_STATUSES.has(status.trim().toLowerCase());
}

export function isChipFailedStatus(status: unknown): boolean {
  return typeof status === "string" && FAILED_STATUSES.has(status.trim().toLowerCase());
}

/* -------------------------------- errors -------------------------------- */

export class ChipError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = "ChipError";
  }
}

/** Pull a human-readable message out of Chip's several error shapes. */
export function chipErrorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const obj = json as Record<string, unknown>;
  for (const key of ["detail", "message", "error", "error_code"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // Field errors arrive as { field: ["reason"] } or { field: { message: "…" } }.
  const bits: string[] = [];
  for (const [field, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      bits.push(`${field}: ${value.join(", ")}`);
    } else if (value && typeof value === "object") {
      const inner = (value as Record<string, unknown>).message;
      if (typeof inner === "string") bits.push(`${field}: ${inner}`);
    }
  }
  return bits.length > 0 ? bits.join(" · ") : fallback;
}

/* ------------------------------ HTTP plumbing --------------------------- */

async function chipRequest(
  cfg: ChipConfig,
  path: string,
  init?: RequestInit
): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, text, json };
}

/* ------------------------------ create purchase ------------------------- */

export interface ChipPurchaseInput {
  /** Package price in sen (Chip's smallest-unit convention). */
  amountSen: number;
  /** Our order id; Chip echoes it back as `reference` on the callback. */
  reference: string;
  customerEmail: string;
  productName: string;
  method: ChipCheckoutMethod;
  successRedirect: string;
  failureRedirect: string;
  cancelRedirect?: string;
  /** Omitted automatically when the URL carries an explicit port. */
  successCallback?: string;
}

export interface ChipPurchaseResult {
  id: string;
  status: string;
  checkoutUrl: string;
  /** True when we had to drop success_callback because of an explicit port. */
  callbackOmitted: boolean;
}

export function hasExplicitPort(url: string): boolean {
  try {
    return new URL(url).port !== "";
  } catch {
    return false;
  }
}

export async function createChipPurchase(
  cfg: ChipConfig,
  input: ChipPurchaseInput
): Promise<ChipPurchaseResult> {
  const body: Record<string, unknown> = {
    brand_id: cfg.brandId,
    client: { email: input.customerEmail },
    purchase: { products: [{ name: input.productName, price: input.amountSen }] },
    reference: input.reference,
    platform: "api",
    send_receipt: false,
    payment_method_whitelist: chipWhitelistFor(cfg, input.method),
    success_redirect: input.successRedirect,
    failure_redirect: input.failureRedirect,
  };
  if (input.cancelRedirect) body.cancel_redirect = input.cancelRedirect;

  // Chip rejects a success_callback whose URL spells out a port, so on a
  // port-bearing base (e.g. localhost:3000 in dev) we simply omit it. We still
  // learn the outcome from the browser return and from GET /purchases/{id}/.
  let callbackOmitted = false;
  if (input.successCallback) {
    if (hasExplicitPort(input.successCallback)) {
      callbackOmitted = true;
      logger.warn("chip.callback_url_has_port", { url: input.successCallback });
    } else {
      body.success_callback = input.successCallback;
    }
  }

  const res = await chipRequest(cfg, "/purchases/", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (res.status < 200 || res.status >= 300) {
    const message = chipErrorMessage(res.json, `Chip responded HTTP ${res.status}`);
    logger.error("chip.create_purchase_failed", {
      status: res.status,
      reference: input.reference,
      method: input.method,
      detail: res.text.slice(0, 500),
    });
    throw new ChipError(message, res.status, res.json);
  }

  const obj = (res.json ?? {}) as Record<string, unknown>;
  const id = obj.id;
  const checkoutUrl = obj.checkout_url;
  if (typeof id !== "string" || typeof checkoutUrl !== "string") {
    throw new ChipError("Chip response was missing id or checkout_url", res.status, res.json);
  }
  return {
    id,
    status: typeof obj.status === "string" ? obj.status : "created",
    checkoutUrl,
    callbackOmitted,
  };
}

/* ------------------------------ read purchase --------------------------- */

export interface ChipPurchaseState {
  id: string;
  status: string;
  reference: string | null;
  /** Chip's `purchase.total`, in sen. */
  totalSen: number | null;
}

export async function fetchChipPurchase(
  cfg: ChipConfig,
  purchaseId: string
): Promise<ChipPurchaseState | null> {
  const res = await chipRequest(cfg, `/purchases/${encodeURIComponent(purchaseId)}/`);
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) {
    throw new ChipError(
      chipErrorMessage(res.json, `Chip responded HTTP ${res.status}`),
      res.status,
      res.json
    );
  }
  const obj = (res.json ?? {}) as Record<string, unknown>;
  const purchase = (obj.purchase ?? {}) as Record<string, unknown>;
  const total = purchase.total;
  return {
    id: typeof obj.id === "string" ? obj.id : purchaseId,
    status: typeof obj.status === "string" ? obj.status : "unknown",
    reference: typeof obj.reference === "string" ? obj.reference : null,
    totalSen: typeof total === "number" && Number.isFinite(total) ? Math.round(total) : null,
  };
}

/** Amounts are already integers in sen on both sides — compare exactly. */
export function chipAmountMatchesSen(reported: unknown, expectedSen: number): boolean {
  const n = Number(reported);
  if (!Number.isFinite(n)) return false;
  return Math.round(n) === Math.round(expectedSen);
}

/* ---------------------------- callback signature ------------------------ */

let cachedPublicKey: { pem: string; at: number } | null = null;
const PUBLIC_KEY_TTL_MS = 12 * 60 * 60 * 1000;

function normalizePem(raw: string): string {
  let pem = raw.trim();
  // Allow a single-line env value with escaped newlines.
  if (!pem.includes("\n") && pem.includes("\\n")) pem = pem.replace(/\\n/g, "\n");
  return pem;
}

/**
 * Fetch (and cache) the public key used to verify success_callback signatures.
 * CHIP_PUBLIC_KEY overrides the network call, which is useful when the runtime
 * has no egress or when you want to pin a key.
 */
export async function getChipPublicKey(
  cfg: ChipConfig,
  opts: { force?: boolean } = {}
): Promise<string | null> {
  const override = getEnv().CHIP_PUBLIC_KEY?.trim();
  if (override) return normalizePem(override);

  if (!opts.force && cachedPublicKey && Date.now() - cachedPublicKey.at < PUBLIC_KEY_TTL_MS) {
    return cachedPublicKey.pem;
  }

  try {
    const res = await chipRequest(cfg, "/public_key/");
    if (res.status < 200 || res.status >= 300) {
      logger.warn("chip.public_key_fetch_failed", { status: res.status });
      return cachedPublicKey?.pem ?? null;
    }
    // The endpoint returns a JSON-encoded string, so res.json is already the PEM.
    let pem: string;
    if (typeof res.json === "string") pem = res.json;
    else pem = res.text.trim();
    pem = normalizePem(pem);
    if (!pem.includes("BEGIN PUBLIC KEY")) {
      logger.warn("chip.public_key_unexpected_format", { preview: pem.slice(0, 40) });
      return cachedPublicKey?.pem ?? null;
    }
    cachedPublicKey = { pem, at: Date.now() };
    return pem;
  } catch (err) {
    logger.warn("chip.public_key_error", { error: String(err) });
    return cachedPublicKey?.pem ?? null;
  }
}

/**
 * Verify a signed callback. The signature covers the RAW body bytes, so callers
 * must pass the exact text they received — never a re-serialised object.
 */
export function verifyChipSignature(
  rawBody: string,
  signatureB64: string | null | undefined,
  publicKeyPem: string
): boolean {
  if (!signatureB64 || !rawBody) return false;
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKeyPem, signatureB64, "base64");
  } catch (err) {
    logger.warn("chip.signature_verify_error", { error: String(err) });
    return false;
  }
}

/* --------------------------- payment method lookup ---------------------- */

export interface ChipPaymentMethods {
  status: number;
  available: string[];
  error?: string;
}

/**
 * Ask Chip which methods this brand can actually take for a given amount.
 * RM 10 (1000 sen) is the documented safe probe value: FPX and DuitNow QR have
 * minimums, and probing with a smaller amount hides them from the response.
 */
export async function fetchChipPaymentMethods(
  cfg: ChipConfig,
  amountSen = 1000
): Promise<ChipPaymentMethods> {
  const qs = new URLSearchParams({
    brand_id: cfg.brandId,
    currency: "MYR",
    amount: String(amountSen),
  });
  const res = await chipRequest(cfg, `/payment_methods/?${qs.toString()}`);
  if (res.status < 200 || res.status >= 300) {
    return {
      status: res.status,
      available: [],
      error: chipErrorMessage(res.json, `HTTP ${res.status}`),
    };
  }
  const obj = (res.json ?? {}) as Record<string, unknown>;
  const raw = obj.available_payment_methods;
  const available = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === "string") : [];
  return { status: res.status, available };
}

/* --------------------------------- self test ---------------------------- */

export interface ChipSelfTestStep {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ChipSelfTest {
  configured: boolean;
  steps: ChipSelfTestStep[];
  config: {
    secretKeyChars: number;
    brandId: string;
    baseUrl: string;
    fpxMethods: string[];
    qrMethods: string[];
    publicKeySource: "env" | "api" | "none";
  } | null;
  methods: { available: string[]; fpx: boolean; duitnowQr: boolean } | null;
  purchase: { ok: boolean; id?: string; checkoutUrl?: string; status?: string; error?: string } | null;
  verdict: string;
}

/** Never returns secret material — lengths and non-secret identifiers only. */
export async function chipSelfTest(
  opts: { createPurchase?: boolean; baseUrl?: string } = {}
): Promise<ChipSelfTest> {
  const cfg = getChipConfig();
  const steps: ChipSelfTestStep[] = [];
  const result: ChipSelfTest = {
    configured: cfg !== null,
    steps,
    config: null,
    methods: null,
    purchase: null,
    verdict: "",
  };

  if (!cfg) {
    steps.push({
      label: "Credentials",
      ok: false,
      detail: "CHIP_SECRET_KEY and/or CHIP_BRAND_ID are not set",
    });
    result.verdict =
      "Chip is not configured. Set CHIP_SECRET_KEY and CHIP_BRAND_ID (merchant portal → Developers → API keys).";
    return result;
  }

  result.config = {
    secretKeyChars: cfg.secretKey.length,
    brandId: cfg.brandId,
    baseUrl: cfg.baseUrl,
    fpxMethods: cfg.fpxMethods,
    qrMethods: cfg.qrMethods,
    publicKeySource: getEnv().CHIP_PUBLIC_KEY?.trim() ? "env" : "api",
  };
  steps.push({
    label: "Credentials present",
    ok: true,
    detail: `secret key ${cfg.secretKey.length} chars · brand ${cfg.brandId.slice(0, 8)}…`,
  });

  // 1. Do the credentials work at all, and are FPX / DuitNow QR enabled?
  const methods = await fetchChipPaymentMethods(cfg);
  if (methods.error || methods.status >= 300) {
    steps.push({
      label: "Payment methods lookup",
      ok: false,
      detail: `HTTP ${methods.status}${methods.error ? ` · ${methods.error}` : ""}`,
    });
  } else {
    const fpx = cfg.fpxMethods.some((m) => methods.available.includes(m));
    const duitnowQr = cfg.qrMethods.some((m) => methods.available.includes(m));
    result.methods = { available: methods.available, fpx, duitnowQr };
    steps.push({
      label: "Secret key + brand ID accepted",
      ok: true,
      detail: `${methods.available.length} methods available on this brand`,
    });
    steps.push({
      label: "Online banking (FPX) enabled",
      ok: fpx,
      detail: fpx
        ? `whitelist ${cfg.fpxMethods.join(", ")} present`
        : `none of ${cfg.fpxMethods.join(", ")} in: ${methods.available.join(", ") || "(none)"}`,
    });
    steps.push({
      label: "DuitNow QR enabled",
      ok: duitnowQr,
      detail: duitnowQr
        ? `whitelist ${cfg.qrMethods.join(", ")} present`
        : `none of ${cfg.qrMethods.join(", ")} in: ${methods.available.join(", ") || "(none)"}`,
    });
  }

  // 2. Can we verify signed callbacks? (public key must fetch and parse)
  const pem = await getChipPublicKey(cfg, { force: true });
  steps.push({
    label: "Callback public key",
    ok: Boolean(pem),
    detail: pem
      ? `${pem.length} chars, PEM parsed`
      : "GET /public_key/ failed — signed callbacks cannot be verified",
  });

  // 3. Optionally prove a purchase can be created and a checkout URL issued.
  if (opts.createPurchase && methods.status < 300) {
    const base = (opts.baseUrl ?? getEnv().NEXTAUTH_URL ?? "").replace(/\/+$/, "");
    try {
      const created = await createChipPurchase(cfg, {
        amountSen: 1000, // RM 10 — above every method's minimum
        reference: `SELFTEST${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        customerEmail: "selftest@example.com",
        productName: "PERSIS self-test",
        method: "chip_fpx",
        successRedirect: `${base}/settings?payment=chip&selftest=1`,
        failureRedirect: `${base}/settings?payment=chip&selftest=1`,
        successCallback: base ? `${base}/api/payments/chip/callback` : undefined,
      });
      result.purchase = {
        ok: true,
        id: created.id,
        checkoutUrl: created.checkoutUrl,
        status: created.status,
      };
      steps.push({
        label: "Create test purchase",
        ok: true,
        detail: `status ${created.status}${created.callbackOmitted ? " · callback omitted (port)" : ""}`,
      });
    } catch (err) {
      const message = err instanceof ChipError ? err.message : String(err);
      result.purchase = { ok: false, error: message };
      steps.push({ label: "Create test purchase", ok: false, detail: message });
    }
  }

  const failures = steps.filter((s) => !s.ok);
  result.verdict = failures.length === 0
    ? "Chip accepted the credentials and both payment methods are available. Checkout is ready."
    : `${failures.length} check(s) failed — see the details above. Fix those before taking payments.`;
  return result;
}
