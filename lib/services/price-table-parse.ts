/**
 * Rule-based extraction of priced rows from well-structured price documents
 * (e.g. JKR schedules of rates, tidy supplier quotations).
 *
 * The goal is not to replace the LLM parser but to front it: a document that
 * parses cleanly here never touches the LLM, which is dramatically faster and
 * free. Anything that doesn't meet the confidence bar falls back to the LLM.
 *
 * Recognised line shape (item number optional, description may wrap):
 *     21   Cutting off top of pile ...          No    60.50
 *          ... continuation line ...            m     151.50
 *     Supply and lay 150mm concrete pipe        m     81.90
 */

import { normaliseDescription } from "@/lib/domain/pricing/normalise";

export interface ParsedRow {
  description: string;
  unit: string;
  price: number;
}

/** Units we accept as the unit column (case-insensitive, common Malaysian forms). */
const UNITS = new Set([
  "m", "m2", "m²", "m3", "m³", "mm", "cm", "km",
  "kg", "g", "t", "ton", "tonne", "l", "ltr", "litre", "ml",
  "no", "nr", "set", "lot", "item", "pc", "pcs", "unit", "pair", "pr",
  "day", "hari", "hr", "hour", "jam", "week", "month", "trip", "load",
  "roll", "bag", "box", "pkt", "pail", "drum", "length", "sheet", "slab",
  "kw", "hp", "amp", "point", "pt", "sum", "ls", "p.s.", "each", "ea",
]);

/** Lines that are noise in JKR scans: watermark fragments, headers, footers. */
const WATERMARK = new Set(["a", "ay", "r", "ja", "ke", "n", "ta", "ba", "jar", "jak", "jab", "raj"]);

const ROW_RE =
  //            1: itemNo?      2: description        3: unit                      4: price
  /^(?:\s*(\d{1,4})\s+)?(\D.*?)\s{2,}([A-Za-z0-9²³./-]{1,10})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|\d+\.\d{1,2})\s*$/;

function isHeaderOrNoise(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  const low = l.toLowerCase();
  if (WATERMARK.has(low)) return true;
  if (/^(item|description|unit|rate|price|no\.?|percentage|increase|decrease)\b/.test(low) && !/\d\.\d{2}/.test(low)) return true;
  if (/cont'?d|continued/.test(low) && !/\d\.\d{2}/.test(low)) return true;
  if (/^[A-Z][A-Z /&(),.'-]{4,}$/.test(l) && !/\d/.test(l)) return true; // ALL-CAPS trade headings
  if (/page|\d{4}\/\d+|kerajaan|jabatan|jkr|malaysia/i.test(l) && !/\d\.\d{2}/.test(l)) return true;
  return false;
}

function validUnit(u: string): boolean {
  return UNITS.has(u.toLowerCase().replace(/[.,]$/, ""));
}

function toPrice(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}

export interface TableParseResult {
  rows: ParsedRow[];
  /** Fraction of candidate (non-noise) lines that parsed as rows, 0–1. */
  coverage: number;
  /** Lines that looked like they might carry data but didn't parse. */
  unparsedCount: number;
}

/**
 * Attempt a full rule-based parse of the document text. Returns rows plus a
 * coverage score so the caller can decide whether to trust it or fall back to
 * the LLM.
 */
export function parseTableRows(text: string): TableParseResult {
  const lines = text.split(/\r?\n/);
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();

  let pendingNo: string | null = null;
  let pendingDesc: string[] = [];
  let candidateLines = 0;
  let unparsed = 0;

  const flush = () => {
    pendingNo = null;
    pendingDesc = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (isHeaderOrNoise(line)) { continue; }
    candidateLines++;

    const m = line.match(ROW_RE);
    if (m) {
      const unit = (m[3] ?? "").trim();
      const price = toPrice(m[4] ?? "");
      let desc = (m[2] ?? "").trim().replace(/\s{2,}/g, " ");
      // Fold any wrapped description from previous lines.
      if (pendingDesc.length) {
        desc = [...pendingDesc, desc].join(" ").replace(/\s{2,}/g, " ").trim();
      }
      flush();
      if (!validUnit(unit) || !isFinite(price) || desc.length < 3) { unparsed++; continue; }
      const key = `${normaliseDescription(desc)}|${unit.toLowerCase()}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ description: desc, unit, price });
      continue;
    }

    // Not a complete row — could be the start of a wrapped description or noise.
    const startsWithNo = /^\s*(\d{1,4})\s+(\D.*)$/.exec(line);
    const hasDigits = /\d/.test(line);
    if (startsWithNo || (!hasDigits && line.trim().length > 8 && /^[A-Za-z(]/.test(line.trim()))) {
      // accumulate as a possible description fragment (cap to avoid runaway)
      if (pendingDesc.length < 4) {
        pendingNo = startsWithNo?.[1] ?? pendingNo;
        pendingDesc.push((startsWithNo?.[2] ?? line).trim());
      } else {
        flush();
        unparsed++;
      }
    } else {
      flush();
      if (hasDigits) unparsed++; // had numbers but didn't match — worth noting
    }
  }

  const coverage = candidateLines === 0 ? 0 : rows.length / candidateLines;
  return { rows, coverage, unparsedCount: unparsed };
}

/**
 * Decide whether the rule-based parse is good enough to trust without the LLM.
 * Requires a decent number of rows AND high coverage so we don't silently drop
 * half the items on a document the parser only partially understands.
 */
export function isConfidentTableParse(result: TableParseResult): boolean {
  if (result.rows.length < 10) return false;
  if (result.coverage < 0.5) return false;
  // Too many unparsed numeric lines relative to rows → likely misreading columns.
  if (result.unparsedCount > result.rows.length) return false;
  return true;
}
