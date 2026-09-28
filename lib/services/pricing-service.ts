import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { bestMatch } from "@/lib/domain/pricing/match";
import { convertUnitPrice } from "@/lib/domain/pricing/normalise";
import { getHybridStrategy } from "@/lib/domain/pricing/hybrid";
import { selectPrice } from "@/lib/domain/pricing/waterfall";
import { adjustmentPct } from "@/lib/regions";
import { isLlmConfigured, getLlmFeatures } from "@/lib/services/llm/kimi";
import {
  assistSemanticMatches,
  assistRateEstimates,
  chunk,
  topCandidates,
  type SemanticMatchInput,
  type SemanticMatchDecision,
  type RateEstimate,
} from "@/lib/services/llm/pricing-assist";
import { logger } from "@/lib/logger";
import type {
  BenchmarkPriceDoc,
  ContractorPriceDoc,
  PricingRecordDoc,
} from "@/lib/domain/types";
import type { NormalisedItem } from "./extraction";

export interface PriceResult {
  record: Omit<PricingRecordDoc, "_id" | "createdAt" | "updatedAt">;
  allFlags: (string | null)[];
}

/** Price a single normalised BOQ item against contractor + benchmark sources. */
export async function priceItem(
  userId: ObjectId,
  projectId: ObjectId,
  itemId: ObjectId,
  item: NormalisedItem,
  regionAdjustmentPct: number | null = null
): Promise<PriceResult> {
  await ensureIndexes();
  const db = await getDb();
  const env = getEnv();

  // --- Contractor price lookup (user's own price library, best fuzzy match) ---
  const contractorCandidates = await db
    .collection<ContractorPriceDoc>("contractor_prices")
    .find({ userId })
    .limit(5000)
    .toArray();
  let contractorPrice: number | null = null;
  let contractorPriceSource: string | null = null;
  let contractorConfidence: number | null = null;

  const cMatch = bestMatch(item.normalisedDescription, contractorCandidates, 0.5);
  if (cMatch) {
    const converted = convertUnitPrice(
      cMatch.record.price,
      cMatch.record.normalisedUnit,
      item.normalisedUnit
    );
    if (converted != null) {
      contractorPrice = Math.round(converted * 100) / 100;
      contractorPriceSource = cMatch.record.source || "contractor_library";
      contractorConfidence = cMatch.confidence;
    }
  }

  // --- Benchmark price lookup ---
  const benchmarkCandidates = await db
    .collection<BenchmarkPriceDoc>("benchmark_prices")
    .find({})
    .limit(10000)
    .toArray();
  let benchmarkPrice: number | null = null;
  let benchmarkPriceSource: string | null = null;
  let benchmarkConfidence: number | null = null;
  let unitMismatch = false;

  const bMatch = bestMatch(item.normalisedDescription, benchmarkCandidates, 0.4);
  if (bMatch) {
    const converted = convertUnitPrice(
      bMatch.record.price,
      bMatch.record.normalisedUnit,
      item.normalisedUnit
    );
    if (converted == null) {
      unitMismatch = true;
    } else {
      let adjusted = converted;
      if (regionAdjustmentPct != null && regionAdjustmentPct > 0) {
        adjusted = converted * (1 + regionAdjustmentPct / 100);
      }
      benchmarkPrice = Math.round(adjusted * 100) / 100;
      benchmarkPriceSource = `${bMatch.record.source}${bMatch.record.sourceRef ? ` (${bMatch.record.sourceRef})` : ""}${regionAdjustmentPct ? ` +${regionAdjustmentPct}% kawasan` : ""}`;
      benchmarkConfidence = bMatch.confidence;
    }
  }

  const matchConfidence = Math.max(contractorConfidence ?? 0, benchmarkConfidence ?? 0) || null;

  // --- Hybrid price (configurable, versioned strategy) ---
  const strategy = getHybridStrategy();
  const hybridPrice = strategy.compute({ contractorPrice, benchmarkPrice, matchConfidence });

  // --- Selection waterfall + flags ---
  const result = selectPrice({
    contractorPrice,
    benchmarkPrice,
    hybridPrice,
    matchConfidence,
    unitMismatch,
  });

  const record: Omit<PricingRecordDoc, "_id" | "createdAt" | "updatedAt"> = {
    itemId,
    projectId,
    description: item.description,
    normalisedDescription: item.normalisedDescription,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    normalisedUnit: item.normalisedUnit,
    contractorPrice,
    contractorPriceSource,
    benchmarkPrice,
    benchmarkPriceSource,
    hybridPrice,
    selectedPrice: result.selectedPrice,
    selectedPriceSource: result.selectedPriceSource,
    matchConfidence,
    regionAdjustmentPct,
    reviewFlag: result.reviewFlag,
    version: 1,
  };

  return { record, allFlags: result.flags };
}

