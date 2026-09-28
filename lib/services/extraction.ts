import { normaliseDescription, normaliseUnit, classify } from "@/lib/domain/pricing/normalise";

export interface TenderInfo {
  title?: string;
  tenderNumber?: string;
  agency?: string;
  category?: string;
  closingDate?: Date;
}

export interface ParsedBoqLine {
  itemNo: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  /** Trade/section heading the item belongs to (from LLM extraction). */
  section?: string;
}

export interface ExtractedText {
  text: string;
  pageCount?: number;
}

/** Extract text from a document buffer by content type / extension. */
export async function extractText(buf: Buffer, contentType: string, filename: string): Promise<ExtractedText> {
  const name = filename.toLowerCase();
  if (contentType === "application/pdf" || name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();
    return { text: result.text, pageCount: result.total ?? undefined };
  }
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value };
  }
  return { text: buf.toString("utf-8") };
}

/** Rule-based tender metadata extraction for Malaysian tender documents. */
export function extractTenderInfo(text: string): TenderInfo {
  const info: TenderInfo = {};
  const head = text.slice(0, 20000);

  const noMatch =
    head.match(/(?:tender|quotation|sebutharga|petenderan?)\s*(?:no|nombor|bil|rUJUKAN|ref)\s*[.:]?\s*([A-Z0-9/().-]{5,})/i) ||
    head.match(/\bno\.?\s*rujukan\s*[.:]?\s*([A-Z0-9/().-]{5,})/i);
  if (noMatch) info.tenderNumber = noMatch[1].trim();

  const agencyMatch =
    head.match(/(?:jabatan|kementerian|majlis|lembaga|universiti|perbadanan|jkr|cidb)[a-z\s&',.-]{0,80}/i) ||
    head.match(/(?:kementerian|jabatan|majlis perbandaran|majlis bandaraya|majlis daerah)\s+[a-z\s&',.-]{2,80}/i);
  if (agencyMatch) info.agency = agencyMatch[0].replace(/\s+/g, " ").trim().slice(0, 120);

  const catMatch = head.match(/kategori\s*[.:]?\s*([A-Z][A-Za-z0-9 ,/&-]{2,60})/i);
  if (catMatch) info.category = catMatch[1].trim();

  const titleLines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 15 && l.length <= 200)
    .filter((l) => /tender|sebutharga|cadangan|kerja|pembinaan|membekal/i.test(l))
    .filter((l) => !/no\.?\s*(tender|rujukan)/i.test(l));
  if (titleLines.length) info.title = titleLines[0];

  const dateMatch =
    head.match(/(?:tarikh tutup|closing date|tarikh akhir)\s*[.:]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i) ||
    head.match(/(?:tarikh tutup|closing date)\s*[.:]?\s*(\d{1,2}\s+(?:januari|februari|mac|april|mei|jun|julai|ogos|september|oktober|november|disember)\s+\d{4})/i);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) info.closingDate = d;
  }

  return info;
}

const UNIT_TOKENS =
  "kg|g|tonne|ton|t|bag|btg|batang|biji|m2|m3|mm|cm|m|sqm|cum|m²|m³|mtr|litre|litres|liter|l|no|nos|nr|unit|units|each|pc|pcs|set|sets|lot|sum|item|day|days|hr|hour|hours|pair|roll|gulung|sheet|keping|length|ls|bidang";

// Item number: A.1 | B1.1 | (1) | 2.3.1 | 4 — made optional in the line patterns below.
const ITEM_NO = "(\\(?[A-Za-z]?[\\.\\-]?\\d+(?:[\\.\\-/]\\d+){0,3}\\)?)";
const ITEM_PREFIX = `(?:\\s*${ITEM_NO}[\\).\\-/]?[\\t ]+)?`;

// Layout 1: BIL desc ...  QTY  UNIT        (common in commercial BOQs)
const RE_QTY_UNIT = new RegExp(
  `^${ITEM_PREFIX}\\s*(.{6,300}?)[\\t ]{2,}([\\d,]+(?:\\.\\d+)?)[\\t ]+\\(?(${UNIT_TOKENS})\\)?[\\.\\s]*$`,
  "i"
);
// Layout 2: BIL desc ...  UNIT  QTY
const RE_UNIT_QTY = new RegExp(
  `^${ITEM_PREFIX}\\s*(.{6,300}?)[\\t ]+\\(?(${UNIT_TOKENS})\\)?[\\t ]+([\\d,]+(?:\\.\\d+)?)[\\.\\s]*$`,
  "i"
);
// Layout 3 (JKR inden): desc ... Bhg Bil RATE QTY AMOUNT — e.g. "Mata lampu ... I B1 113.00 10 1130.00"
const RE_JKR_INDEN = new RegExp(
  `^${ITEM_PREFIX}\\s*(.{6,300}?)[\\t ]+([IVX]{1,4})[\\t ]+([A-Za-z]\\d+(?:\\.\\d+)?)[\\t ]+([\\d,]+\\.\\d{2})[\\t ]+([\\d,]+(?:\\.\\d+)?)[\\t ]+[\\d,]+\\.\\d{2}[\\.\\s]*$`,
  "i"
);

export interface BoqParseStats {
  linesScanned: number;
  matches: { layout1: number; layout2: number; layout3: number };
}

/** Parse BOQ-style line items: item number, description, quantity, unit. */
export function parseBoqLines(text: string): ParsedBoqLine[] {
  return parseBoqLinesWithStats(text).items;
}

export function parseBoqLinesWithStats(text: string): { items: ParsedBoqLine[]; stats: BoqParseStats } {
  const lines = text.replace(/\t/g, "  ").split(/\r?\n/);
  const items: ParsedBoqLine[] = [];
  const stats: BoqParseStats = { linesScanned: lines.length, matches: { layout1: 0, layout2: 0, layout3: 0 } };

  let seq = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 12) continue;

    // Layout 3: JKR inden — quantity after the unit rate.
    let m = line.match(RE_JKR_INDEN);
    if (m) {
      // groups: 1=itemNo 2=desc 3=Bhg 4=Bil 5=rate 6=qty (7=amount)
      const qty = parseFloat(m[6].replace(/,/g, ""));
      const rate = parseFloat(m[5].replace(/,/g, ""));
      if (!isNaN(qty) && qty > 0 && qty <= 1e9 && !isNaN(rate)) {
        const desc = m[2].replace(/\s+/g, " ").trim();
        if (!/^(total|jumlah|amount|sub-?total)/i.test(desc)) {
          seq += 1;
          items.push({
            itemNo: `${m[3]} ${m[4]}`,
            description: `${desc} (Kadar JKKE RM${rate.toFixed(2)})`,
            quantity: qty,
            unit: "lot",
          });
          stats.matches.layout3 += 1;
          continue;
        }
      }
    }

    // Layout 1: qty then unit — groups: 1=itemNo 2=desc 3=qty 4=unit
    m = line.match(RE_QTY_UNIT);
    if (m) {
      const qty = parseFloat(m[3].replace(/,/g, ""));
      if (!isNaN(qty) && qty > 0 && qty <= 1e9) {
        const desc = m[2].replace(/\s+/g, " ").trim();
        if (!/^(total|jumlah|amount|sub-?total)/i.test(desc)) {
          seq += 1;
          items.push({ itemNo: m[1] ?? String(seq), description: desc, quantity: qty, unit: m[4].toLowerCase() });
          stats.matches.layout1 += 1;
          continue;
        }
      }
    }

    // Layout 2: unit then qty — groups: 1=itemNo 2=desc 3=unit 4=qty
    m = line.match(RE_UNIT_QTY);
    if (m) {
      const qty = parseFloat(m[4].replace(/,/g, ""));
      if (!isNaN(qty) && qty > 0 && qty <= 1e9) {
        const desc = m[2].replace(/\s+/g, " ").trim();
        if (!/^(total|jumlah|amount|sub-?total)/i.test(desc)) {
          seq += 1;
          items.push({ itemNo: m[1] ?? String(seq), description: desc, quantity: qty, unit: m[3].toLowerCase() });
          stats.matches.layout2 += 1;
        }
      }
    }
  }
  return { items, stats };
}

export interface NormalisedItem {
  itemNo: string;
  description: string;
  normalisedDescription: string;
  category: "material" | "process" | "labour" | "other";
  quantity: number | null;
  unit: string | null;
  normalisedUnit: string | null;
  section?: string;
}

export function normaliseItem(line: ParsedBoqLine): NormalisedItem {
  const nd = normaliseDescription(line.description);
  return {
    itemNo: line.itemNo,
    description: line.description,
    normalisedDescription: nd,
    category: classify(nd),
    quantity: line.quantity,
    unit: line.unit,
    normalisedUnit: normaliseUnit(line.unit),
    ...(line.section ? { section: line.section } : {}),
  };
}
