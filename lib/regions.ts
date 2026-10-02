import { KUMPULAN_LABELS_DATA, REGIONS_DATA } from "./regions-data";

export type Kumpulan = "A" | "B" | "C" | "D";

export interface RegionAdjustment {
  state: string;
  district: string;
  A: number;
  B: number;
  C: number;
  D: number;
}

export const KUMPULAN_LABELS: Record<Kumpulan, string> = KUMPULAN_LABELS_DATA;

export const REGIONS: RegionAdjustment[] = REGIONS_DATA;

export const REGION_STATES: string[] = [...new Set(REGIONS.map((r) => r.state))];

/**
 * Every Malaysian state (13) and federal territory (3), canonical casing.
 * The state dropdown always offers all 16 — even those the JKR kawasan
 * adjustment table doesn't cover — because users must be able to locate a
 * project anywhere in Malaysia. States without JKR data simply apply no
 * regional price uplift.
 */
export const ALL_MALAYSIAN_TERRITORIES: { name: string; hasAdjustment: boolean }[] = (() => {
  const covered = new Set(REGION_STATES);
  const order = [
    "JOHOR", "KEDAH", "KELANTAN", "MELAKA", "NEGERI SEMBILAN", "PAHANG",
    "PERAK", "PERLIS", "PULAU PINANG", "SABAH", "SARAWAK", "SELANGOR", "TERENGGANU",
    "WILAYAH PERSEKUTUAN KUALA LUMPUR", "WILAYAH PERSEKUTUAN LABUAN", "WILAYAH PERSEKUTUAN PUTRAJAYA",
  ];
  return order.map((name) => ({ name, hasAdjustment: covered.has(name) }));
})();

export function districtsFor(state: string): RegionAdjustment[] {
  return REGIONS.filter((r) => r.state === state);
}

export function findAdjustment(state?: string | null, district?: string | null): RegionAdjustment | null {
  if (!state || !district) return null;
  return REGIONS.find((r) => r.state === state && r.district === district) ?? null;
}

/** Uplift percentage for a region + distance band; null when unknown. */
export function adjustmentPct(state: string | null | undefined, district: string | null | undefined, kumpulan: Kumpulan | null | undefined): number | null {
  if (!kumpulan) return null;
  const adj = findAdjustment(state, district);
  if (!adj) return null;
  return adj[kumpulan];
}
