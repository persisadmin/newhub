import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { bestMatch } from "@/lib/domain/pricing/match";
import { convertUnitPrice } from "@/lib/domain/pricing/normalise";
import { getHybridStrategy } from "@/lib/domain/pricing/hybrid";
import { selectPrice } from "@/lib/domain/pricing/waterfall";
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
  item: NormalisedItem
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
      benchmarkPrice = Math.round(converted * 100) / 100;
      benchmarkPriceSource = `${bMatch.record.source}${bMatch.record.sourceRef ? ` (${bMatch.record.sourceRef})` : ""}`;
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
    reviewFlag: result.reviewFlag,
    version: 1,
  };

  return { record, allFlags: result.flags };
}

/** Re-price every BOQ item in a project (used by the pipeline). */
export async function priceProject(userId: ObjectId, projectId: ObjectId): Promise<{ priced: number; flagged: number }> {
  const db = await getDb();
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
    });
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
  return { priced, flagged };
}
