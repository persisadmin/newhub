var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/tender-sum.ts
var tender_sum_exports = {};
__export(tender_sum_exports, {
  computeTenderSum: () => computeTenderSum,
  ringgitInWords: () => ringgitInWords
});
function computeTenderSum(input) {
  const material = Math.max(0, input.materialCost || 0);
  const days = input.durationDays ?? 0;
  const workers = input.workerCount ?? 0;
  const rate = input.laborRatePerDay ?? 0;
  const labor = round2(days * workers * rate);
  const baseDirect = round2(material + labor);
  const contingencyRate = input.contingencyPct != null && input.contingencyPct > 0 ? input.contingencyPct / 100 : 0;
  const contingencyAmount = round2(baseDirect * contingencyRate);
  const totalCost = round2(baseDirect + contingencyAmount);
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
    tenderBid
  };
}
function threeDigits(n) {
  const parts = [];
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
function integerToWords(n) {
  if (n === 0) return "Zero";
  const scales = [
    [1e9, "Billion"],
    [1e6, "Million"],
    [1e3, "Thousand"]
  ];
  const parts = [];
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
function ringgitInWords(amount) {
  const rounded = Math.round(Math.abs(amount) * 100);
  const ringgit = Math.floor(rounded / 100);
  const sen = rounded % 100;
  let words = `Ringgit Malaysia: ${integerToWords(ringgit)}`;
  if (sen > 0) words += ` and Sen ${integerToWords(sen)}`;
  return `${words} Only.`;
}
var round2, ONES, TENS;
var init_tender_sum = __esm({
  "lib/tender-sum.ts"() {
    "use strict";
    round2 = (n) => Math.round(n * 100) / 100;
    ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  }
});

// scripts/tendersum-harness.mts
var assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else console.log("PASS:", msg);
};
var { computeTenderSum: computeTenderSum2, ringgitInWords: ringgitInWords2 } = await Promise.resolve().then(() => (init_tender_sum(), tender_sum_exports));
var r = computeTenderSum2({ materialCost: 1e5, durationDays: 10, workerCount: 10, laborRatePerDay: 150, contingencyPct: 5, marginPct: 30 });
assert(r.laborCost === 15e3, `labor = 10\xD710\xD7150 = 15000 (got ${r.laborCost})`);
assert(r.baseDirectCost === 115e3, `base direct = 115000 (got ${r.baseDirectCost})`);
assert(r.contingencyAmount === 5750, `contingency 5% of 115000 = 5750 (got ${r.contingencyAmount})`);
assert(r.totalCost === 120750, `total cost = 120750 (got ${r.totalCost})`);
assert(r.profitAmount === 51750, `profit = 120750/0.70 \u2212 120750 = 51750 (got ${r.profitAmount})`);
assert(r.tenderBid === 172500, `tender bid = 172500 (got ${r.tenderBid})`);
assert(Math.abs(r.tenderBid - r.totalCost - r.profitAmount) < 5e-3, "tender = cost + profit (internally consistent)");
assert(ringgitInWords2(172500) === "Ringgit Malaysia: One Hundred Seventy-Two Thousand Five Hundred Only.", `words 172500 (got "${ringgitInWords2(172500)}")`);
assert(ringgitInWords2(0) === "Ringgit Malaysia: Zero Only.", `words 0`);
assert(ringgitInWords2(1000.5) === "Ringgit Malaysia: One Thousand and Sen Fifty Only.", `words 1000.50 (got "${ringgitInWords2(1000.5)}")`);
assert(ringgitInWords2(123456789e-2) === "Ringgit Malaysia: One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven and Sen Eighty-Nine Only.", `words 1234567.89 (got "${ringgitInWords2(123456789e-2)}")`);
assert(ringgitInWords2(99) === "Ringgit Malaysia: Ninety-Nine Only.", `words 99`);
var noMargin = computeTenderSum2({ materialCost: 115e3, durationDays: null, workerCount: null, laborRatePerDay: null, contingencyPct: 5, marginPct: null });
assert(noMargin.tenderBid === noMargin.totalCost && noMargin.profitAmount === 0, "no margin -> tender = total cost, zero profit");
var clamp = computeTenderSum2({ materialCost: 100, durationDays: 0, workerCount: 0, laborRatePerDay: 0, contingencyPct: 0, marginPct: 150 });
assert(clamp.marginPct <= 99.99 && clamp.tenderBid > 0 && Number.isFinite(clamp.tenderBid), "margin >100 clamped, no division blow-up");
var noLab = computeTenderSum2({ materialCost: 5e4, durationDays: null, workerCount: null, laborRatePerDay: null, contingencyPct: null, marginPct: 20 });
assert(noLab.laborCost === 0 && noLab.baseDirectCost === 5e4, "missing labour params -> labour 0, base = material");
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
