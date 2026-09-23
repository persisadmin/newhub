import table from "@/scripts/data/jkh-elektrik-2023-regions.json";

export type Kumpulan = "A" | "B" | "C" | "D";

export interface RegionAdjustment {
  state: string;
  district: string;
  A: number;
  B: number;
  C: number;
  D: number;
}

export const KUMPULAN_LABELS: Record<Kumpulan, string> = table.kumpulan as Record<Kumpulan, string>;

export const REGIONS: RegionAdjustment[] = table.regions as RegionAdjustment[];

export const REGION_STATES: string[] = [...new Set(REGIONS.map((r) => r.state))];

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
