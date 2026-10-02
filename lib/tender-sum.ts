/**
 * Tender Sum calculation + Ringgit amount-in-words.
 *
 * Margin model here is MARGIN ON SELLING PRICE (not markup on cost):
 *   totalCost = (material + labour) × (1 + contingency%)
 *   tender    = totalCost ÷ (1 − margin%)
 *   profit    = tender − totalCost
 * This matches the "Price Breakdown & Tender Sum" convention where a 30%
 * margin means profit is 30% of the final bid price.
 */

export interface TenderSumInput {
  /** Base material & equipment cost (RM), auto-summed from BOQ material lines. */
  materialCost: number;
  durationDays: number | null;
  workerCount: number | null;
  laborRatePerDay: number | null;
  /** Contingency (%) on base direct cost. */
  contingencyPct: number | null;
  /** Gross profit margin (%) on the selling price. */
  marginPct: number | null;
}

export interface TenderSum {
  materialCost: number;
  laborCost: number;
  baseDirectCost: number;
  contingencyAmount: number;
  totalCost: number;
  marginPct: number;
  profitAmount: number;
  tenderBid: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTenderSum(input: TenderSumInput): TenderSum {
  const material = Math.max(0, input.materialCost || 0);
  const days = input.durationDays ?? 0;
  const workers = input.workerCount ?? 0;
  const rate = input.laborRatePerDay ?? 0;
  const labor = round2(days * workers * rate);

  const baseDirect = round2(material + labor);
  const contingencyRate = input.contingencyPct != null && input.contingencyPct > 0 ? input.contingencyPct / 100 : 0;
  const contingencyAmount = round2(baseDirect * contingencyRate);
  const totalCost = round2(baseDirect + contingencyAmount);

  // Margin on selling price; clamp below 100% to avoid division by zero/negative.
  const marginPct = input.marginPct != null ? Math.min(Math.max(input.marginPct, 0), 99.99) : 0;
  const marginRate = marginPct / 100;
  const tenderBid = marginRate > 0 ? round2(totalCost / (1 - marginRate)) : totalCost;
  const profitAmount = round2(tenderBid - totalCost);

  return {
    materialCost: round2(material),
    laborCost: labor,
    baseDirectCost: baseDirect,
    contingencyAmount,
    totalCost,
    marginPct,
    profitAmount,
    tenderBid,
  };
}

/* ---------------- Ringgit amount in words ---------------- */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(" ");
}

function integerToWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ];
  const parts: string[] = [];
  let rem = Math.floor(Math.abs(n));
  for (const [value, label] of scales) {
    if (rem >= value) {
      const chunk = Math.floor(rem / value);
      parts.push(`${integerToWords(chunk)} ${label}`);
      rem %= value;
    }
  }
  if (rem > 0) parts.push(threeDigits(rem));
  return parts.join(" ");
}

/**
 * "Ringgit Malaysia: One Hundred Seventy-Two Thousand Five Hundred Only."
 * Sen is appended as "and Sen Fifty" when there are cents.
 */
export function ringgitInWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100);
  const ringgit = Math.floor(rounded / 100);
  const sen = rounded % 100;
  let words = `Ringgit Malaysia: ${integerToWords(ringgit)}`;
  if (sen > 0) words += ` and Sen ${integerToWords(sen)}`;
  return `${words} Only.`;
}
