import { chat } from "./kimi";
import { parseLlmJson } from "./parse-json";
import { GENERATION_SYSTEM } from "./prompts";
import { logger } from "@/lib/logger";
import { similarity } from "@/lib/domain/pricing/match";

/**
 * LLM pricing assist — Kimi fills the gaps the deterministic engine can't:
 * 1. Semantic matching: picks the correct benchmark from weak Dice candidates
 *    (paraphrase tolerance: "pendaflour 2x36W" vs "fluorescent fitting twin 36W").
 * 2. Rate estimation: suggests a market rate with confidence + reasoning for
 *    items with no price source at all.
 * Both run batched to keep cost/latency bounded. Every LLM-derived price is
 * flagged "llm_estimate" and lands in the review queue — the user decides.
 */

export interface MatchCandidateInput {
  idx: number;
  description: string;
  unit: string;
  price: number;
  source: string;
}

export interface SemanticMatchInput {
  key: string;
  description: string;
  unit: string | null;
  candidates: MatchCandidateInput[];
}

export interface SemanticMatchDecision {
  key: string;
  chosenIdx: number | null;
  confidence: number;
  reasoning: string;
}

export interface RateEstimateInput {
  key: string;
  description: string;
  unit: string | null;
  category: string;
  quantity: number | null;
}

export interface RateEstimate {
  key: string;
  suggestedRateRM: number | null;
  confidence: number;
  reasoning: string;
}

export interface PricingContext {
  projectType?: string | null;
  workTrades?: string[];
  region?: string | null;
}

const MATCH_SYSTEM = `${GENERATION_SYSTEM}

You are now doing price-reference matching for a Malaysian construction BOQ item.
You will be given an item and a shortlist of reference prices. Pick the reference that describes the SAME item/work, or null if none match. Favour identical scope, spec and unit. Convertible units (m ↔ btg/length) are acceptable only if the description matches exactly.`;

export async function assistSemanticMatches(
  batch: SemanticMatchInput[]
): Promise<SemanticMatchDecision[]> {
  if (batch.length === 0) return [];
  const payload = batch.map((b) => ({
    key: b.key,
    item: `${b.description}${b.unit ? ` [unit: ${b.unit}]` : ""}`,
    candidates: b.candidates.map((c) => ({
      idx: c.idx,
      ref: `${c.description} [unit: ${c.unit}] RM${c.price} (${c.source})`,
    })),
  }));
  const raw = await chat(
    [
      { role: "system", content: MATCH_SYSTEM },
      {
        role: "user",
        content: `For each item, choose the idx of the matching reference or null.\n\n${JSON.stringify(payload, null, 1)}\n\nReturn ONLY a JSON array: [{"key":"...","chosenIdx":number|null,"confidence":0.0,"reasoning":"one line"}]`,
      },
    ],
    4000,
    "pricing-match"
  );
  const parsed = parseLlmJson(raw);
  if (!Array.isArray(parsed)) return [];
  return (parsed as Array<Record<string, unknown>>).map((d) => ({
    key: String(d.key ?? ""),
    chosenIdx: typeof d.chosenIdx === "number" ? d.chosenIdx : null,
    confidence: typeof d.confidence === "number" ? d.confidence : 0,
    reasoning: String(d.reasoning ?? ""),
  }));
}

const ESTIMATE_SYSTEM = `${GENERATION_SYSTEM}

You are now estimating Malaysian construction market rates (MYR) for BOQ items that have no matched reference price.
Base estimates on typical 2025-2026 Malaysian market rates (JKR JKH schedules, CIDB BCISM, supplier quotes). State a confidence 0-1 and one-line reasoning. If you cannot estimate reliably, return null.`;

export async function assistRateEstimates(
  batch: RateEstimateInput[],
  context: PricingContext
): Promise<RateEstimate[]> {
  if (batch.length === 0) return [];
  const payload = batch.map((b) => ({
    key: b.key,
    item: `${b.description}${b.unit ? ` [unit: ${b.unit}]` : ""}`,
    category: b.category,
    quantity: b.quantity,
  }));
  const raw = await chat(
    [
      { role: "system", content: ESTIMATE_SYSTEM },
      {
        role: "user",
        content: `PROJECT CONTEXT: ${context.projectType ?? "construction"} | Trades: ${(context.workTrades ?? []).join(", ") || "general"} | Region: ${context.region ?? "Peninsular Malaysia"}\n\nEstimate a unit rate (RM) for each item, in the item's stated unit.\n\n${JSON.stringify(payload, null, 1)}\n\nReturn ONLY a JSON array: [{"key":"...","suggestedRateRM":number|null,"confidence":0.0,"reasoning":"one line"}]`,
      },
    ],
    4000,
    "pricing-estimate"
  );
  const parsed = parseLlmJson(raw);
  if (!Array.isArray(parsed)) return [];
  return (parsed as Array<Record<string, unknown>>).map((d) => ({
    key: String(d.key ?? ""),
    suggestedRateRM: typeof d.suggestedRateRM === "number" && d.suggestedRateRM > 0 ? d.suggestedRateRM : null,
    confidence: typeof d.confidence === "number" ? d.confidence : 0,
    reasoning: String(d.reasoning ?? ""),
  }));
}

/** Top-N benchmark candidates by Dice similarity (deterministic pre-filter for the LLM). */
export function topCandidates(
  query: string,
  candidates: Array<{ normalisedDescription: string }>,
  n: number,
  minScore = 0.15
): Array<{ idx: number; score: number }> {
  return candidates
    .map((c, idx) => ({ idx, score: similarity(query, c.normalisedDescription) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function logAssist(summary: string, extra?: Record<string, unknown>) {
  logger.info("pricing.assist", { summary, ...extra });
}
