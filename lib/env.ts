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
  TNG_PROVIDER: z.string().default("mock"),
  TNG_MERCHANT_ID: z.string().optional(),
  TNG_WEBHOOK_SECRET: z.string().optional(),
  TNG_MOCK_AUTO_VERIFY: z.coerce.boolean().default(false),
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
