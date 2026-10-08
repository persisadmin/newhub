"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Textarea } from "@/components/ui";
import { RegionFields, type RegionValue } from "@/components/region-fields";

/**
 * Guided 3-step project-creation wizard.
 * Replaces the old single long form (name + description + region + pricing all
 * at once), which buried the primary action and forced first-time users past
 * pricing-tuning concepts they don't yet understand.
 *
 *   Step 1 — Name it         (the only required input)
 *   Step 2 — Upload tender   (the thing the user already has in hand; skippable)
 *   Step 3 — Fine-tune       (region + pricing, optional, collapsed by default)
 *
 * Each step presents ONE primary action, auto-focused; back navigation keeps state.
 */

const STEPS = ["Name your project", "Upload the tender", "Fine-tune (optional)"] as const;

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Step 2
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Step 3
  const [region, setRegion] = useState<RegionValue>({});
  const [profitMargin, setProfitMargin] = useState("");
  const [contingency, setContingency] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const marginNum = profitMargin.trim() === "" ? null : Number(profitMargin);
  const contingencyNum = contingency.trim() === "" ? null : Number(contingency);
  const marginValid = marginNum === null || (Number.isFinite(marginNum) && marginNum >= 0 && marginNum <= 100);
  const contingencyValid = contingencyNum === null || (Number.isFinite(contingencyNum) && contingencyNum >= 0 && contingencyNum <= 100);

  const nameValid = name.trim().length >= 2;

  function goNext() {
    setError(null);
    if (step === 0 && !nameValid) { nameRef.current?.focus(); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onCreate() {
    setError(null);
    setLoading(true);
    // 1) Create the project.
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        ...region,
        profitMarginPct: marginNum,
        contingencyPct: contingencyNum,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setLoading(false);
      setError(data.error?.message ?? "Failed to create project.");
      return;
    }
    const projectId = data.data.id as string;

    // 2) If a tender file was attached, upload it now so the detail page opens
    //    already showing "Ready — Process".
    if (file) {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) {
        // Project exists — still send the user there, but flag the upload failure.
        setLoading(false);
        router.push(`/projects/${projectId}?uploadError=${encodeURIComponent(upJson.error?.message ?? "Upload failed")}`);
        return;
      }
    }
    router.push(`/projects/${projectId}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* Progress indicator */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Creation progress">
        {STEPS.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  state === "done" ? "bg-success text-white" : state === "active" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
                aria-current={state === "active" ? "step" : undefined}
              >
                {state === "done" ? <Check size={14} /> : i + 1}
              </span>
              <span className={`hidden text-xs sm:block ${state === "active" ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
              {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-success" : "bg-border"}`} />}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardContent className="pt-6">
          {/* STEP 1 — Name it */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Name your project</h2>
                <p className="text-sm text-muted-foreground">Give this tender a name you&apos;ll recognise.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Project name</Label>
                <Input
                  ref={nameRef}
                  id="name"
                  required
                  minLength={2}
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); goNext(); } }}
                  placeholder="e.g. JKR School Upgrade Tender 2026"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes about this tender…" />
              </div>
              <WizardFooter
                back={<Link href="/projects"><Button type="button" variant="outline">Cancel</Button></Link>}
                next={<Button onClick={goNext} disabled={!nameValid}>Continue <ArrowRight size={14} /></Button>}
              />
            </div>
          )}

          {/* STEP 2 — Upload tender */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Upload the tender document</h2>
                <p className="text-sm text-muted-foreground">PDF, DOCX or TXT — up to 20MB. You can also do this later.</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}
              />
              {file ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText size={16} className="shrink-0 text-primary" />
                    <span className="truncate font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
                  </span>
                  <button onClick={() => setFile(null)} aria-label="Remove file" className="cursor-pointer text-muted-foreground hover:text-destructive"><X size={16} /></button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 py-10 text-sm text-foreground transition-colors hover:bg-primary/10"
                >
                  <UploadCloud size={28} className="text-primary" />
                  <span className="font-medium">Click to choose your tender document</span>
                  <span className="text-xs text-muted-foreground">or drag and drop it here</span>
                </button>
              )}
              <WizardFooter
                back={<Button type="button" variant="outline" onClick={goBack}><ArrowLeft size={14} /> Back</Button>}
                next={
                  <div className="flex gap-2">
                    {!file && <Button type="button" variant="ghost" onClick={goNext}>Skip for now</Button>}
                    <Button onClick={goNext}>{file ? "Continue" : "Continue"} <ArrowRight size={14} /></Button>
                  </div>
                }
              />
            </div>
          )}

          {/* STEP 3 — Fine-tune (optional) */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Fine-tune <span className="font-normal text-muted-foreground">(optional)</span></h2>
                <p className="text-sm text-muted-foreground">Region and pricing help PERSIS benchmark accurately. You can change these anytime — safe to skip.</p>
              </div>

              {!showAdvanced ? (
                <button
                  onClick={() => setShowAdvanced(true)}
                  className="w-full cursor-pointer rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  Set region &amp; pricing adjustments →
                </button>
              ) : (
                <div className="space-y-4">
                  <RegionFields value={region} onChange={setRegion} />
                  <div className="space-y-3 rounded-md border border-border p-4">
                    <p className="text-sm font-medium">Pricing</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="contingency">Contingency sum</Label>
                        <div className="relative">
                          <Input id="contingency" type="number" min={0} max={100} step={0.5} placeholder="0" value={contingency} onChange={(e) => setContingency(e.target.value)} className="pr-7 text-right" />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Buffer for unforeseen costs, applied before margin.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="profit-margin">Target profit margin</Label>
                        <div className="relative">
                          <Input id="profit-margin" type="number" min={0} max={100} step={0.5} placeholder="0" value={profitMargin} onChange={(e) => setProfitMargin(e.target.value)} className="pr-7 text-right" />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Your markup on top of cost + contingency.</p>
                      </div>
                    </div>
                    {!marginValid && <p role="alert" className="text-xs text-destructive">Profit margin must be between 0 and 100%.</p>}
                    {!contingencyValid && <p role="alert" className="text-xs text-destructive">Contingency must be between 0 and 100%.</p>}
                  </div>
                </div>
              )}

              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <WizardFooter
                back={<Button type="button" variant="outline" onClick={goBack} disabled={loading}><ArrowLeft size={14} /> Back</Button>}
                next={
                  <Button onClick={onCreate} disabled={loading || !marginValid || !contingencyValid} autoFocus={!showAdvanced}>
                    {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                    {file ? "Create & upload" : "Create project"}
                  </Button>
                }
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Consistent footer: back on the left, primary action on the right. */
function WizardFooter({ back, next }: { back: React.ReactNode; next: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
      <div>{back}</div>
      <div>{next}</div>
    </div>
  );
}
