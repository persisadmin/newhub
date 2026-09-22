"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";
import { Badge, Button, EmptyState, Input, Label, Modal, Skeleton } from "@/components/ui";
import { formatPrice } from "@/lib/utils";

interface FlaggedRecord {
  _id: string;
  projectId: string;
  project: { _id: string; name: string };
  description: string;
  quantity: number | null;
  unit: string | null;
  contractorPrice: number | null;
  benchmarkPrice: number | null;
  hybridPrice: number | null;
  selectedPrice: number | null;
  selectedPriceSource: string | null;
  matchConfidence: number | null;
  reviewFlag: string;
  benchmarkPriceSource: string | null;
}

const FLAG_LABELS: Record<string, string> = {
  missing_price: "Missing price",
  off_benchmark: "Off benchmark",
  low_match_confidence: "Low match confidence",
  unit_mismatch: "Unit mismatch",
};

const RECOMMENDED: Record<string, string> = {
  missing_price: "No price source matched. Enter a manual price or add the item to your contractor price library.",
  off_benchmark: "Contractor price deviates significantly from benchmark. Verify against current supplier quotes.",
  low_match_confidence: "The description match is weak. Confirm the matched source describes the same item.",
  unit_mismatch: "Units could not be reconciled between tender and reference. Verify quantity and unit manually.",
};

export default function PricingReviewPage() {
  const [records, setRecords] = useState<FlaggedRecord[] | null>(null);
  const [target, setTarget] = useState<FlaggedRecord | null>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/pricing/review");
    const json = await res.json();
    if (json.ok) setRecords(json.data);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!target) return;
    const v = parseFloat(price);
    if (isNaN(v) || v <= 0) { setError("Enter a valid positive price."); return; }
    setSaving(true);
    const res = await fetch(`/api/pricing/${target._id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manualPrice: v, note }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.ok) { setError(json.error?.message ?? "Save failed."); return; }
    setTarget(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing Review</h1>
        <p className="text-sm text-muted-foreground">
          All flagged pricing items across your projects. PERSIS assists — you decide.
        </p>
      </div>

      {records === null ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : records.length === 0 ? (
        <EmptyState title="Nothing to review" description="No pricing records currently carry a review flag. New flags appear here automatically after processing." />
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div key={r._id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning"><Flag size={10} className="mr-1" />{FLAG_LABELS[r.reviewFlag] ?? r.reviewFlag}</Badge>
                    <Link href={`/projects/${r.projectId}`} className="text-xs text-primary hover:underline">{r.project.name}</Link>
                  </div>
                  <p className="mt-2 font-medium">{r.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Qty {r.quantity ?? "—"} {r.unit ?? ""} · Source: {r.benchmarkPriceSource ?? "none"} · Match confidence: {r.matchConfidence != null ? `${Math.round(r.matchConfidence * 100)}%` : "—"}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p>Contractor: <span className="font-medium">{formatPrice(r.contractorPrice)}</span></p>
                  <p>Benchmark: <span className="font-medium">{formatPrice(r.benchmarkPrice)}</span></p>
                  <p>Hybrid: <span className="font-medium">{formatPrice(r.hybridPrice)}</span></p>
                  <p className="mt-1 font-semibold">Selected: {formatPrice(r.selectedPrice)} {r.selectedPriceSource && <span className="text-xs font-normal text-muted-foreground">({r.selectedPriceSource})</span>}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended: </span>{RECOMMENDED[r.reviewFlag]}</p>
                <Button size="sm" variant="outline" onClick={() => { setTarget(r); setPrice(r.selectedPrice != null ? String(r.selectedPrice) : ""); setNote(""); setError(null); }}>
                  Set manual price
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Manual price override">
        {target && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{target.description}</p>
            <div className="space-y-2">
              <Label htmlFor="rp">Price (RM per {target.unit ?? "unit"})</Label>
              <Input id="rp" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rn">Reason (recorded in audit log)</Label>
              <Input id="rn" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save override"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
