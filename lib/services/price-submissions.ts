import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { extractText } from "@/lib/services/extraction";
import { chat } from "@/lib/services/llm/providers";
import { parseLlmJson } from "@/lib/services/llm/parse-json";
import { parseTableRows, isConfidentTableParse } from "@/lib/services/price-table-parse";
import { normaliseDescription, normaliseUnit } from "@/lib/domain/pricing/normalise";
import type {
  PriceSubmissionDoc,
  PriceSubmissionKind,
  PriceRow,
  BenchmarkPriceDoc,
  ContractorPriceDoc,
} from "@/lib/domain/types";

/**
 * Price submissions.
 *
 * - Admins upload government agency price lists (JKR/CIDB/etc.) → reviewed,
 *   then committed into `benchmark_prices`. Re-submitting an updated version
 *   of the same list (same agency name) overwrites the previous rates.
 * - Users upload supplier quotations → reviewed, then committed into their own
 *   `contractor_prices` library, which the pricing engine prefers over
 *   benchmarks.
 */

const CHUNK_CHARS = 32_000;
const MAX_TOTAL_CHARS = 600_000;
/** Max simultaneous LLM calls during the chunked fallback parse. */
const PARSE_CONCURRENCY = 4;

function buildParsePrompt(kind: PriceSubmissionKind): string {
  const what =
    kind === "benchmark"
      ? "a government agency schedule of rates / price list"
      : "a supplier quotation";
  return `You are given raw extracted text from ${what} used by Malaysian contractors.

Extract EVERY priced line item. For each item output:
- "description": the work/material description (keep original language, Malay or English)
- "unit": the unit of measurement as written (e.g. m, m2, m3, kg, no, set, lot, hari)
- "price": the unit rate in RM as a NUMBER (no currency symbol, no commas)

Rules:
- Skip headings, section titles, notes, totals, and any row without a clear unit rate.
- If an item has several rate columns, use the main supply/supply-and-install rate.
- Never invent rows or prices — only extract what is printed.
- Output ONLY a JSON array, e.g. [{"description":"...","unit":"m2","price":45.5}] — no commentary.

TEXT:
`;
}

/** LLM-extract priced rows from raw document text (chunked for long lists). */
/**
 * Extract priced rows from raw document text.
 *
 * Fast path: a rule-based parser handles well-structured schedules (like the
 * JKR schedule of rates) instantly with no LLM call. If that parse isn't
 * confident, the text is chunked and parsed by the LLM — with the chunk calls
 * run concurrently (bounded) instead of sequentially, which is several times
 * faster on long documents.
 */
