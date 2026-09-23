"use client";
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2, FlaskConical, Loader2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Badge, Skeleton } from "@/components/ui";

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  vision: boolean;
}

interface Features {
  generateDocs: boolean;
  pricingAssist: boolean;
  ocrMaxPages: number;
  pricingBatchSize: number;
}

interface TestResult { ok: boolean; latencyMs?: number; reply?: string; returnedModel?: string | null; error?: string; }

export default function AdminLlmSettingsPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings");
      if (res.status === 403) { setForbidden(true); return; }
      const json = await res.json();
      if (json.ok) { setProviders(json.data.settings.providers); setFeatures(json.data.settings.features); }
    })();
  }, []);

  if (forbidden) return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Admin access required.</p>;
  if (!providers || !features) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-72 w-full" /></div>;

  function update(id: string, patch: Partial<Provider>) {
    setProviders((ps) => ps!.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function move(id: string, dir: -1 | 1) {
    setProviders((ps) => {
      const idx = ps!.findIndex((p) => p.id === id);
      const to = idx + dir;
      if (to < 0 || to >= ps!.length) return ps;
      const next = [...ps!];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }
  function addProvider() {
    const id = `custom-${Date.now()}`;
    setProviders((ps) => [...ps!, { id, name: "New Provider", baseUrl: "https://api.example.com/v1", model: "", apiKey: "", enabled: false, vision: false }]);
  }
  function removeProvider(id: string) {
    setProviders((ps) => ps!.filter((p) => p.id !== id));
  }

  async function save() {
    setSaving(true); setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, features }),
    });
    const json = await res.json();
    setSaving(false);
    setMessage(json.ok ? "Saved. The new chain takes effect immediately." : json.error?.message ?? "Save failed.");
  }

  async function test(p: Provider) {
    setTesting((t) => ({ ...t, [p.id]: true }));
    setTestResults((r) => ({ ...r, [p.id]: { ok: false } }));
    try {
      const res = await fetch("/api/admin/settings/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p }),
      });
      const json = await res.json();
      if (json.ok && json.data) setTestResults((r) => ({ ...r, [p.id]: json.data as TestResult }));
      else setTestResults((r) => ({ ...r, [p.id]: { ok: false, error: json.error?.message ?? "Test failed" } }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [p.id]: { ok: false, error: String(err) } }));
    }
    setTesting((t) => ({ ...t, [p.id]: false }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">LLM Provider Chain</h1>
        <p className="text-sm text-muted-foreground">
          Providers are tried in order. When a provider runs out of quota or balance, the next one takes over automatically.
          OCR (scanned documents) only uses providers marked vision-capable.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Failover Order</CardTitle>
            <CardDescription>#1 serves everything until exhausted, then #2, then #3…</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addProvider}><Plus size={14} /> Add provider</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers.map((p, i) => {
            const tr = testResults[p.id];
            return (
              <div key={p.id} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={p.enabled && p.apiKey ? "default" : "secondary"}>#{i + 1}</Badge>
                  <Input className="w-52" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} aria-label="Provider name" />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={p.enabled} onChange={(e) => update(p.id, { enabled: e.target.checked })} />
                    Enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={p.vision} onChange={(e) => update(p.id, { vision: e.target.checked })} />
                    Vision (OCR)
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(p.id, -1)} aria-label="Move up"><ArrowUp size={14} /></Button>
                    <Button size="icon" variant="ghost" disabled={i === providers.length - 1} onClick={() => move(p.id, 1)} aria-label="Move down"><ArrowDown size={14} /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeProvider(p.id)} aria-label="Remove"><Trash2 size={14} /></Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Base URL (OpenAI-compatible)</Label>
                    <Input value={p.baseUrl} onChange={(e) => update(p.id, { baseUrl: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Model ID</Label>
                    <Input value={p.model} onChange={(e) => update(p.id, { model: e.target.value })} placeholder="deepseek-flash" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">API Key</Label>
                    <Input type="password" value={p.apiKey} onChange={(e) => update(p.id, { apiKey: e.target.value })} placeholder="sk-…" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="outline" onClick={() => test(p)} disabled={testing[p.id]}>
                    {testing[p.id] ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />} Test
                  </Button>
                  {tr && tr.latencyMs != null && (
                    <span className="text-xs text-green-600">OK in {tr.latencyMs}ms · replied “{tr.reply}” · model: {tr.returnedModel ?? p.model}</span>
                  )}
                  {tr && tr.error && <span className="text-xs text-destructive">{tr.error.slice(0, 160)}</span>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Features</CardTitle>
          <CardDescription>Toggle the AI-powered pipeline stages.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={features.generateDocs} onChange={(e) => setFeatures({ ...features, generateDocs: e.target.checked })} />
            Generate tender deliverables (BOQ workbook, SOW, specs, checklists…)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={features.pricingAssist} onChange={(e) => setFeatures({ ...features, pricingAssist: e.target.checked })} />
            AI pricing assist (semantic matching + rate estimation for unmatched items)
          </label>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <Label className="text-xs">OCR max pages</Label>
              <Input type="number" min={1} max={200} className="w-28" value={features.ocrMaxPages} onChange={(e) => setFeatures({ ...features, ocrMaxPages: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pricing items per AI batch</Label>
              <Input type="number" min={1} max={100} className="w-28" value={features.pricingBatchSize} onChange={(e) => setFeatures({ ...features, pricingBatchSize: Number(e.target.value) })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
