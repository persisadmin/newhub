/**
 * Tender uplift from cost price: contingency first, then profit margin.
 *
 *   tender = cost × (1 + contingency/100) × (1 + margin/100)
 *
 * Returns null when neither applies (no uplift), so callers can hide tender
 * columns/rows entirely rather than showing a 1.0 multiplier.
 */
export function tenderUplift(marginPct?: number | null, contingencyPct?: number | null): number | null {
  const margin = marginPct != null && marginPct > 0 ? 1 + marginPct / 100 : 1;
  const contingency = contingencyPct != null && contingencyPct > 0 ? 1 + contingencyPct / 100 : 1;
  const combined = margin * contingency;
  return combined !== 1 ? combined : null;
}

/** Split a tender total back into its cost / contingency / margin parts for display. */
export function tenderBreakdown(costTotal: number, marginPct?: number | null, contingencyPct?: number | null): {
  cost: number;
  contingencyAmount: number;
  marginAmount: number;
  tender: number;
} {
  const contingencyRate = contingencyPct != null && contingencyPct > 0 ? contingencyPct / 100 : 0;
  const marginRate = marginPct != null && marginPct > 0 ? marginPct / 100 : 0;
  const contingencyAmount = costTotal * contingencyRate;
  const subtotal = costTotal + contingencyAmount;
  const marginAmount = subtotal * marginRate;
  return {
    cost: costTotal,
    contingencyAmount,
    marginAmount,
    tender: subtotal + marginAmount,
  };
}
