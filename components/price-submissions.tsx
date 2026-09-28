"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, Eye, Check, Trash2, FileText } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Badge, Skeleton, Modal } from "@/components/ui";

interface SubmissionSummary {
  _id: string;
  kind: "benchmark" | "quotation";
  sourceName: string;
  filename: string;
  rowCount: number;
  status: "pending_review" | "committed" | "discarded";
  userEmail: string;
  effectiveDate: string | null;
  committedRows: number | null;
  createdAt: string;
}

interface PriceRow { description: string; unit: string; price: number }

const STATUS_VARIANT: Record<SubmissionSummary["status"], "default" | "success" | "secondary"> = {
  pending_review: "default",
  committed: "success",
  discarded: "secondary",
};

/**
 * Shared price-submission panel. kind="benchmark" is the admin agency price
 * list flow; kind="quotation" is the user supplier-quotation flow.
 */
export function PriceSubmissions({ kind }: { kind: "benchmark" | "quotation" }) {
  const [subs, setSubs] = useState<SubmissionSummary[] | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<SubmissionSummary | null>(null);
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [acting, setActing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isBenchmark = kind === "benchmark";

  const load = useCallback(async () => {
    const res = await fetch(`/api/prices/submissions?kind=${kind}`);
    const json = await res.json();
    if (json.ok) setSubs(json.data.submissions);
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!file || !sourceName.trim()) return;
    setBusy(true); setError(null); setMessage(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    fd.append("sourceName", sourceName.trim());
    if (isBenchmark && effectiveDate) fd.append("effectiveDate", effectiveDate);
    const res = await fetch("/api/prices/submissions", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (json.ok) {
      setMessage(`Extracted ${json.data.rows} priced items — review and commit below.`);
      setSourceName(""); setEffectiveDate(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } else {
      setError(json.error?.message ?? "Submission failed.");
    }
  }

  async function openReview(s: SubmissionSummary) {
    setReviewing(s); setRows(null);
    const res = await fetch(`/api/prices/submissions/${s._id}`);
    const json = await res.json();
    if (json.ok) setRows(json.data.submission.rows);
  }

  async function commit() {
    if (!reviewing) return;
    setActing(true);
    const res = await fetch(`/api/prices/submissions/${reviewing._id}`, { method: "POST" });
    const json = await res.json();
    setActing(false);
    if (json.ok) {
      setMessage(`Committed ${json.data.committed} prices ${isBenchmark ? "to the benchmark library" : "to your price library"}.`);
      setReviewing(null);
      load();
    } else {
      setError(json.error?.message ?? "Commit failed.");
    }
  }

  async function discard() {
    if (!reviewing) return;
    setActing(true);
    await fetch(`/api/prices/submissions/${reviewing._id}`, { method: "DELETE" });
    setActing(false);
    setReviewing(null);
    load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isBenchmark ? "Submit an agency price list" : "Submit a supplier quotation"}</CardTitle>
          <CardDescription>
            {isBenchmark
              ? "Upload the latest price schedule from a government agency (JKR, CIDB, etc.). The AI extracts every priced item for your review; once committed, the new rates replace that agency's previous ones."
              : "Upload a supplier's quotation (PDF, DOCX, TXT or CSV). The AI extracts the quoted items for your review; once committed, they join your price library and take priority over benchmark rates in future tenders."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{isBenchmark ? "Agency name" : "Supplier name"}</Label>
              <Input className="w-56" placeholder={isBenchmark ? "e.g. JKR Johor" : "e.g. ABC Hardware Sdn Bhd"}
                value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
            </div>
            {isBenchmark && (
              <div className="space-y-1">
                <Label className="text-xs">Effective date</Label>
                <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Document</Label>
              <Input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button onClick={submit} disabled={busy || !file || sourceName.trim().length < 2}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {busy ? "Extracting…" : "Extract prices"}
            </Button>
          </div>
          {busy && <p className="text-xs text-muted-foreground">Reading the document and extracting priced items — large price lists can take a minute or two.</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {message && <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {subs === null ? (
            <Skeleton className="h-16 w-full" />
          ) : subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {subs.map((s) => (
                <li key={s._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="flex items-start gap-3">
                    <FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {s.sourceName} <Badge variant={STATUS_VARIANT[s.status]}>{s.status.replace("_", " ")}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.filename} · {s.rowCount} items{s.committedRows != null ? ` · ${s.committedRows} committed` : ""}
                        {s.effectiveDate ? ` · effective ${new Date(s.effectiveDate).toLocaleDateString("en-MY")}` : ""}
                        {" · "}{new Date(s.createdAt).toLocaleString("en-MY")}
                        {isBenchmark ? ` · by ${s.userEmail}` : ""}
                      </p>
                    </div>
                  </div>
                  {s.status === "pending_review" && (
                    <Button size="sm" variant="outline" onClick={() => openReview(s)}>
                      <Eye size={12} /> Review
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={!!reviewing} onClose={() => setReviewing(null)} title={`Review — ${reviewing?.sourceName ?? ""}`}>
        {!rows ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading rows…</div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {rows.length} priced items extracted from <span className="font-medium">{reviewing?.filename}</span>.
              Commit adds them to {isBenchmark ? "the benchmark library (replacing this agency's previous rates)" : "your price library"}.
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/95 backdrop-blur">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">Rate (RM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{r.description}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="px-3 py-2 text-xs text-muted-foreground">Showing first 500 of {rows.length} rows.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={discard} disabled={acting}>
                <Trash2 size={12} /> Discard
              </Button>
              <Button onClick={commit} disabled={acting}>
                {acting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Commit {rows.length} prices
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
