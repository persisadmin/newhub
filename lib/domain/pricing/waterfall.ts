import type { ReviewFlag } from "../types";
import { getEnv } from "@/lib/env";

export interface WaterfallInput {
  contractorPrice: number | null;
  benchmarkPrice: number | null;
  hybridPrice: number | null;
  matchConfidence: number | null;
  unitMismatch: boolean;
}

export interface WaterfallResult {
  selectedPrice: number | null;
  selectedPriceSource: "contractor" | "benchmark" | "hybrid" | "manual" | null;
  reviewFlag: ReviewFlag;
  flags: ReviewFlag[];
}

/**
 * Price-selection waterfall (Section 9 of the spec) plus automatic review flags.
 * Selected price is architecturally separate from all source prices.
 */
export function selectPrice(input: WaterfallInput): WaterfallResult {
  const env = getEnv();
  const flags: ReviewFlag[] = [];

  let selectedPrice: number | null = null;
  let selectedPriceSource: WaterfallResult["selectedPriceSource"] = null;

  if (input.contractorPrice != null) {
    selectedPrice = input.contractorPrice;
    selectedPriceSource = "contractor";
  } else if (input.benchmarkPrice != null) {
    selectedPrice = input.benchmarkPrice;
    selectedPriceSource = "benchmark";
  } else {
    flags.push("missing_price");
  }

  if (
    input.contractorPrice != null &&
    input.benchmarkPrice != null &&
    input.benchmarkPrice > 0
  ) {
    const deviation =
      Math.abs(input.contractorPrice - input.benchmarkPrice) / input.benchmarkPrice;
    if (deviation * 100 > env.PRICE_OFF_BENCHMARK_THRESHOLD_PCT) flags.push("off_benchmark");
  }

  if (input.matchConfidence != null && input.matchConfidence < env.PRICE_MATCH_CONFIDENCE_THRESHOLD) {
    flags.push("low_match_confidence");
  }

  if (input.unitMismatch) flags.push("unit_mismatch");

  return {
    selectedPrice,
    selectedPriceSource,
    reviewFlag: flags[0] ?? null,
    flags,
  };
}
