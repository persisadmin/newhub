import type { BoqItemDoc } from "@/lib/domain/types";
import { parseBoqLinesWithStats } from "@/lib/services/extraction";

/**
 * Gate 2 — post-extraction quality score.
 *
 * No single parameter decides: a small genuine tender may have few items but
 * still be real work, while a boilerplate-heavy tender can yield many junk
 * items. A weighted combination flags a DEGENERATE result — one where what was
 * extracted is clearly not a usable bill of quantities (the Kajang lump-sum
 * case: 3 items, all "other", all admin phrases like "Adjustment of Contract").
 *
 * Weights are deliberately documented and easy to tune once seen on real
 * tenders. The score is 0–100; below DEGENERATE_THRESHOLD we treat the output
 * as not chargeable.
 */

export interface QualityInput {
  items: Array<Pick<BoqItemDoc, "description" | "category" | "quantity" | "unit">>;
  /** Source document text, used for priced-content density. */
  sourceText: string;
}

export interface QualityScore {
  score: number; // 0–100, higher is better
  degenerate: boolean;
  reasons: string[];
  breakdown: Record<string, number>;
}

const DEGENERATE_THRESHOLD = 40;

// Physical units that indicate real measured work.
const PHYSICAL_UNIT =
  /^(m2|m3|m²|m³|m|mm|cm|km|kg|g|t|ton|tonne|l|litre|no|nr|set|pc|pcs|unit|pair|pr|day|hari|hr|hour|trip|roll|bag|sheet|point|pt|kw|hp|length|lot)$/i;
// "Catch-all" units that dominate when the extractor grabbed admin clauses.
const CATCHALL_UNIT = /^(sum|ls|lot|item|p\.s\.|psum)$/i;
// Admin/conditions phrasing that is not physical work.
const ADMIN_DESC =
  /performance bond|performance guarantee|adjustment of contract|contract$|insurance|takaful|defect liability|retention|liquidated|damages|penalty|bon pelaksanaan|surat akuan|akuan|declaration|perisytiharan|pelawaan tender|tender form|borang|arahan kepada/i;
// Real-work signal words (English + Malay).
const WORK_DESC =
  /supply|lay|install|construct|excavat|concrete|formwork|reinforc|brick|block|plaster|paint|til|roof|door|window|glaz|pipe|drain|road|pav|premix|bitumin|asphalt|mill|surfac|marking|kerb|earthwork|backfill|compact|bekal|pasang|bina|korek|konkrit|cat|jalan|longkang|menurap|turap|tanah|paip|atap|pintu|tingkap|simen| Bata|kerja/i;

function scoreItems(items: QualityInput["items"]) {
  const total = items.length;
  if (total === 0) {
    return { total, otherRatio: 1, adminRatio: 1, workRatio: 0, physicalUnitRatio: 0, catchallRatio: 1, quantityCoverage: 0, categoryDiversity: 0 };
  }
  const cats = new Set<string>();
  let other = 0, admin = 0, work = 0, physical = 0, catchall = 0, withQty = 0;
  for (const it of items) {
    const cat = (it.category ?? "other").toLowerCase();
    cats.add(cat);
    if (cat === "other") other++;
    const desc = it.description ?? "";
    if (ADMIN_DESC.test(desc)) admin++;
    if (WORK_DESC.test(desc)) work++;
    const unit = (it.unit ?? "").toLowerCase().trim();
    if (unit && PHYSICAL_UNIT.test(unit)) physical++;
    if (unit && CATCHALL_UNIT.test(unit)) catchall++;
    if (typeof it.quantity === "number" && isFinite(it.quantity) && it.quantity > 0) withQty++;
  }
  return {
    total,
    otherRatio: other / total,
    adminRatio: admin / total,
    workRatio: work / total,
    physicalUnitRatio: physical / total,
    catchallRatio: catchall / total,
    quantityCoverage: withQty / total,
    categoryDiversity: cats.size,
  };
}

export function scoreBoqQuality(input: QualityInput): QualityScore {
  const m = scoreItems(input.items);
  const reasons: string[] = [];
  const breakdown: Record<string, number> = {};

  // Priced-content density of the source document.
  const nonEmpty = input.sourceText.split(/\r?\n/).filter((l) => l.trim().length > 0).length || 1;
  const pricedRows = parseBoqLinesWithStats(input.sourceText).items.length;
  const pricedDensity = pricedRows / nonEmpty;

  // --- Weighted sub-scores (each 0–100 contribution capped) ---

  // Item count: full marks at >=20 items, tapering to 0 at 0.
  const countScore = Math.min(1, m.total / 20) * 100;
  breakdown.count = Math.round(countScore);
  if (m.total < 5) reasons.push(`only ${m.total} item(s) were extracted`);

  // Work-vs-admin specificity: real work language minus admin language.
  const specificity = Math.max(0, m.workRatio - m.adminRatio) * 100;
  breakdown.specificity = Math.round(specificity);
  if (m.adminRatio > 0.4) reasons.push("most extracted lines are administrative clauses, not physical work");

  // "other" category dominance.
  const categoryScore = (1 - m.otherRatio) * 100;
  breakdown.category = Math.round(categoryScore);
  if (m.otherRatio > 0.6) reasons.push("items are not categorised into recognisable trades");

  // Unit sanity: physical units good, catch-all dominance bad.
  const unitScore = Math.max(0, m.physicalUnitRatio - m.catchallRatio * 0.5) * 100;
  breakdown.units = Math.round(unitScore);
  if (m.catchallRatio > 0.6) reasons.push('most units are generic ("sum"/"lot") rather than physical measurements');

  // Quantity coverage.
  const qtyScore = m.quantityCoverage * 100;
  breakdown.quantity = Math.round(qtyScore);
  if (m.quantityCoverage < 0.5) reasons.push("few items have a usable quantity");

  // Priced-content density of the source: full marks at >=2% priced rows.
  const densityScore = Math.min(1, pricedDensity / 0.02) * 100;
  breakdown.density = Math.round(densityScore);
  if (pricedDensity < 0.005) reasons.push("the document contains almost no priced line items");

  // Weighted composite.
  const score = Math.round(
    countScore * 0.15 +
      specificity * 0.25 +
      categoryScore * 0.15 +
      unitScore * 0.15 +
      qtyScore * 0.10 +
      densityScore * 0.20
  );

  return {
    score,
    degenerate: score < DEGENERATE_THRESHOLD,
    reasons,
    breakdown,
  };
}
