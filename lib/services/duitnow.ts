import { getEnv } from "@/lib/env";

/**
 * DuitNow QR payload builder (EMVCo Merchant-Presented Mode, PayNet flavour).
 *
 * Two modes:
 *  1. Preferred — derive from the merchant's EXISTING static QR (paste the
 *     decoded payload string into DUITNOW_STATIC_QR). We keep the merchant
 *     account block (acquirer ID / QR ID assigned by TNGD) verbatim, flip the
 *     QR to dynamic, inject the amount + bill reference, and recompute the CRC.
 *     This never guesses acquirer-assigned values.
 *  2. From-scratch fallback using DUITNOW_ACQUIRER_ID / DUITNOW_QR_ID copied
 *     from the merchant portal.
 *
 * Payloads are built entirely server-side — nothing is sent to third-party
 * QR generation services.
 */

const DUITNOW_AID = "A0000006150001"; // Malaysia AID per PayNet spec

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) as required by EMVCo. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Parse an EMVCo TLV payload into an ordered list of [id, value]. */
export function parseTlv(payload: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > payload.length) break;
    out.push([id, payload.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

export interface DuitNowQrInput {
  amountMyr: string; // e.g. "299.37"
  reference: string; // bill/reference number, ≤25 chars
}

/**
 * Build a dynamic (amount-bearing) DuitNow QR payload.
 * Returns null when DuitNow is not configured (caller falls back to mock).
 */
export function buildDuitNowPayload({ amountMyr, reference }: DuitNowQrInput): string | null {
  const env = getEnv();
  // Reference goes into tag 62 (bill number + reference label). Strict wallet
  // parsers reject punctuation here, so keep it alphanumeric only.
  const ref = reference.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);

  // ---- Mode 1: derive from existing static merchant QR ----
  const staticQr = env.DUITNOW_STATIC_QR?.trim();
  if (staticQr) {
    // Strip paste artifacts (line breaks/tabs) but never spaces — merchant
    // names legitimately contain them and lengths would be corrupted.
    const fields = parseTlv(staticQr.replace(/[\r\n\t]/g, ""));
    const parts: string[] = [];
    let insertedAmount = false;
    for (const [id, value] of fields) {
      if (id === "63") break; // old CRC discarded
      if (id === "54" || id === "62") continue; // replaced below
      if (id === "01") { parts.push(tlv("01", "12")); continue; } // dynamic
      parts.push(tlv(id, value));
      if (id === "53") { parts.push(tlv("54", amountMyr)); insertedAmount = true; } // amount right after currency
    }
    if (!insertedAmount) parts.push(tlv("53", "458"), tlv("54", amountMyr));
    // Additional data: bill number + reference label
    const addl = tlv("01", ref) + tlv("05", ref);
    parts.push(tlv("62", addl));
    const withoutCrc = parts.join("") + "6304";
    return withoutCrc + crc16(withoutCrc);
  }

  // ---- Mode 2: from-scratch with portal-supplied acquirer values ----
  const acquirerId = env.DUITNOW_ACQUIRER_ID?.trim();
  const qrId = env.DUITNOW_QR_ID?.trim();
  if (!acquirerId || !qrId) return null;
  const name = (env.DUITNOW_MERCHANT_NAME || "PERSIS").slice(0, 25);
  const city = (env.DUITNOW_MERCHANT_CITY || "MY").slice(0, 15);

  const mai = tlv("00", DUITNOW_AID) + tlv("01", acquirerId.slice(0, 6)) + tlv("02", qrId.slice(0, 28));
  const addl = tlv("01", ref) + tlv("05", ref);
  const withoutCrc =
    tlv("00", "01") +
    tlv("01", "12") + // dynamic QR
    tlv("26", mai) +
    tlv("52", "0000") +
    tlv("53", "458") + // MYR
    tlv("54", amountMyr) +
    tlv("58", "MY") +
    tlv("59", name) +
    tlv("60", city) +
    tlv("62", addl) +
    "6304";
  return withoutCrc + crc16(withoutCrc);
}

export function isDuitNowConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.DUITNOW_STATIC_QR?.trim() || (env.DUITNOW_ACQUIRER_ID?.trim() && env.DUITNOW_QR_ID?.trim()));
}

/**
 * Admin self-test: a RM1.00 payload with a dummy reference, plus its parsed
 * fields, so the merchant can scan it with a bank app BEFORE real customers
 * do — verifying the wallet recognises merchant, amount and reference.
 */
export function getDuitNowPreview(): { configured: boolean; previewPayload: string | null; fields: Array<[string, string]> } {
  const configured = isDuitNowConfigured();
  if (!configured) return { configured, previewPayload: null, fields: [] };
  const previewPayload = buildDuitNowPayload({ amountMyr: "1.00", reference: "TESTREF123" });
  return { configured, previewPayload, fields: previewPayload ? parseTlv(previewPayload) : [] };
}

/** Extract every RM amount mentioned in a payment notification, in sen. */
export function extractAmountsSen(text: string): number[] {
  const out: number[] = [];
  const re = /(?:RM|MYR)\s?([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(parseInt(m[1].replace(/,/g, ""), 10) * 100 + parseInt(m[2], 10));
  }
  return [...new Set(out)];
}
