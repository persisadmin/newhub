/** Normalisation layer: descriptions, synonyms, units, categories. */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "to", "for", "in", "per", "with", "supply", "deliver",
  "including", "incl", "as", "specified", "complete", "rate", "only",
]);

const SYNONYMS: Array<[RegExp, string]> = [
  [/\bordinary portland cement\b|\bopc\b/g, "portland cement"],
  [/\bportland cement\b/g, "portland cement"],
  [/\bkg\b/g, "kilogram"],
  [/\bmm\b/g, "millimetre"],
  [/\bm2\b|sq\.?\s?m\b|sqm\b/g, "square metre"],
  [/\bm3\b|cu\.?\s?m\b|cum\b/g, "cubic metre"],
  [/\brcd?\b/g, "reinforced concrete"],
  [/\bbrc\b/g, "welded mesh"],
  [/\bms\b(?= plate| bar| angle)/g, "mild steel"],
  [/\bhdpe\b/g, "high density polyethylene"],
  [/\bupvc\b|\bpvc\b/g, "pvc"],
  [/\bg\.?i\.?\b/g, "galvanised iron"],
  [/\bno\.?\b/g, "number"],
];

/** Produce a canonical, lowercase, punctuation-free, synonym-resolved description. */
export function normaliseDescription(input: string): string {
  let s = input.toLowerCase().replace(/[|/\\_,;:()[\]"'“”‘’.]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, rep] of SYNONYMS) s = s.replace(re, rep);
  const tokens = s
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (STOPWORDS.has(t) ? "" : t))
    .filter(Boolean);
  return tokens.join(" ");
}

const UNIT_MAP: Record<string, string> = {
  kg: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gram: "g",
  bag: "bag", bags: "bag",
  m: "m", meter: "m", metre: "m", meters: "m", metres: "m",
  mm: "mm", cm: "cm",
  m2: "m2", sqm: "m2", "square metre": "m2", "square meter": "m2",
  m3: "m3", cum: "m3", "cubic metre": "m3", "cubic meter": "m3",
  l: "litre", litre: "litre", liter: "litre", litres: "litre",
  no: "no", nos: "no", nr: "no", number: "no", unit: "no", each: "no", pc: "no", pcs: "no",
  set: "set", sets: "set",
  lot: "lot", sum: "sum", item: "item",
  day: "day", days: "day",
  hr: "hour", hour: "hour", hours: "hour",
  t: "tonne", ton: "tonne", tonne: "tonne", tonnes: "tonne",
  ls: "lump sum", "lump sum": "lump sum",
  psc: "pair", pair: "pair",
  roll: "roll", rolls: "roll",
  sheet: "sheet", sheets: "sheet",
  length: "length", lengths: "length",
};

export function normaliseUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const key = unit.toLowerCase().trim();
  return UNIT_MAP[key] ?? key;
}

/** Unit compatibility / conversion factors (to a canonical base per dimension). */
const CONVERSIONS: Record<string, { base: string; factor: number }> = {
  kg: { base: "kg", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  tonne: { base: "kg", factor: 1000 },
  m: { base: "m", factor: 1 },
  cm: { base: "m", factor: 0.01 },
  mm: { base: "m", factor: 0.001 },
  m2: { base: "m2", factor: 1 },
  m3: { base: "m3", factor: 1 },
  litre: { base: "litre", factor: 1 },
};

/** Convert a price-per-unit from one unit to another; null when incompatible. */
export function convertUnitPrice(price: number, fromUnit: string | null, toUnit: string | null): number | null {
  if (!fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return price;
  const from = CONVERSIONS[fromUnit];
  const to = CONVERSIONS[toUnit];
  if (!from || !to || from.base !== to.base) return null;
  // price per from-unit -> price per base -> price per to-unit
  const pricePerBase = price / from.factor;
  return pricePerBase * to.factor;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  material: [
    "cement", "concrete", "steel", "bar", "mesh", "sand", "aggregate", "brick", "block",
    "timber", "wood", "pipe", "paint", "tile", "glass", "board", "plywood", "bitumen",
    "asphalt", "membrane", "admixture", "nail", "bolt", "roofing", "gravel", "stone",
  ],
  process: [
    "excavation", "formwork", "scaffold", "demolition", "piling", "plastering", "screeding",
    "waterproofing", "painting work", "installation", "laying", "compaction", "backfill",
    "site clearance", "earthwork", "drilling", "grouting", "trenching",
  ],
  labour: [
    "labour", "worker", "operator", "foreman", "supervisor", "craftsman", "welder",
    "electrician", "plumber", "mason", "carpenter", "manpower", "driver", "surveyor",
  ],
};

export function classify(normalisedDescription: string): "material" | "process" | "labour" | "other" {
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => normalisedDescription.includes(w))) return cat as "material" | "process" | "labour";
  }
  return "other";
}
