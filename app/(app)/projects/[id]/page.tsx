"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Play, Square, FileText, CheckCircle2, Circle, Loader2, Flag, Download, Eye } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, StatusBadge, Skeleton, Modal, Input, Label, EmptyState } from "@/components/ui";
import { formatPrice } from "@/lib/utils";
import { tenderUplift, tenderBreakdown } from "@/lib/pricing";
import { ScanButton } from "@/components/scan-button";
import { StrategyBriefing } from "@/components/strategy-briefing";

/* ---------- types ---------- */
interface Doc { _id: string; filename: string; sizeBytes: number; uploadedAt: string; }
interface BoqItem { _id: string; itemNo: string; description: string; normalisedDescription: string; category: string; quantity: number | null; unit: string | null; }
interface PricingRecord {
  _id: string; description: string; normalisedDescription: string; category: string;
  quantity: number | null; unit: string | null;
  contractorPrice: number | null; contractorPriceSource: string | null;
  benchmarkPrice: number | null; benchmarkPriceSource: string | null;
  hybridPrice: number | null; selectedPrice: number | null; selectedPriceSource: string | null;
  matchConfidence: number | null; reviewFlag: string | null;
}
interface ProjectData {
  project: {
    _id: string; name: string; status: string; currentStage?: string; processingError?: string;
    tenderTitle?: string; tenderNumber?: string; tenderAgency?: string; tenderCategory?: string; closingDate?: string;
    regionState?: string; regionDistrict?: string; regionKumpulan?: string;
    profitMarginPct?: number | null;
    contingencyPct?: number | null;
    strategyNarrative?: string; strategyNarrativeAt?: string; strategyAudioParts?: number;
  };
  documents: Doc[];
  extraction: { title?: string; tenderNumber?: string; agency?: string; category?: string; closingDate?: string; rawTextLength: number; extractedAt: string } | null;
  boqItems: BoqItem[];
  jobs: { _id: string; attempt: number; status: string; stage: string; startedAt: string; finishedAt?: string }[];
}
interface StatusData { running: boolean; currentStage: string | null; processingStartedAt?: string | null; pricing: { total: number; flagged: number; missing: number }; }
interface EstimateData {
  estimate: { credits: number; costUsd: number; multiplier: number; provider: string; model: string; estimatedTokensIn: number; estimatedTokensOut: number };
  balance: number; subscribed: boolean; freeRetry: boolean; sufficient: boolean;
}

/** Rough per-stage weights (relative cost) used only for progress % + ETA. */
const STAGE_WEIGHTS = [1, 3, 2, 3, 2, 3, 2, 2, 3, 4, 0.5];
const TOTAL_WEIGHT = STAGE_WEIGHTS.reduce((a, b) => a + b, 0);

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STAGES: { key: string; label: string }[] = [
  { key: "document_processing", label: "Document Processing" },
  { key: "text_extraction", label: "Text Extraction" },
  { key: "tender_info_extraction", label: "Tender Info" },
  { key: "material_extraction", label: "Material Extraction" },
  { key: "work_extraction", label: "Work / Process" },
  { key: "boq_generation", label: "BOQ Generation" },
  { key: "price_matching", label: "Price Matching" },
  { key: "pricing_analysis", label: "Pricing Analysis" },
  { key: "strategy_narrative", label: "Strategy Briefing" },
  { key: "document_generation", label: "Document Generation" },
  { key: "completed", label: "Completed" },
];

const FLAG_LABELS: Record<string, string> = {
  missing_price: "Missing price",
  off_benchmark: "Off benchmark",
  low_match_confidence: "Low match confidence",
  unit_mismatch: "Unit mismatch",
};

type Tab = "overview" | "boq" | "pricing" | "review" | "history";

