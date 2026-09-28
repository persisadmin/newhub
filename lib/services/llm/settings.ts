import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Admin-managed LLM configuration. Stored in the `settings` collection so it
 * can be changed at runtime (no redeploy). First read seeds from environment
 * variables; the admin settings page then owns it.
 *
 * Providers are an ORDERED failover chain: provider[0] serves all requests
 * until its quota is exhausted or it errors out, then provider[1] takes over,
 * then provider[2], and so on.
 */

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** Empty string = not configured (skipped). */
  apiKey: string;
  enabled: boolean;
  /** Whether the model accepts image input (required for OCR). */
  vision: boolean;
}

export interface LlmFeatures {
  generateDocs: boolean;
  pricingAssist: boolean;
  ocrMaxPages: number;
  pricingBatchSize: number;
}

export interface LlmSettings {
  providers: ProviderConfig[];
  features: LlmFeatures;
}

const SETTINGS_ID = "llm";
const CACHE_TTL_MS = 30_000;

let cache: { value: LlmSettings; loadedAt: number } | null = null;

function envSeed(): LlmSettings {
  const env = getEnv();
  const providers: ProviderConfig[] = [];
  if (env.KIMI_API_KEY) {
    providers.push({
      id: "kimi",
      name: "Moonshot Kimi",
      baseUrl: env.KIMI_API_BASE,
      model: env.KIMI_MODEL,
      apiKey: env.KIMI_API_KEY,
      enabled: true,
      vision: true,
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    providers.push({
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      apiKey: process.env.DEEPSEEK_API_KEY,
      enabled: true,
      vision: true, // DeepSeek-V4.1 Flash reads images natively
    });
  }
  if (process.env.DASHSCOPE_API_KEY) {
    providers.push({
      id: "qwen",
      name: "Qwen (DashScope)",
      baseUrl: process.env.DASHSCOPE_API_BASE || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      model: process.env.DASHSCOPE_MODEL || "qwen3-coder-plus",
      apiKey: process.env.DASHSCOPE_API_KEY,
      enabled: true,
      vision: false, // qwen3-coder is text-only; excluded from OCR automatically
    });
  }
  if (process.env.GEMINI_API_KEY) {
    providers.push({
      id: "gemini",
      name: "Google Gemini",
      baseUrl: process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      apiKey: process.env.GEMINI_API_KEY,
      enabled: true,
      vision: true,
    });
  }
  return {
    providers,
    features: {
      generateDocs: env.KIMI_GENERATE_DOCS,
      pricingAssist: env.KIMI_PRICING_ASSIST,
      ocrMaxPages: env.KIMI_OCR_MAX_PAGES,
      pricingBatchSize: env.KIMI_PRICING_BATCH_SIZE,
    },
  };
}

export async function getLlmSettings(): Promise<LlmSettings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  const db = await getDb();
  const doc = await db.collection<LlmSettings>("settings").findOne({ _id: SETTINGS_ID as never });
  if (doc) {
    cache = { value: doc, loadedAt: Date.now() };
    return doc;
  }
  // First boot: seed from env and persist so the admin page always has a doc.
  const seeded = envSeed();
  try {
    await db.collection("settings").updateOne(
      { _id: SETTINGS_ID as never },
      { $setOnInsert: { ...seeded } },
      { upsert: true }
    );
  } catch (err) {
    logger.warn("llm.settings_seed_failed", { error: String(err) });
  }
  cache = { value: seeded, loadedAt: Date.now() };
  return seeded;
}

export function invalidateLlmSettingsCache() {
  cache = null;
}

/** Ordered, usable chain. Pass vision=true to keep only vision-capable providers. */
export async function getProviderChain(vision = false): Promise<ProviderConfig[]> {
  const s = await getLlmSettings();
  return s.providers.filter((p) => p.enabled && p.apiKey && (!vision || p.vision));
}

export async function getLlmFeatures(): Promise<LlmFeatures> {
  const s = await getLlmSettings();
  return s.features;
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  const db = await getDb();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { providers: settings.providers, features: settings.features, updatedAt: new Date() } },
    { upsert: true }
  );
  invalidateLlmSettingsCache();
}
