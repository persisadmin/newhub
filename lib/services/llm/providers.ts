import { logger } from "@/lib/logger";
import { getProviderChain, type ProviderConfig } from "./settings";

/**
 * Multi-provider failover engine. All supported providers expose an
 * OpenAI-compatible /chat/completions endpoint, so one implementation drives
 * Kimi, DeepSeek, Qwen and Gemini alike.
 *
 * Chain semantics (per request):
 *   - Providers are tried in configured order.
 *   - Transient errors (rate limit, 5xx, network) retry in place with backoff.
 *   - Quota-exhaustion signals (insufficient balance / quota / credit) fail
 *     over to the next provider immediately — this is the Model1→Model2→Model3
 *     handover the admin settings page configures.
 *   - A provider that fails 3 consecutive times is circuit-broken for 5 minutes.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export interface ChatOptions {
  /** Set when the request includes images (OCR) — only vision-capable providers are used. */
  vision?: boolean;
}

const TIMEOUT_MS = 240_000;
const MAX_IN_PLACE_RETRIES = 3;
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_MS = 5 * 60_000;

interface CircuitState {
  consecutiveFailures: number;
  brokenUntil: number;
}
const circuit = new Map<string, CircuitState>();

/** True when at least one provider in the chain is usable. */
export async function isLlmConfigured(): Promise<boolean> {
  return (await getProviderChain()).length > 0;
}

/** Signals "this provider is out of quota/money" — fail over, don't retry. */
function isQuotaExhausted(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 429 && /insufficient|quota|balance|exhaust|credit|limit/i.test(body)) return true;
  return /insufficient (user )?balance|quota exhausted|account (is )?(deactivated|suspended|in arrears)|no remaining credit/i.test(body);
}

function isTransient(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function recordFailure(id: string) {
  const s = circuit.get(id) ?? { consecutiveFailures: 0, brokenUntil: 0 };
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) s.brokenUntil = Date.now() + CIRCUIT_BREAK_MS;
  circuit.set(id, s);
}

function recordSuccess(id: string) {
  circuit.delete(id);
}

function isBroken(id: string): boolean {
  const s = circuit.get(id);
  if (!s) return false;
  if (s.brokenUntil > Date.now()) return true;
  if (s.brokenUntil !== 0 && s.brokenUntil <= Date.now()) circuit.delete(id); // healed
  return false;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

async function callProvider(
  provider: ProviderConfig,
  messages: ChatMessage[],
  maxTokens: number
): Promise<{ text: string; usage: RawUsage | null; returnedModel: string | null }> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: provider.model, messages, max_completion_tokens: maxTokens }),
      signal: controller.signal,
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw Object.assign(new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`), {
        status: res.status,
        quotaExhausted: isQuotaExhausted(res.status, bodyText),
        transient: isTransient(res.status),
      });
    }
    const data = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: RawUsage;
      model?: string;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty content in provider response");
    return { text, usage: data.usage ?? null, returnedModel: data.model ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a chat request through the provider failover chain.
 * Throws only when every provider in the chain has failed.
 */
export async function chat(messages: ChatMessage[], maxTokens: number, task = "llm", opts: ChatOptions = {}): Promise<string> {
  const chain = await getProviderChain(opts.vision ?? false);
  if (chain.length === 0) {
    throw new Error(
      opts.vision
        ? "No vision-capable LLM provider is configured. Add API keys in Admin → LLM Settings."
        : "No LLM provider is configured. Add API keys in Admin → LLM Settings."
    );
  }

  const errors: string[] = [];
  for (const provider of chain) {
    if (isBroken(provider.id)) {
      errors.push(`${provider.name}: circuit-broken`);
      continue;
    }
    let failover = false;
    for (let attempt = 0; attempt < MAX_IN_PLACE_RETRIES; attempt++) {
      try {
        const started = Date.now();
        const { text, usage, returnedModel } = await callProvider(provider, messages, maxTokens);
        recordSuccess(provider.id);
        logger.info("llm.usage", {
          task,
          provider: provider.name,
          model: provider.model,
          returnedModel,
          latencyMs: Date.now() - started,
          input: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
          output: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
        });
        return text;
      } catch (err) {
        const e = err as Error & { status?: number; quotaExhausted?: boolean; transient?: boolean };
        if (e.quotaExhausted) {
          logger.warn("llm.quota_failover", { provider: provider.name, task, error: e.message.slice(0, 200) });
          failover = true;
          break; // next provider
        }
        const transient = e.transient ?? true; // network/abort errors are transient by default
        if (attempt < MAX_IN_PLACE_RETRIES - 1 && transient) {
          logger.warn("llm.retry", { provider: provider.name, task, attempt, error: e.message.slice(0, 160) });
          await sleep(1500 * (attempt + 1));
          continue;
        }
        recordFailure(provider.id);
        errors.push(`${provider.name}: ${e.message.slice(0, 160)}`);
        break;
      }
    }
    if (failover) continue;
  }
  throw new Error(`All LLM providers failed [${errors.join(" | ")}]`);
}

/** Direct call to ONE provider (admin connectivity test). Returns the reply or throws. */
export async function testProvider(provider: ProviderConfig): Promise<{ reply: string; latencyMs: number; returnedModel: string | null }> {
  const started = Date.now();
  const { text, returnedModel } = await callProvider(provider, [
    { role: "user", content: "Reply with the single word: ok" },
  ], 16);
  return { reply: text, latencyMs: Date.now() - started, returnedModel };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