/** Re-price every BOQ item in a project (used by the pipeline). */
export async function priceProject(userId: ObjectId, projectId: ObjectId): Promise<{ priced: number; flagged: number }> {
  const db = await getDb();
  const project = await db.collection<{
    regionState?: string; regionDistrict?: string; regionKumpulan?: "A" | "B" | "C" | "D";
    tenderCategory?: string;
  }>("projects").findOne({ _id: projectId });
  const pct = adjustmentPct(project?.regionState, project?.regionDistrict, project?.regionKumpulan);
  const items = await db.collection("boq_items").find({ projectId }).toArray();
  let priced = 0;
  let flagged = 0;
  for (const item of items) {
    const { record } = await priceItem(userId, projectId, item._id, {
      itemNo: item.itemNo,
      description: item.description,
      normalisedDescription: item.normalisedDescription,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      normalisedUnit: item.normalisedUnit,
    }, pct);
    await db.collection<PricingRecordDoc>("pricing_records").updateOne(
      { itemId: item._id },
      {
        $set: { ...record, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    priced += 1;
    if (record.reviewFlag) flagged += 1;
  }

  // --- LLM pricing assist: fill gaps the deterministic engine couldn't ---
  const llmFeatures = await getLlmFeatures();
  if (llmFeatures.pricingAssist && (await isLlmConfigured())) {
    try {
      flagged = await applyLlmAssist(db, projectId, pct, {
        projectType: project?.tenderCategory,
        region: project?.regionState,
      });
    } catch (err) {
      logger.warn("pricing.assist_failed", { projectId: projectId.toString(), error: String(err) });
    }
  }
  return { priced, flagged };
}

interface AssistRecord extends PricingRecordDoc {
  normalisedDescription: string;
}

/**
 * Post-pass over pricing records: semantic benchmark matching for unmatched
 * items, then LLM rate estimation for still-unpriced ones. LLM-derived prices
 * are selected provisionally with flag "llm_estimate" and always reviewable.
 */
async function applyLlmAssist(
  db: Awaited<ReturnType<typeof getDb>>,
  projectId: ObjectId,
  pct: number | null,
  context: { projectType?: string | null; region?: string | null }
): Promise<number> {
  const records = await db.collection<AssistRecord>("pricing_records").find({ projectId }).toArray();
  const targets = records.filter(
    (r) => r.reviewFlag === "missing_price" || r.reviewFlag === "low_match_confidence" || r.reviewFlag === "unit_mismatch"
  );
  if (targets.length === 0) return records.filter((r) => r.reviewFlag).length;

  const benchmarks = await db.collection<BenchmarkPriceDoc>("benchmark_prices").find({}).limit(10000).toArray();
  const batchSize = (await getLlmFeatures()).pricingBatchSize;
  const keyOf = (r: AssistRecord) => r.itemId.toString();

  // 1) Semantic match against top-Dice benchmark candidates
  const matchInputs: SemanticMatchInput[] = [];
  const candidatesByKey = new Map<string, BenchmarkPriceDoc[]>();
  for (const r of targets) {
    const tops = topCandidates(r.normalisedDescription, benchmarks, 5);
    if (!tops.length) continue;
    const cands = tops.map((t) => benchmarks[t.idx]);
    candidatesByKey.set(keyOf(r), cands);
    matchInputs.push({
      key: keyOf(r),
      description: r.description,
      unit: r.unit,
      candidates: cands.map((c, i) => ({
        idx: i,
        description: c.description,
        unit: c.unit,
        price: c.price,
        source: c.source,
      })),
    });
  }

  // Items without any candidate go straight to estimation
  const inputKeys = new Set(matchInputs.map((m) => m.key));
  const stillMissing: AssistRecord[] = targets.filter((r) => !inputKeys.has(keyOf(r)));
  for (const batch of chunk(matchInputs, batchSize)) {
    let decisions: SemanticMatchDecision[] = [];
    try {
      decisions = await assistSemanticMatches(batch);
    } catch (err) {
      logger.warn("pricing.match_batch_failed", { error: String(err) });
    }
    const byKey = new Map(decisions.map((d) => [d.key, d]));
    for (const r of targets) {
      const decision = byKey.get(keyOf(r));
      const cands = candidatesByKey.get(keyOf(r));
      if (!decision || !cands) { if (!stillMissing.includes(r)) stillMissing.push(r); continue; }
      const chosen = decision.chosenIdx != null ? cands[decision.chosenIdx] : null;
      const converted = chosen
        ? convertUnitPrice(chosen.price, chosen.normalisedUnit, r.normalisedUnit)
        : null;
      if (!chosen || converted == null) { stillMissing.push(r); continue; }

      let adjusted = converted;
      if (pct != null && pct > 0) adjusted = converted * (1 + pct / 100);
      const benchmarkPrice = Math.round(adjusted * 100) / 100;
      const llmConfidence = decision.confidence;
      const matchConfidence = Math.max(r.matchConfidence ?? 0, llmConfidence) || llmConfidence;

      // Re-run waterfall with the LLM-found benchmark
      const strategy = getHybridStrategy();
      const hybridPrice = strategy.compute({
        contractorPrice: r.contractorPrice,
        benchmarkPrice,
        matchConfidence,
      });
      const result = selectPrice({
        contractorPrice: r.contractorPrice,
        benchmarkPrice,
        hybridPrice,
        matchConfidence,
        unitMismatch: false,
      });

      await db.collection<PricingRecordDoc>("pricing_records").updateOne(
        { _id: r._id },
        {
          $set: {
            benchmarkPrice,
            benchmarkPriceSource: `${chosen.source}${chosen.sourceRef ? ` (${chosen.sourceRef})` : ""} (AI-matched)${pct ? ` +${pct}% kawasan` : ""}`,
            hybridPrice,
            selectedPrice: result.selectedPrice,
            selectedPriceSource: result.selectedPriceSource,
            matchConfidence,
            reviewFlag: result.reviewFlag,
            llmMatched: true,
            llmConfidence,
            llmReasoning: decision.reasoning,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  // 2) Rate estimation for items still without any price
  const toEstimate = stillMissing.filter((r) => r.selectedPrice == null);
  for (const batch of chunk(toEstimate, batchSize)) {
    let estimates: RateEstimate[] = [];
    try {
      estimates = await assistRateEstimates(
        batch.map((r) => ({
          key: keyOf(r),
          description: r.description,
          unit: r.unit,
          category: r.category,
          quantity: r.quantity,
        })),
        { projectType: context.projectType, region: context.region }
      );
    } catch (err) {
      logger.warn("pricing.estimate_batch_failed", { error: String(err) });
    }
    const byKey = new Map(estimates.map((e) => [e.key, e]));
    for (const r of batch) {
      const est = byKey.get(keyOf(r));
      if (!est || est.suggestedRateRM == null) continue;
      await db.collection<PricingRecordDoc>("pricing_records").updateOne(
        { _id: r._id },
        {
          $set: {
            llmSuggestedPrice: Math.round(est.suggestedRateRM * 100) / 100,
            llmConfidence: est.confidence,
            llmReasoning: est.reasoning,
            // Provisional selection — always flagged for human review
            selectedPrice: Math.round(est.suggestedRateRM * 100) / 100,
            selectedPriceSource: "llm_estimate",
            reviewFlag: "llm_estimate",
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  const finalRecords = await db.collection<PricingRecordDoc>("pricing_records").find({ projectId }).toArray();
  return finalRecords.filter((r) => r.reviewFlag).length;
}
