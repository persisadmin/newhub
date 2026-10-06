import { parseBoqLinesWithStats } from "@/lib/services/extraction";

/**
 * Gate 1 — pre-charge document classification.
 *
 * Cheap, rule-based, no LLM: decides what KIND of tender document this is so
 * the pipeline can route it correctly BEFORE any credit is spent. The Kajang
 * lump-sum failure was caused by treating a lump-sum tender (no measured BOQ)
 * as if it had one — this classifier exists to catch that up front.
 */

export type TenderDocType =
  | "measured_boq"      // has a priced/quantified works schedule — happy path
  | "lumpsum"           // lump-sum tender: scope + spec, no priced quantities
  | "schedule_of_rates" // pre-priced schedule; tenderer applies a % adjustment
  | "unreadable";       // too little text / can't tell

export interface TenderClassification {
  type: TenderDocType;
  /** 0–1 rough confidence, surfaced for logging/tuning. */
  confidence: number;
  /** Human-readable explanation shown to the user when relevant. */
  reason: string;
  /** Raw signals, for logging and Gate-2 corroboration. */
  signals: {
    boqRowsFound: number;
    lumpsumKeywordHits: number;
    scheduleKeywordHits: number;
    pricedDensity: number; // priced-looking rows / non-empty lines
    textLength: number;
  };
}

const LUMPSUM_RE =
  /lump\s*sum|jumlah\s+wang\s+pukal|wang\s+pukal|harga\s+pukal|ringkasan\s+tawaran|ringkasan\s+tender|lump-?sum/gi;
const SCHEDULE_RE =
  /schedule\s+of\s+rates|jadual\s+kadar\s+harga|kadar\s+harga|senarai\s+kadar|percentage\s+increase|peratusan\s+kenaikan|schedule\s+of\s+dayworks/gi;

const MIN_TEXT = 200;

export function classifyTenderDocument(text: string): TenderClassification {
  const textLength = text.length;
  const trimmed = text.trim();

  if (trimmed.length < MIN_TEXT) {
    return {
      type: "unreadable",
      confidence: 0.9,
      reason: "The document has too little extractable text to analyse (it may be scanned images).",
      signals: { boqRowsFound: 0, lumpsumKeywordHits: 0, scheduleKeywordHits: 0, pricedDensity: 0, textLength },
    };
  }

  // Signal 1: measured-BOQ rows (qty + unit patterns).
  const { items } = parseBoqLinesWithStats(text);
  const boqRowsFound = items.length;

  // Signal 2: keyword families.
  const lumpsumKeywordHits = (text.match(LUMPSUM_RE) ?? []).length;
  const scheduleKeywordHits = (text.match(SCHEDULE_RE) ?? []).length;

  // Signal 3: priced-content density — priced-looking rows as a share of real lines.
  const nonEmptyLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length || 1;
  const pricedDensity = boqRowsFound / nonEmptyLines;

  const signals = { boqRowsFound, lumpsumKeywordHits, scheduleKeywordHits, pricedDensity, textLength };

  // Decision order matters:
  // 1) A healthy number of measured rows → measured BOQ regardless of keywords
  //    (long measured tenders also contain the word "lump sum" in conditions).
  if (boqRowsFound >= 12) {
    return {
      type: "measured_boq",
      confidence: Math.min(0.95, 0.6 + pricedDensity * 4),
      reason: "A measured bill of quantities was found.",
      signals,
    };
  }

  // 2) Few/no measured rows + lump-sum language → lump-sum tender.
  if (lumpsumKeywordHits >= 2) {
    return {
      type: "lumpsum",
      confidence: Math.min(0.95, 0.5 + lumpsumKeywordHits * 0.05 + (12 - Math.min(boqRowsFound, 12)) * 0.03),
      reason:
        "This looks like a lump-sum tender — the works are described by scope and specification, with no measured quantities to price.",
      signals,
    };
  }

  // 3) Schedule-of-rates language with few measured rows.
  if (scheduleKeywordHits >= 2) {
    return {
      type: "schedule_of_rates",
      confidence: 0.6,
      reason:
        "This looks like a schedule-of-rates document — rates are pre-listed and the tenderer applies a percentage adjustment.",
      signals,
    };
  }

  // 4) Some measured rows but few, and no strong lump-sum signal — treat as a
  //    (small) measured BOQ and let Gate 2 judge the output.
  if (boqRowsFound >= 4) {
    return {
      type: "measured_boq",
      confidence: 0.5,
      reason: "A small bill of quantities was found.",
      signals,
    };
  }

  // 5) Nothing recognisable.
  return {
    type: "unreadable",
    confidence: 0.6,
    reason:
      "We could not find a bill of quantities or recognise the tender's structure in this document.",
    signals,
  };
}
