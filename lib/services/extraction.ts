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
}

/** Extract text from a document buffer by content type / extension. */
export async function extractText(buf: Buffer, contentType: string, filename: string): Promise<string> {
  const name = filename.toLowerCase();
  if (contentType === "application/pdf" || name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  }
  return buf.toString("utf-8");
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
  "kg|g|tonne|ton|t|bag|m2|m3|mm|cm|m|sqm|cum|litre|litres|l|no|nos|nr|unit|each|pc|pcs|set|sets|lot|sum|item|day|days|hr|hour|hours|pair|roll|sheet|length|ls";

/** Parse BOQ-style line items: item number, description, quantity, unit. */
export function parseBoqLines(text: string): ParsedBoqLine[] {
  const lines = text.split(/\r?\n/);
  const items: ParsedBoqLine[] = [];
  const re = new RegExp(
    `^\\s*(\\d+(?:\\.\\d+)*|[A-Z]\\d*(?:\\.\\d+)?)\\s*[.)\\-/]?\\s+(.{8,250}?)\\s{2,}(\\d[\\d,]*(?:\\.\\d+)?)\\s+(${UNIT_TOKENS})\\b.*$`,
    "i"
  );
  const bareRe = new RegExp(
    `^\\s*(?:\\(?([A-Z]?\\d+(?:\\.\\d+)*)\\)?[.)\\-/]?\\s+)?(.{10,250}?)\\s{2,}(\\d[\\d,]*(?:\\.\\d+)?)\\s+(${UNIT_TOKENS})\\b.*$`,
    "i"
  );

  let seq = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 12) continue;
    const m = line.match(re) ?? line.match(bareRe);
    if (!m) continue;
    const qty = parseFloat(m[3].replace(/,/g, ""));
    if (isNaN(qty) || qty <= 0 || qty > 1e9) continue;
    const desc = m[2].replace(/\s+/g, " ").trim();
    if (/^(total|jumlah|amount|sub-?total)/i.test(desc)) continue;
    seq += 1;
    items.push({
      itemNo: m[1] ?? String(seq),
      description: desc,
      quantity: qty,
      unit: m[4].toLowerCase(),
    });
  }
  return items;
}

export interface NormalisedItem {
  itemNo: string;
  description: string;
  normalisedDescription: string;
  category: "material" | "process" | "labour" | "other";
  quantity: number | null;
  unit: string | null;
  normalisedUnit: string | null;
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
  };
}
