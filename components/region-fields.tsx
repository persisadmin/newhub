"use client";
import { Label } from "@/components/ui";
import { ALL_MALAYSIAN_TERRITORIES, districtsFor, KUMPULAN_LABELS, type Kumpulan } from "@/lib/regions";

export interface RegionValue {
  regionState?: string;
  regionDistrict?: string;
  regionKumpulan?: Kumpulan;
}

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Cascading JKR region pickers: state → district → distance band (kumpulan). */
export function RegionFields({ value, onChange }: { value: RegionValue; onChange: (v: RegionValue) => void }) {
  const districts = value.regionState ? districtsFor(value.regionState) : [];
  const adj = value.regionState && value.regionDistrict
    ? districts.find((d) => d.district === value.regionDistrict)
    : null;

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <p className="text-sm font-medium">Project region <span className="font-normal text-muted-foreground">(JKR kawasan adjustment)</span></p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="region-state">State</Label>
          <select
            id="region-state"
            className={selectCls}
            value={value.regionState ?? ""}
            onChange={(e) => onChange({ regionState: e.target.value || undefined })}
          >
            <option value="">—</option>
            <optgroup label="States">
              {ALL_MALAYSIAN_TERRITORIES.filter((t) => !t.name.startsWith("WILAYAH")).map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Federal Territories">
              {ALL_MALAYSIAN_TERRITORIES.filter((t) => t.name.startsWith("WILAYAH")).map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region-district">District</Label>
          <select
            id="region-district"
            className={selectCls}
            disabled={!value.regionState || districts.length === 0}
            value={value.regionDistrict ?? ""}
            onChange={(e) => onChange({ ...value, regionDistrict: e.target.value || undefined })}
          >
            <option value="">—</option>
            {districts.map((d) => <option key={d.district} value={d.district}>{d.district}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region-kumpulan">Distance band</Label>
          <select
            id="region-kumpulan"
            className={selectCls}
            disabled={!value.regionDistrict || districts.length === 0}
            value={value.regionKumpulan ?? ""}
            onChange={(e) => onChange({ ...value, regionKumpulan: (e.target.value || undefined) as Kumpulan | undefined })}
          >
            <option value="">—</option>
            {(Object.keys(KUMPULAN_LABELS) as Kumpulan[]).map((k) => (
              <option key={k} value={k}>
                {k} — {KUMPULAN_LABELS[k]}{adj ? ` (+${adj[k]}%)` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      {value.regionState && districts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No JKR kawasan adjustment is available for {value.regionState} — benchmark prices will be used without a regional uplift.
        </p>
      )}
      {adj && value.regionKumpulan && (
        <p className="text-xs text-muted-foreground">
          JKR benchmark prices will be adjusted by <span className="font-medium text-foreground">+{adj[value.regionKumpulan]}%</span> for {value.regionDistrict}, {value.regionState}.
        </p>
      )}
    </div>
  );
}