export async function parsePriceRows(text: string, kind: PriceSubmissionKind): Promise<PriceRow[]> {
  const trimmed = text.length > MAX_TOTAL_CHARS ? text.slice(0, MAX_TOTAL_CHARS) : text;

  // Fast path: structured table → rule-based extraction, no LLM.
  try {
    const table = parseTableRows(trimmed);
    if (isConfidentTableParse(table)) {
      logger.info("prices.parse_rule_based", { kind, rows: table.rows.length, coverage: table.coverage.toFixed(2) });
      return table.rows.map((r) => ({ description: r.description, unit: r.unit, price: r.price }));
    }
    logger.info("prices.parse_rule_low_confidence", { kind, rows: table.rows.length, coverage: table.coverage.toFixed(2), unparsed: table.unparsedCount });
  } catch (err) {
    logger.warn("prices.parse_rule_failed", { kind, error: String(err) });
  }

  // Fallback: chunked LLM extraction, chunks processed concurrently.
  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + CHUNK_CHARS, trimmed.length);
    if (end < trimmed.length) {
      // Cut at a newline so rows aren't split mid-line
      const nl = trimmed.lastIndexOf("\n", end);
      if (nl > start + CHUNK_CHARS / 2) end = nl;
    }
    chunks.push(trimmed.slice(start, end));
    start = end;
  }

  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  const parseChunk = async (c: string, idx: number): Promise<PriceRow[]> => {
    try {
      const raw = await chat(
        [
          { role: "system", content: "You extract structured price data from Malaysian construction price documents. You output only valid JSON." },
          { role: "user", content: buildParsePrompt(kind) + c },
        ],
        8_000,
        "price_list_parse"
      );
      const parsed = parseLlmJson(raw);
      if (!Array.isArray(parsed)) return [];
      const out: PriceRow[] = [];
      for (const r of parsed as Array<Record<string, unknown>>) {
        const description = String(r.description ?? "").trim();
        const unit = String(r.unit ?? "").trim();
        const price = Number(r.price);
        if (!description || !unit || !isFinite(price) || price <= 0) continue;
        out.push({ description, unit, price: Math.round(price * 100) / 100 });
      }
      logger.info("prices.parse_chunk", { kind, chunk: idx, rows: out.length });
      return out;
    } catch (err) {
      logger.warn("prices.parse_chunk_failed", { kind, chunk: idx, error: String(err) });
      return [];
    }
  };

  // Bounded-concurrency fan-out over chunks.
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PARSE_CONCURRENCY, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const chunkRows = await parseChunk(chunks[idx], idx);
      for (const r of chunkRows) {
        const key = `${normaliseDescription(r.description)}|${normaliseUnit(r.unit) ?? r.unit.toLowerCase()}|${r.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(r);
      }
    }
  });
  await Promise.all(workers);

  return rows;
}

export async function createSubmission(input: {
  kind: PriceSubmissionKind;
  userId: ObjectId;
  userEmail: string;
  sourceName: string;
  effectiveDate?: Date;
  filename: string;
  buf: Buffer;
  contentType: string;
}): Promise<PriceSubmissionDoc> {
  await ensureIndexes();
  const db = await getDb();
  const { text } = await extractText(input.buf, input.contentType, input.filename);
  if (!text || text.trim().length < 20) {
    throw new Error("Could not extract text from that file. If it is a scanned PDF, export it as text or a searchable PDF first.");
  }
  const rows = await parsePriceRows(text, input.kind);
  if (rows.length === 0) {
    throw new Error("No priced line items were found in that document. Check that it contains unit rates.");
  }
  const doc: PriceSubmissionDoc = {
    _id: new ObjectId(),
    kind: input.kind,
    userId: input.userId,
    userEmail: input.userEmail,
    sourceName: input.sourceName,
    effectiveDate: input.effectiveDate,
    filename: input.filename,
    rows,
    status: "pending_review",
    createdAt: new Date(),
  };
  await db.collection<PriceSubmissionDoc>("price_submissions").insertOne(doc);
  await audit({
    userId: input.userId,
    action: input.kind === "benchmark" ? "admin.price_list_submitted" : "prices.quotation_submitted",
    entityType: "price_submission",
    entityId: doc._id,
    newValue: { sourceName: input.sourceName, filename: input.filename, rows: rows.length },
    source: input.kind === "benchmark" ? "admin" : "api",
  });
  return doc;
}

export async function listSubmissions(userId: ObjectId, isAdmin: boolean, kind?: PriceSubmissionKind): Promise<PriceSubmissionDoc[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = isAdmin ? {} : { userId };
  if (kind) filter.kind = kind;
  return db
    .collection<PriceSubmissionDoc>("price_submissions")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
}

export async function getSubmission(id: string): Promise<PriceSubmissionDoc | null> {
  const db = await getDb();
  return db.collection<PriceSubmissionDoc>("price_submissions").findOne({ _id: new ObjectId(id) });
}

/**
 * Commit a reviewed submission into the live price collections.
 * Benchmark rows upsert by (source, normalised description+unit) — uploading
 * a newer version of the same agency list replaces the old rates. Quotation
 * rows upsert into the user's own contractor price library.
 */
export async function commitSubmission(sub: PriceSubmissionDoc, actorId: ObjectId): Promise<number> {
  if (sub.status !== "pending_review") throw new Error("This submission has already been processed.");
  const db = await getDb();
  const now = new Date();
  let written = 0;

  for (const row of sub.rows) {
    const nd = normaliseDescription(row.description);
    const nu = normaliseUnit(row.unit) ?? row.unit.toLowerCase();
    if (!nd) continue;
    if (sub.kind === "benchmark") {
      await db.collection<BenchmarkPriceDoc>("benchmark_prices").updateOne(
        { source: sub.sourceName, normalisedDescription: nd, normalisedUnit: nu },
        {
          $set: {
            description: row.description,
            category: "general",
            unit: row.unit,
            price: row.price,
            currency: "MYR",
            sourceRef: sub.effectiveDate ? sub.effectiveDate.toISOString().slice(0, 10) : sub.filename,
            effectiveDate: sub.effectiveDate,
            isSeedSample: false,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
    } else {
      await db.collection<ContractorPriceDoc>("contractor_prices").updateOne(
        { userId: sub.userId, normalisedDescription: nd, normalisedUnit: nu },
        {
          $set: {
            category: "general",
            price: row.price,
            currency: "MYR",
            source: `Quotation: ${sub.sourceName}`,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
    }
    written++;
  }

  await db.collection<PriceSubmissionDoc>("price_submissions").updateOne(
    { _id: sub._id },
    { $set: { status: "committed", committedRows: written, committedAt: now } }
  );
  await audit({
    userId: actorId,
    action: sub.kind === "benchmark" ? "admin.price_list_committed" : "prices.quotation_committed",
    entityType: "price_submission",
    entityId: sub._id,
    newValue: { sourceName: sub.sourceName, written },
    source: sub.kind === "benchmark" ? "admin" : "api",
  });
  return written;
}

export async function discardSubmission(sub: PriceSubmissionDoc, actorId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection<PriceSubmissionDoc>("price_submissions").updateOne(
    { _id: sub._id },
    { $set: { status: "discarded" } }
  );
  await audit({
    userId: actorId,
    action: "prices.submission_discarded",
    entityType: "price_submission",
    entityId: sub._id,
    newValue: { sourceName: sub.sourceName },
    source: "api",
  });
}
