import { getEnv } from "@/lib/env";

export interface HybridInput {
  contractorPrice: number | null;
  benchmarkPrice: number | null;
  matchConfidence: number | null;
}

export interface HybridStrategy {
  name: string;
  version: string;
  compute(input: HybridInput): number | null;
}

/**
 * Weighted-average strategy v1: blends contractor and benchmark prices, weighting the
 * contractor price by configured weight adjusted down for low match confidence.
 */
const weightedAverageV1: HybridStrategy = {
  name: "weighted_average",
  version: "1.0.0",
  compute({ contractorPrice, benchmarkPrice, matchConfidence }) {
    if (contractorPrice == null || benchmarkPrice == null) return null;
    const env = getEnv();
    let w = env.PRICE_HYBRID_CONTRACTOR_WEIGHT;
    if (matchConfidence != null && matchConfidence < 0.7) w *= 0.75;
    return Math.round((contractorPrice * w + benchmarkPrice * (1 - w)) * 100) / 100;
  },
};

/** Benchmark-anchored strategy v1: uses benchmark, nudged toward contractor within ±15%. */
const benchmarkAnchoredV1: HybridStrategy = {
  name: "benchmark_anchored",
  version: "1.0.0",
  compute({ contractorPrice, benchmarkPrice }) {
    if (contractorPrice == null || benchmarkPrice == null) return null;
    const lo = benchmarkPrice * 0.85;
    const hi = benchmarkPrice * 1.15;
    const clamped = Math.min(hi, Math.max(lo, contractorPrice));
    return Math.round(((benchmarkPrice + clamped) / 2) * 100) / 100;
  },
};

const STRATEGIES: Record<string, HybridStrategy> = {
  weighted_average: weightedAverageV1,
  benchmark_anchored: benchmarkAnchoredV1,
};

export function getHybridStrategy(name?: string): HybridStrategy {
  const key = name ?? getEnv().PRICE_HYBRID_STRATEGY;
  const strat = STRATEGIES[key];
  if (!strat) throw new Error(`Unknown hybrid pricing strategy: ${key}`);
  return strat;
}