export default function ProjectWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ProjectData | null>(null);
  const [pricing, setPricing] = useState<PricingRecord[] | null>(null);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [uploading, setUploading] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<PricingRecord | null>(null);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [estimateFor, setEstimateFor] = useState<string | null>(null); // documentId being estimated
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [needsTopUp, setNeedsTopUp] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    const json = await res.json();
    if (!json.ok) { setError(json.error?.message ?? "Failed to load project."); return; }
    setData(json.data);
  }, [id]);

  const loadPricing = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/pricing`);
    const json = await res.json();
    if (json.ok) setPricing(json.data);
  }, [id]);

  const pollStatus = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/status`);
    const json = await res.json();
    if (json.ok) setStatus(json.data);
    return json.ok ? json.data as StatusData : null;
  }, [id]);

  useEffect(() => { load(); loadPricing(); pollStatus(); }, [load, loadPricing, pollStatus]);

  // Live polling while processing
  useEffect(() => {
    if (!status?.running) return;
    const clock = setInterval(() => setNowTick(Date.now()), 1000);
    const t = setInterval(async () => {
      const s = await pollStatus();
      if (s && !s.running) { load(); loadPricing(); }
    }, 1500);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [status?.running, pollStatus, load, loadPricing]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/projects/${id}/documents`, { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!json.ok) setError(json.error?.message ?? "Upload failed.");
    else load();
  }

  /** Step 1: fetch the credit estimate and show the confirmation modal. */
  async function startProcessing(documentId: string) {
    setError(null);
    setNeedsTopUp(null);
    setEstimate(null);
    setEstimateFor(documentId);
    const res = await fetch(`/api/projects/${id}/estimate?documentId=${documentId}`);
    const json = await res.json();
    if (!json.ok) {
      setEstimateFor(null);
      setError(json.error?.message ?? "Could not estimate cost.");
      return;
    }
    setEstimate(json.data as EstimateData);
  }

  /** Step 2: user confirmed — start the pipeline (server re-checks and deducts). */
  async function confirmProcessing() {
    if (!estimateFor) return;
    setConfirming(true);
    const res = await fetch(`/api/projects/${id}/process`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: estimateFor }),
    });
    const json = await res.json();
    setConfirming(false);
    if (!json.ok) {
      const code = json.error?.code;
      setEstimate(null); setEstimateFor(null);
      if (code === "INSUFFICIENT_CREDITS" || code === "SUBSCRIPTION_REQUIRED") setNeedsTopUp(json.error?.message ?? "Top up required.");
      else setError(json.error?.message ?? "Failed to start processing.");
      return;
    }
    setEstimate(null); setEstimateFor(null);
    pollStatus();
  }

  async function cancelProcessing() {
    await fetch(`/api/projects/${id}/process`, { method: "DELETE" });
    pollStatus();
  }

  if (error && !data) return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;

  const { project } = data;
  const stageIdx = STAGES.findIndex((s) => s.key === (status?.currentStage ?? project.currentStage));
  const running = status?.running ?? false;
  const flagged = pricing?.filter((p) => p.reviewFlag) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} />
          </div>
          {project.tenderTitle && <p className="mt-1 text-sm text-muted-foreground">{project.tenderTitle}</p>}
        </div>
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {needsTopUp && (
        <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
          <span>{needsTopUp}</span>
          <a href="/settings"><Button size="sm">Top up credits</Button></a>
        </p>
      )}
      {project.processingError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{project.processingError}</p>}

      {/* Processing pipeline */}
      {(running || project.currentStage) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Processing Pipeline</CardTitle>
              <CardDescription>{running ? "Your tender is being analysed…" : "Last processing state"}</CardDescription>
            </div>
            {running && <Button variant="outline" size="sm" onClick={cancelProcessing}><Square size={12} /> Cancel</Button>}
          </CardHeader>
          <CardContent>
            {(() => {
              const doneWeight = STAGE_WEIGHTS.slice(0, Math.max(0, stageIdx)).reduce((a, b) => a + b, 0);
              const fraction = stageIdx < 0 ? 0 : Math.min(1, (doneWeight + (STAGE_WEIGHTS[stageIdx] ?? 1) * 0.5) / TOTAL_WEIGHT);
              const pct = running ? Math.max(2, Math.round(fraction * 100)) : (project.status === "completed" ? 100 : Math.round(fraction * 100));
              const startedAt = status?.processingStartedAt ? new Date(status.processingStartedAt).getTime() : null;
              const elapsed = running && startedAt ? nowTick - startedAt : null;
              const eta = elapsed !== null && fraction > 0.05 ? (elapsed / fraction) - elapsed : null;
              return (
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{running ? `Reading your document — ${STAGES[stageIdx]?.label ?? "working"}…` : "Progress"}</span>
                    <span className="font-medium tabular-nums text-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className={`h-full rounded-full bg-primary transition-[width] duration-700 ease-out ${running ? "progress-stripes" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {running && elapsed !== null && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                      <span>Elapsed: {fmtDuration(elapsed)}</span>
                      {eta !== null && eta > 0 && <span>Estimated remaining: ~{fmtDuration(eta)}</span>}
                    </div>
                  )}
                </div>
              );
            })()}
            <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {STAGES.map((s, i) => {
                const state = running || project.currentStage
                  ? i < stageIdx ? "done" : i === stageIdx ? (running ? "active" : s.key === "completed" ? "done" : "active") : "pending"
                  : "pending";
                return (
                  <li key={s.key} className={`flex flex-col items-center gap-1 rounded-md border p-2 text-center text-[11px] ${state === "active" ? "border-primary bg-primary/5" : state === "done" ? "border-success/40 bg-success/5" : "border-border"}`}>
                    {state === "done" ? <CheckCircle2 size={16} className="text-success" /> : state === "active" ? <Loader2 size={16} className="animate-spin text-primary" /> : <Circle size={16} className="text-muted-foreground" />}
                    {s.label}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* AI strategy briefing (audio) */}
      {project.strategyNarrative && <StrategyBriefing narrative={project.strategyNarrative} projectId={id} audioParts={project.strategyAudioParts ?? 0} />}

      {/* Generated deliverables */}
      <GeneratedDocs projectId={id} refreshKey={status?.currentStage} running={running} />

      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tender Documents</CardTitle>
          <CardDescription>PDF, DOCX or TXT — up to 20MB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <ScanButton projectId={id} label="Scan with camera" />
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || running}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-50 cursor-pointer"
          >
            {uploading ? <Loader2 className="animate-spin" /> : <UploadCloud size={24} />}
            {uploading ? "Uploading…" : "Click to upload a tender document"}
          </button>
          {data.documents.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.documents.map((d) => (
                <li key={d._id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><FileText size={14} className="shrink-0 text-muted-foreground" /><span className="truncate">{d.filename}</span>
                    <span className="text-xs text-muted-foreground">({(d.sizeBytes / 1024).toFixed(0)} KB)</span></span>
                  <Button size="sm" disabled={running} onClick={() => startProcessing(d._id)}>
                    {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {running ? "Processing…" : "Process"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {([["overview", "Tender Info"], ["boq", `BOQ (${data.boqItems.length})`], ["pricing", `Pricing (${pricing?.length ?? 0})`], ["review", `Review (${flagged.length})`], ["history", "History"]] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); if (key === "pricing" || key === "review") loadPricing(); }}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${tab === key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <TenderInfo data={data} />}
      {tab === "boq" && <BoqTable items={data.boqItems} />}
      {tab === "pricing" && (
        <div className="space-y-3">
          <MarginBar
            projectId={id}
            marginPct={data.project.profitMarginPct}
            contingencyPct={data.project.contingencyPct}
            pricing={pricing}
            onSaved={(patch) => setData((d) => d ? { ...d, project: { ...d.project, ...patch } } : d)}
          />
          {pricing && pricing.length > 0 && (
            <div className="flex justify-end">
              <a href={`/api/projects/${id}/pricing/export`} download>
                <Button size="sm" variant="outline"><Download size={12} /> Export Priced BOQ (Excel)</Button>
              </a>
            </div>
          )}
          <PricingTable pricing={pricing} marginPct={data.project.profitMarginPct} contingencyPct={data.project.contingencyPct} onOverride={setOverrideTarget} />
        </div>
      )}
      {tab === "review" && <PricingTable pricing={flagged} marginPct={data.project.profitMarginPct} contingencyPct={data.project.contingencyPct} onOverride={setOverrideTarget} reviewMode />}
      {tab === "history" && <JobHistory jobs={data.jobs} />}

      <OverrideModal
        record={overrideTarget}
        onClose={() => setOverrideTarget(null)}
        onSaved={() => { setOverrideTarget(null); loadPricing(); }}
      />

      {/* Credit cost confirmation */}
      <Modal open={!!estimateFor} onClose={() => { setEstimateFor(null); setEstimate(null); }} title="Confirm processing">
        {!estimate ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Estimating cost…</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-sm space-y-1">
              {estimate.freeRetry ? (
                <p className="font-medium text-success">Free retry — your previous attempt failed, so this one is on us.</p>
              ) : (
                <>
                  <p className="flex justify-between text-muted-foreground"><span>Your balance</span><span>{estimate.balance.toLocaleString()} credits</span></p>
                  <p className="flex justify-between"><span>Processing cost</span><span className="font-semibold">{estimate.estimate.credits} credits</span></p>
                  <p className="flex justify-between text-muted-foreground"><span>Balance after processing</span><span>{(Math.round((estimate.balance - estimate.estimate.credits) * 10) / 10).toLocaleString()} credits</span></p>
                </>
              )}
              <p className="pt-1 text-xs text-muted-foreground">
                The cost depends on the document&apos;s size and complexity, and is fixed at this amount — no extra charges afterwards.
              </p>
            </div>
            {!estimate.subscribed && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                An active subscription is required to process tenders.
              </p>
            )}
            {!estimate.freeRetry && estimate.subscribed && !estimate.sufficient && (
              <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-sm">
                Not enough credits for this tender. <a href="/settings" className="font-medium underline">Top up in Settings</a>.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setEstimateFor(null); setEstimate(null); }}>Cancel</Button>
              <Button onClick={confirmProcessing} disabled={confirming || !estimate.subscribed || (!estimate.freeRetry && !estimate.sufficient)}>
                {confirming && <Loader2 size={12} className="animate-spin" />}
                {estimate.freeRetry ? "Start free retry" : `Process for ${estimate.estimate.credits} credits`}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function TenderInfo({ data }: { data: ProjectData }) {
  const e = data.extraction;
  if (!e) return <EmptyState title="No extraction yet" description="Upload a tender document and run processing to extract tender information." />;
  const rows: [string, string | undefined][] = [
    ["Tender title", e.title],
    ["Project region", data.project.regionState
      ? `${data.project.regionDistrict ?? "—"}, ${data.project.regionState}${data.project.regionKumpulan ? ` (Kumpulan ${data.project.regionKumpulan})` : ""}`
      : undefined],
    ["Tender number", e.tenderNumber],
    ["Agency", e.agency],
    ["Category", e.category],
    ["Closing date", e.closingDate ? new Date(e.closingDate).toLocaleDateString("en-MY") : undefined],
    ["Text extracted", `${e.rawTextLength.toLocaleString()} characters`],
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Extracted Tender Information</CardTitle></CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="mt-1 text-sm">{v ?? <span className="text-muted-foreground">Not detected</span>}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function BoqTable({ items }: { items: BoqItem[] }) {
  if (items.length === 0) return <EmptyState title="No BOQ items" description="Process a tender document to generate the Bill of Quantities." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3 font-medium text-right">Qty</th>
            <th className="px-4 py-3 font-medium">Unit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {items.map((it) => (
            <tr key={it._id} className="hover:bg-muted/40">
              <td className="px-4 py-3 text-muted-foreground">{it.itemNo}</td>
              <td className="px-4 py-3">
                <p className="font-medium">{it.description}</p>
                {it.normalisedDescription !== it.description.toLowerCase() && (
                  <p className="mt-0.5 text-xs text-muted-foreground">normalised: {it.normalisedDescription}</p>
                )}
              </td>
              <td className="px-4 py-3"><Badge variant="secondary">{it.category}</Badge></td>
              <td className="px-4 py-3 text-right">{it.quantity ?? "—"}</td>
              <td className="px-4 py-3">{it.unit ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Contingency + profit margin editor with live totals: cost → contingency → margin → tender. */
function MarginBar({ projectId, marginPct, contingencyPct, pricing, onSaved }: {
  projectId: string;
  marginPct: number | null | undefined;
  contingencyPct: number | null | undefined;
  pricing: PricingRecord[] | null;
  onSaved: (patch: { profitMarginPct?: number | null; contingencyPct?: number | null }) => void;
}) {
  const [marginValue, setMarginValue] = useState(marginPct != null ? String(marginPct) : "");
  const [contValue, setContValue] = useState(contingencyPct != null ? String(contingencyPct) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep inputs in sync if the project reloads with different values.
  useEffect(() => { setMarginValue(marginPct != null ? String(marginPct) : ""); }, [marginPct]);
  useEffect(() => { setContValue(contingencyPct != null ? String(contingencyPct) : ""); }, [contingencyPct]);

  const margin = marginValue.trim() === "" ? null : Number(marginValue);
  const contingency = contValue.trim() === "" ? null : Number(contValue);
  const marginValid = margin === null || (Number.isFinite(margin) && margin >= 0 && margin <= 100);
  const contValid = contingency === null || (Number.isFinite(contingency) && contingency >= 0 && contingency <= 100);

  async function saveField(field: "profitMarginPct" | "contingencyPct", pct: number | null) {
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: pct }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.ok) { setSaveError(json.error?.message ?? "Could not save."); return; }
    onSaved({ [field]: pct });
  }

  const cost = (pricing ?? []).reduce((s, p) => s + (p.selectedPrice ?? 0) * (p.quantity ?? 1), 0);
  const showBreakdown = (margin != null && marginValid) || (contingency != null && contValid);
  const bd = tenderBreakdown(
    cost,
    margin != null && marginValid ? margin : null,
    contingency != null && contValid ? contingency : null
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <PctField
          id="contingency"
          label="Contingency"
          value={contValue}
          onChange={setContValue}
          onCommit={(v) => { if (contValid && v !== (contingencyPct ?? null)) saveField("contingencyPct", v); }}
        />
        <PctField
          id="profit-margin"
          label="Profit margin"
          value={marginValue}
          onChange={setMarginValue}
          onCommit={(v) => { if (marginValid && v !== (marginPct ?? null)) saveField("profitMarginPct", v); }}
        />
        <div className="flex gap-1.5">
          {[5, 10, 15, 20].map((p) => (
            <button
              key={p}
              onClick={() => { setMarginValue(String(p)); saveField("profitMarginPct", p); }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${margin === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
            >
              {p}%
            </button>
          ))}
          {(margin != null || contingency != null) && (
            <button
              onClick={() => {
                setMarginValue(""); setContValue("");
                saveField("profitMarginPct", null);
                saveField("contingencyPct", null);
              }}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        {saving && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        {pricing && pricing.length > 0 && (
          <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Cost <span className="font-medium text-foreground">{formatPrice(Math.round(bd.cost * 100) / 100)}</span></span>
            {contingency != null && contValid && (
              <span className="text-muted-foreground">+ Contingency {contingency}% <span className="font-medium text-foreground">{formatPrice(Math.round(bd.contingencyAmount * 100) / 100)}</span></span>
            )}
            {margin != null && marginValid && (
              <span className="text-muted-foreground">+ Margin {margin}% <span className="font-medium text-foreground">{formatPrice(Math.round(bd.marginAmount * 100) / 100)}</span></span>
            )}
            {showBreakdown && (
              <span className="text-base font-semibold">Tender {formatPrice(Math.round(bd.tender * 100) / 100)}</span>
            )}
          </div>
        )}
      </div>
      {saveError && <p role="alert" className="mt-2 text-sm text-destructive">{saveError}</p>}
      {!marginValid && <p role="alert" className="mt-2 text-sm text-destructive">Profit margin must be between 0 and 100%.</p>}
      {!contValid && <p role="alert" className="mt-2 text-sm text-destructive">Contingency must be between 0 and 100%.</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Tender price = cost × (1 + contingency%) × (1 + margin%). Contingency covers unforeseen costs; margin is your markup on top.
      </p>
    </div>
  );
}

/** A labelled percentage input that commits on blur. */
function PctField({ id, label, value, onChange, onCommit }: {
  id: string; label: string; value: string; onChange: (v: string) => void; onCommit: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-sm font-medium">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={0}
          max={100}
          step={0.5}
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit(value.trim() === "" ? null : Number(value))}
          className="w-24 pr-7 text-right"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">%</span>
      </div>
    </div>
  );
}

function PricingTable({ pricing, marginPct = null, contingencyPct = null, onOverride, reviewMode = false }: { pricing: PricingRecord[] | null; marginPct?: number | null; contingencyPct?: number | null; onOverride: (r: PricingRecord) => void; reviewMode?: boolean }) {
  if (pricing === null) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (pricing.length === 0) {
    return <EmptyState title={reviewMode ? "Nothing to review" : "No pricing yet"} description={reviewMode ? "All pricing records are clear of review flags." : "Process a tender document to generate pricing."} />;
  }
  const total = pricing.reduce((s, p) => s + (p.selectedPrice ?? 0) * (p.quantity ?? 1), 0);
  const uplift = tenderUplift(marginPct, contingencyPct);
  const tenderTotal = uplift != null ? total * uplift : null;
  const upliftLabel = [
    contingencyPct != null && contingencyPct > 0 ? `${contingencyPct}% contingency` : null,
    marginPct != null && marginPct > 0 ? `${marginPct}% margin` : null,
  ].filter(Boolean).join(" + ");
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-4 text-sm">
        <p className="text-muted-foreground">Cost total: <span className="font-semibold text-foreground">{formatPrice(Math.round(total * 100) / 100)}</span></p>
        {tenderTotal != null && (
          <p className="text-muted-foreground">Tender total (incl. {upliftLabel}): <span className="font-semibold text-foreground">{formatPrice(Math.round(tenderTotal * 100) / 100)}</span></p>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border pb-1">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium">Item</th>
              <th className="px-3 py-3 font-medium text-right">Qty</th>
              <th className="px-3 py-3 font-medium">Unit</th>
              <th className="px-3 py-3 font-medium text-right">Contractor</th>
              <th className="px-3 py-3 font-medium text-right">Benchmark</th>
              <th className="px-3 py-3 font-medium text-right">Hybrid</th>
              <th className="px-3 py-3 font-medium text-right">Cost</th>
              {uplift != null && <th className="px-3 py-3 font-medium text-right">Tender</th>}
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="px-3 py-3 font-medium">Conf.</th>
              <th className="px-3 py-3 font-medium">Flag</th>
              <th className="sticky right-0 bg-muted/95 px-3 py-3 backdrop-blur" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {pricing.map((p) => (
              <tr key={p._id} className={p.reviewFlag ? "bg-warning/5" : undefined}>
                <td className="max-w-[260px] px-3 py-3">
                  <p className="line-clamp-2 font-medium">{p.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.benchmarkPriceSource ?? p.contractorPriceSource ?? "no source"}</p>
                </td>
                <td className="px-3 py-3 text-right">{p.quantity ?? "—"}</td>
                <td className="px-3 py-3">{p.unit ?? "—"}</td>
                <td className="px-3 py-3 text-right">{formatPrice(p.contractorPrice)}</td>
                <td className="px-3 py-3 text-right">{formatPrice(p.benchmarkPrice)}</td>
                <td className="px-3 py-3 text-right">{formatPrice(p.hybridPrice)}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatPrice(p.selectedPrice)}</td>
                {uplift != null && (
                  <td className="px-3 py-3 text-right font-semibold text-primary">
                    {p.selectedPrice != null ? formatPrice(Math.round(p.selectedPrice * uplift * 100) / 100) : "—"}
                  </td>
                )}
                <td className="px-3 py-3">{p.selectedPriceSource ? <Badge variant="secondary">{p.selectedPriceSource}</Badge> : "—"}</td>
                <td className="px-3 py-3">{p.matchConfidence != null ? `${Math.round(p.matchConfidence * 100)}%` : "—"}</td>
                <td className="px-3 py-3">
                  {p.reviewFlag ? <Badge variant="warning"><Flag size={10} className="mr-1" />{FLAG_LABELS[p.reviewFlag] ?? p.reviewFlag}</Badge> : <span className="text-success">✓</span>}
                </td>
                <td className={`sticky right-0 px-3 py-3 text-right shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.25)] ${p.reviewFlag ? "bg-warning/10" : "bg-card"}`}>
                  <Button variant="outline" size="sm" onClick={() => onOverride(p)}>Override</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OverrideModal({ record, onClose, onSaved }: { record: PricingRecord | null; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrice(record?.selectedPrice != null ? String(record.selectedPrice) : "");
    setNote("");
    setError(null);
  }, [record]);

  async function save() {
    if (!record) return;
    const v = parseFloat(price);
    if (isNaN(v) || v <= 0) { setError("Enter a valid positive price."); return; }
    setSaving(true);
    const res = await fetch(`/api/pricing/${record._id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manualPrice: v, note }),
    });
    const json = await res.json();
    setSaving(false);
    if (!json.ok) { setError(json.error?.message ?? "Save failed."); return; }
    onSaved();
  }

  return (
    <Modal open={!!record} onClose={onClose} title="Manual price override">
      {record && (
        <div className="space-y-4">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{record.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Contractor: {formatPrice(record.contractorPrice)} · Benchmark: {formatPrice(record.benchmarkPrice)} · Hybrid: {formatPrice(record.hybridPrice)}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-price">Your price (RM per {record.unit ?? "unit"})</Label>
            <Input id="manual-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-note">Reason (optional, recorded in audit log)</Label>
            <Input id="override-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Current supplier quotation" />
          </div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save override"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function JobHistory({ jobs }: { jobs: ProjectData["jobs"] }) {
  if (jobs.length === 0) return <EmptyState title="No processing history" description="Processing attempts will appear here." />;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Attempt</th>
            <th className="px-4 py-3 font-medium">Stage</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium">Finished</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {jobs.map((j) => (
            <tr key={j._id}>
              <td className="px-4 py-3">#{j.attempt}</td>
              <td className="px-4 py-3 text-muted-foreground">{j.stage.replaceAll("_", " ")}</td>
              <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
              <td className="px-4 py-3 text-muted-foreground">{new Date(j.startedAt).toLocaleString("en-MY")}</td>
              <td className="px-4 py-3 text-muted-foreground">{j.finishedAt ? new Date(j.finishedAt).toLocaleString("en-MY") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- generated deliverables ---------- */
interface GeneratedDoc { _id: string; type: string; title: string; filename: string; contentType: string; size: number; createdAt: string; }

/* ---------- deliverable preview ---------- */
interface XlsxCell { v: string; bold?: boolean; numFmt?: string }
interface XlsxRow { cells: XlsxCell[]; isHeader?: boolean; isSection?: boolean }
type PreviewData =
  | { kind: "xlsx"; title: string; filename: string; sheetName: string; columns: number; colWidths: number[]; rows: XlsxRow[]; truncated: boolean }
  | { kind: "docx"; title: string; filename: string; html: string }
  | { kind: "pdf"; title: string; filename: string };

function DeliverablePreview({ projectId, doc, onClose }: { projectId: string; doc: GeneratedDoc; onClose: () => void }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setError(null);
    fetch(`/api/projects/${projectId}/documents/${doc._id}/preview`)
      .then((r) => r.json())
      .then((j) => { if (j.ok) setData(j.data as PreviewData); else setError(j.error?.message ?? "Preview unavailable."); })
      .catch(() => setError("Preview unavailable."));
  }, [projectId, doc._id]);

  const downloadUrl = `/api/projects/${projectId}/documents/${doc._id}/download`;

  return (
    <Modal open onClose={onClose} title={doc.title} className="max-w-5xl">
      <div className="max-h-[75dvh] overflow-auto">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            <a href={downloadUrl} download={doc.filename}><Button size="sm" variant="outline"><Download size={12} /> Download instead</Button></a>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading preview…</div>
        ) : data.kind === "pdf" ? (
          <iframe src={downloadUrl} title={data.title} className="h-[70dvh] w-full rounded-md border border-border bg-white" />
        ) : data.kind === "docx" ? (
          <div
            className="prose prose-sm max-w-none rounded-md border border-border bg-background p-4 text-foreground [&_h1]:text-lg [&_h2]:text-base [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1"
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        ) : (
          <XlsxTable data={data} />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {data?.kind === "xlsx" ? `Sheet: ${data.sheetName}${data.truncated ? " · showing first 300 rows" : ""}` : data?.filename ?? doc.filename}
        </p>
        <a href={downloadUrl} download={doc.filename}><Button size="sm" variant="outline"><Download size={12} /> Download</Button></a>
      </div>
    </Modal>
  );
}

function XlsxTable({ data }: { data: Extract<PreviewData, { kind: "xlsx" }> }) {
  if (data.rows.length === 0) return <EmptyState title="Empty sheet" description="This spreadsheet has no visible rows." />;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className={row.isHeader ? "bg-primary/10 font-semibold" : row.isSection ? "bg-muted font-semibold" : ri % 2 ? "bg-muted/30" : undefined}>
              {Array.from({ length: data.columns }, (_, ci) => {
                const cell = row.cells[ci];
                return (
                  <td
                    key={ci}
                    className={`border-b border-border px-2 py-1.5 align-top ${cell?.bold ? "font-semibold" : ""} ${cell?.numFmt?.includes("#") ? "text-right tabular-nums" : ""}`}
                    style={{ minWidth: data.colWidths[ci] ? Math.min(200, data.colWidths[ci] * 7) : undefined }}
                  >
                    {cell?.v ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeneratedDocs({ projectId, refreshKey, running }: { projectId: string; refreshKey?: string | null; running: boolean }) {
  const [docs, setDocs] = useState<GeneratedDoc[] | null>(null);
  const [previewing, setPreviewing] = useState<GeneratedDoc | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/documents`);
    const json = await res.json();
    if (json.ok) setDocs(json.data.documents);
  }, [projectId]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generated Deliverables</CardTitle>
        <CardDescription>
          Tender documents produced after processing — BOQ, method statement, specifications, and more.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {docs === null ? (
          <Skeleton className="h-12 w-full" />
        ) : docs.length === 0 ? (
          <EmptyState title="No deliverables yet" description="Process a tender document to generate its deliverable pack." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {docs.map((d) => (
              <li key={d._id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.title}</span>
                  <span className="text-xs text-muted-foreground">({(d.size / 1024).toFixed(0)} KB)</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPreviewing(d)}><Eye size={12} /> Preview</Button>
                  <a href={`/api/projects/${projectId}/documents/${d._id}/download`} download={d.filename}>
                    <Button size="sm" variant="outline"><Download size={12} /> Download</Button>
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {previewing && <DeliverablePreview projectId={projectId} doc={previewing} onClose={() => setPreviewing(null)} />}
    </Card>
  );
}
