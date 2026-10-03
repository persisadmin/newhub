import { z } from "zod";

const schema = z.object({
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(16),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("persis"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PRICE_OFF_BENCHMARK_THRESHOLD_PCT: z.coerce.number().default(25),
  PRICE_MATCH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.6),
  PRICE_HYBRID_STRATEGY: z.string().default("weighted_average"),
  PRICE_HYBRID_CONTRACTOR_WEIGHT: z.coerce.number().min(0).max(1).default(0.6),
  UPLOAD_MAX_BYTES: z.coerce.number().default(20 * 1024 * 1024),
  // Object storage (S3 / Cloudflare R2) for durable file persistence across
  // deploys. When S3_BUCKET + credentials are set, files are stored remotely;
  // otherwise the app falls back to local disk (ephemeral on Railway).
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  /** Custom endpoint for S3-compatible stores, e.g. https://<accountid>.r2.cloudflarestorage.com */
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  TNG_PROVIDER: z.string().default("mock"),
  TNG_MERCHANT_ID: z.string().optional(),
  TNG_WEBHOOK_SECRET: z.string().optional(),
  TNG_MOCK_AUTO_VERIFY: z.coerce.boolean().default(false),
  // CHIP In Asia (CHIP Collect) hosted checkout — FPX online banking + DuitNow
  // QR. Active only when both CHIP_SECRET_KEY and CHIP_BRAND_ID are set
  // (merchant portal → Developers → API keys / Brand ID).
  CHIP_SECRET_KEY: z.string().optional(),
  CHIP_BRAND_ID: z.string().optional(),
  /** API base — override only for a sandbox endpoint. Defaults to the live gate. */
  CHIP_BASE_URL: z.string().url().optional(),
  /** Optional PEM used to verify signed callbacks; otherwise fetched + cached from GET /public_key/. */
  CHIP_PUBLIC_KEY: z.string().optional(),
  /** Whitelists (comma-separated) per checkout option. Defaults: fpx / duitnow_qr. */
  CHIP_FPX_METHODS: z.string().optional(),
  CHIP_DUITNOW_METHODS: z.string().optional(),
  PAYHALAL_APP_ID: z.string().optional(),
  /** App key from the dashboard (distinct from app id) — used only in the reconciliation hash. */
  PAYHALAL_APP_KEY: z.string().optional(),
  PAYHALAL_APP_SECRET: z.string().optional(),
  /** Merchant email — required by PayHalal's transaction reconciliation API. */
  PAYHALAL_MERCHANT_ID: z.string().optional(),
  /** Explicit override. When unset, the mode is inferred from the app id prefix (live-… → live). */
  PAYHALAL_MODE: z.enum(["live", "uat"]).optional(),
  // DuitNow QR bridge (phone-notification reconciliation)
  DUITNOW_STATIC_QR: z.string().optional(), // decoded payload of the existing merchant QR
  DUITNOW_ACQUIRER_ID: z.string().optional(),
  DUITNOW_QR_ID: z.string().optional(),
  DUITNOW_MERCHANT_NAME: z.string().optional(),
  DUITNOW_MERCHANT_CITY: z.string().optional(),
  PAYMENT_NOTIFY_SECRET: z.string().optional(), // shared secret for the MacroDroid notify endpoint
  // LLM extraction (Moonshot Kimi). When KIMI_API_KEY is set, BOQ extraction
  // uses Kimi K3 instead of the regex parser; scanned PDFs are OCR'd with K3 vision.
  KIMI_API_KEY: z.string().optional(),
  KIMI_API_BASE: z.string().url().default("https://api.moonshot.ai/v1"),
  KIMI_MODEL: z.string().default("kimi-k3"),
  KIMI_OCR_MAX_PAGES: z.coerce.number().int().positive().default(30),
  KIMI_GENERATE_DOCS: z.coerce.boolean().default(true),
  KIMI_PRICING_ASSIST: z.coerce.boolean().default(true),
  KIMI_PRICING_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  /** Comma-separated emails granted the admin role automatically (OAuth users). */
  ADMIN_EMAILS: z.string().optional(),
  // Transactional email (Resend). When unset, emails are logged server-side only.
  RESEND_API_KEY: z.string().optional(),
  /** Verified sender, e.g. "PERSIS <noreply@persis.my>". Defaults to Resend's onboarding address. */
  EMAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Lazily validated environment — safe to import during build. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Invalid environment configuration: " +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  cached = parsed.data;
  return cached;
}
