"use client";
import { useEffect, useRef, useState } from "react";
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

interface ProviderPrice { providerId: string; inputUsdPerM: number; outputUsdPerM: number }
interface Billing { creditMultiplier: number; usdToMyr: number; prices: ProviderPrice[] }

interface PendingPayment { providerRef: string; amount: number; plan: string; status: string; createdAt: string; userEmail: string }
interface NotifyLog { _id: string; text: string; amountsSen: number[]; matched: boolean; createdAt: string }
interface Coupon {
  _id: string; code: string; discountPct: number | null; priceSen: number | null;
  startsAt: string | null; endsAt: string | null; audience: string; userEmail: string | null;
  maxUses: number | null; usedCount: number; active: boolean; note: string | null; createdAt: string;
}
interface Promo { enabled: boolean; startsAt: string; endsAt: string; trialDays: number; credits: number }
interface TrialNudge { enabled: boolean; discountPct: number; couponHours: number }
interface DuitNowPreview { configured: boolean; previewPayload: string | null; fields: [string, string][] }

export default function AdminLlmSettingsPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [features, setFeatures] = useState<Features | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[] | null>(null);
  const [notifyLog, setNotifyLog] = useState<NotifyLog[] | null>(null);
  const [confirmingRef, setConfirmingRef] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [couponForm, setCouponForm] = useState({
    code: "", discountPct: "10",
    startsAt: toLocalInput(new Date()), endsAt: toLocalInput(new Date(Date.now() + 14 * 864e5)),
    audience: "all", userEmail: "", maxUses: "",
  });
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [maintenance, setMaintenance] = useState<boolean | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [promo, setPromo] = useState<Promo | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [trialNudge, setTrialNudge] = useState<TrialNudge | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState<string | null>(null);
  const [duitnow, setDuitnow] = useState<DuitNowPreview | null>(null);
  const duitnowCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function toLocalInput(d: string | Date): string {
    const dt = new Date(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  async function savePromoSettings() {
    if (!promo) return;
    setPromoBusy(true); setPromoMsg(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, features, billing, promo }),
    });
    const json = await res.json();
    setPromoBusy(false);
    setPromoMsg(json.ok ? "Promotion saved. New sign-ups in the window get the trial automatically." : json.error?.message ?? "Save failed.");
  }

  async function saveTrialNudge() {
    if (!trialNudge) return;
    setNudgeBusy(true); setNudgeMsg(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, features, billing, trialNudge }),
    });
    const json = await res.json();
    setNudgeBusy(false);
    setNudgeMsg(json.ok ? "Trial nudge saved. The hourly sweep uses the new values from its next run." : json.error?.message ?? "Save failed.");
  }

  async function toggleMaintenance() {
    if (maintenance === null) return;
    setMaintenanceBusy(true);
    const res = await fetch("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, features, billing, maintenance: !maintenance }),
    });
    const json = await res.json();
    setMaintenanceBusy(false);
    if (json.ok) setMaintenance(!maintenance);
  }

  async function loadCoupons() {
    const res = await fetch("/api/admin/coupons");
    const json = await res.json();
    if (json.ok) setCoupons(json.data.coupons);
  }

  async function createCoupon() {
    setCouponBusy(true); setCouponMsg(null);
    const res = await fetch("/api/admin/coupons", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: couponForm.code,
        discountPct: Number(couponForm.discountPct),
        startsAt: new Date(couponForm.startsAt).toISOString(),
        endsAt: new Date(couponForm.endsAt).toISOString(),
        audience: couponForm.audience,
        userEmail: couponForm.audience === "user" ? couponForm.userEmail.trim() : undefined,
        maxUses: couponForm.maxUses ? Number(couponForm.maxUses) : null,
      }),
    });
    const json = await res.json();
    setCouponBusy(false);
    if (json.ok) {
      setCouponForm({ ...couponForm, code: "", userEmail: "", maxUses: "" });
      setCouponMsg(`Coupon ${json.data.coupon.code} created (−${json.data.coupon.discountPct}%).`);
      loadCoupons();
    }
    else setCouponMsg(json.error?.message ?? "Could not create coupon.");
  }

  async function toggleCoupon(id: string, active: boolean) {
    await fetch("/api/admin/coupons", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active }),
    });
    loadCoupons();
  }

  async function loadPayments() {
    const res = await fetch("/api/admin/payments");
    const json = await res.json();
    if (json.ok) { setPendingPayments(json.data.pending); setNotifyLog(json.data.notifications); }
  }

  async function confirmPayment(providerRef: string) {
    setConfirmingRef(providerRef);
    await fetch("/api/admin/payments", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerRef }),
    });
    setConfirmingRef(null);
    loadPayments();
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/settings");
      if (res.status === 403) { setForbidden(true); return; }
      const json = await res.json();
      if (json.ok) {
        setProviders(json.data.settings.providers); setFeatures(json.data.settings.features); setBilling(json.data.billing); setMaintenance(json.data.maintenance);
        if (json.data.duitnow) setDuitnow(json.data.duitnow);
        const p = json.data.promo;
        setPromo(p
          ? { enabled: p.enabled, startsAt: toLocalInput(p.startsAt), endsAt: toLocalInput(p.endsAt), trialDays: p.trialDays, credits: p.credits }
          : { enabled: false, startsAt: toLocalInput(new Date()), endsAt: toLocalInput(new Date(Date.now() + 14 * 864e5)), trialDays: 14, credits: 100 });
        const tn = json.data.trialNudge;
        setTrialNudge(tn ?? { enabled: true, discountPct: 15, couponHours: 24 });
      }
      loadPayments();
      loadCoupons();
    })();
  }, []);

  // Render the DuitNow self-test QR locally (payload never leaves the server
  // except to this admin's browser — no third-party QR services).
  useEffect(() => {
    if (!duitnow?.previewPayload || !duitnowCanvasRef.current) return;
    const payload = duitnow.previewPayload;
    (async () => {
      const QRCode = (await import("qrcode")).default;
      await QRCode.toCanvas(duitnowCanvasRef.current, payload, { width: 200, margin: 1, errorCorrectionLevel: "M" });
    })().catch(() => {});
  }, [duitnow]);

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
      body: JSON.stringify({ providers, features, billing }),
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

      <Card className={maintenance ? "border-warning" : undefined}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Maintenance Mode</CardTitle>
            <CardDescription>
              {maintenance
                ? "ACTIVE — sign-in and registration are disabled for everyone except admins."
                : "When enabled, only admins can sign in or register. Existing sessions are unaffected."}
            </CardDescription>
          </div>
          <Button
            variant={maintenance ? "default" : "outline"}
            onClick={toggleMaintenance}
            disabled={maintenance === null || maintenanceBusy}
          >
            {maintenanceBusy ? <Loader2 size={14} className="animate-spin" /> : null}
            {maintenance ? "Disable maintenance" : "Enable maintenance"}
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DuitNow QR Self-Test</CardTitle>
          <CardDescription>
            Scan this RM1.00 test QR with Touch &rsquo;n Go eWallet or any banking app BEFORE customers do. It must show your
            merchant name, <strong>RM1.00</strong> and reference <strong>TESTREF123</strong>. If the app says the QR is not
            recognised, your <code className="text-xs">DUITNOW_STATIC_QR</code> value is wrong or the wallet rejects dynamic
            conversion — fix that first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!duitnow ? (
            <Skeleton className="h-24 w-full" />
          ) : !duitnow.configured ? (
            <p className="text-sm text-warning">
              DuitNow is not configured — set DUITNOW_STATIC_QR (paste the decoded payload of your merchant QR) in the server
              environment and redeploy. Until then, checkouts show the mock provider.
            </p>
          ) : (
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <canvas ref={duitnowCanvasRef} className="rounded-md bg-white p-2" />
              <div className="min-w-0 flex-1 space-y-2 text-xs">
                <p className="font-medium">Parsed payload fields (tag → value):</p>
                <div className="grid max-h-40 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-y-auto font-mono">
                  {duitnow.fields.map(([tag, value]) => (
                    <div key={tag} className="contents">
                      <span className="text-muted-foreground">{tag}</span>
                      <span className="break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

      {billing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit Billing</CardTitle>
            <CardDescription>
              Processing charge = raw AI token cost × USD→MYR × credit multiplier (the “magic number”). 1 credit = RM 1.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1">
                <Label className="text-xs">Credit multiplier (magic number)</Label>
                <Input type="number" min={0.1} step={0.1} className="w-28" value={billing.creditMultiplier}
                  onChange={(e) => setBilling({ ...billing, creditMultiplier: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">USD → MYR rate</Label>
                <Input type="number" min={0.1} step={0.01} className="w-28" value={billing.usdToMyr}
                  onChange={(e) => setBilling({ ...billing, usdToMyr: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Token prices (USD per 1M tokens) — matched by provider id; “default” is the fallback</Label>
              <div className="space-y-2">
                {billing.prices.map((pr, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="w-40" value={pr.providerId} placeholder="provider id"
                      onChange={(e) => setBilling({ ...billing, prices: billing.prices.map((x, j) => j === i ? { ...x, providerId: e.target.value } : x) })} />
                    <Input type="number" min={0} step={0.01} className="w-28" value={pr.inputUsdPerM} aria-label="Input price"
                      onChange={(e) => setBilling({ ...billing, prices: billing.prices.map((x, j) => j === i ? { ...x, inputUsdPerM: Number(e.target.value) } : x) })} />
                    <span className="text-xs text-muted-foreground">in</span>
                    <Input type="number" min={0} step={0.01} className="w-28" value={pr.outputUsdPerM} aria-label="Output price"
                      onChange={(e) => setBilling({ ...billing, prices: billing.prices.map((x, j) => j === i ? { ...x, outputUsdPerM: Number(e.target.value) } : x) })} />
                    <span className="text-xs text-muted-foreground">out</span>
                    <Button size="icon" variant="ghost" aria-label="Remove price row"
                      onClick={() => setBilling({ ...billing, prices: billing.prices.filter((_, j) => j !== i) })}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline"
                  onClick={() => setBilling({ ...billing, prices: [...billing.prices, { providerId: "default", inputUsdPerM: 0.5, outputUsdPerM: 2.5 }] })}>
                  <Plus size={14} /> Add price row
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {promo && (
        <Card className={promo.enabled ? "border-success" : undefined}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Launch Promotion</CardTitle>
              <CardDescription>New sign-ups inside the window get free access + free credits automatically — no payment needed.</CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={promo.enabled} onChange={(e) => setPromo({ ...promo, enabled: e.target.checked })} />
              Enabled
            </label>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1">
                <Label className="text-xs">Starts</Label>
                <Input type="datetime-local" value={promo.startsAt} onChange={(e) => setPromo({ ...promo, startsAt: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ends</Label>
                <Input type="datetime-local" value={promo.endsAt} onChange={(e) => setPromo({ ...promo, endsAt: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Free access (days)</Label>
                <Input type="number" min={1} max={365} className="w-28" value={promo.trialDays} onChange={(e) => setPromo({ ...promo, trialDays: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Free credits</Label>
                <Input type="number" min={0} className="w-28" value={promo.credits} onChange={(e) => setPromo({ ...promo, credits: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button size="sm" onClick={savePromoSettings} disabled={promoBusy}>
                {promoBusy ? <Loader2 size={12} className="animate-spin" /> : null} Save promotion
              </Button>
              {promoMsg && <span className="text-sm text-muted-foreground">{promoMsg}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              Applies to accounts created after saving, within the window only. Existing users are unaffected. A banner appears on the landing page while the promo is live.
            </p>
          </CardContent>
        </Card>
      )}

      {trialNudge && (
        <Card className={trialNudge.enabled ? "border-success" : undefined}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Trial-Expiry Nudge</CardTitle>
              <CardDescription>24h before a free trial ends, email the user a one-time discount coupon for any paid package.</CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={trialNudge.enabled} onChange={(e) => setTrialNudge({ ...trialNudge, enabled: e.target.checked })} />
              Enabled
            </label>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <div className="space-y-1">
                <Label className="text-xs">Discount (%)</Label>
                <Input type="number" min={1} max={99} className="w-28" value={trialNudge.discountPct} onChange={(e) => setTrialNudge({ ...trialNudge, discountPct: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Coupon valid (hours)</Label>
                <Input type="number" min={1} max={720} className="w-28" value={trialNudge.couponHours} onChange={(e) => setTrialNudge({ ...trialNudge, couponHours: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button size="sm" onClick={saveTrialNudge} disabled={nudgeBusy}>
                {nudgeBusy ? <Loader2 size={12} className="animate-spin" /> : null} Save nudge
              </Button>
              {nudgeMsg && <span className="text-sm text-muted-foreground">{nudgeMsg}</span>}
            </div>
            <p className="text-xs text-muted-foreground">
              An hourly sweep finds trials expiring within 24 hours and emails each user once. The generated coupon
              (single-use, tied to that user&apos;s email) appears in the Coupons list below and is deleted automatically when it expires.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coupons</CardTitle>
          <CardDescription>
            Exclusive percentage discounts (1–99% off the package price) with a start/end window and an audience —
            everyone, one package tier, or a specific user email. A name can&rsquo;t be used by two coupons active at the same time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input className="w-40 uppercase" placeholder="MERDEKA30" value={couponForm.code}
                onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Discount %</Label>
              <Input className="w-24" type="number" min="1" max="99" value={couponForm.discountPct}
                onChange={(e) => setCouponForm({ ...couponForm, discountPct: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Starts</Label>
              <Input type="datetime-local" value={couponForm.startsAt}
                onChange={(e) => setCouponForm({ ...couponForm, startsAt: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ends</Label>
              <Input type="datetime-local" value={couponForm.endsAt}
                onChange={(e) => setCouponForm({ ...couponForm, endsAt: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Who can use it</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={couponForm.audience}
                onChange={(e) => setCouponForm({ ...couponForm, audience: e.target.value })}
              >
                <option value="all">Everyone</option>
                <option value="starter">Starter package</option>
                <option value="professional">Professional package</option>
                <option value="enterprise">Enterprise package</option>
                <option value="user">Specific user email</option>
              </select>
            </div>
            {couponForm.audience === "user" && (
              <div className="space-y-1">
                <Label className="text-xs">User email</Label>
                <Input className="w-56" type="email" placeholder="customer@example.com" value={couponForm.userEmail}
                  onChange={(e) => setCouponForm({ ...couponForm, userEmail: e.target.value })} />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Max uses (blank = unlimited)</Label>
              <Input className="w-40" type="number" min="1" placeholder="unlimited" value={couponForm.maxUses}
                onChange={(e) => setCouponForm({ ...couponForm, maxUses: e.target.value })} />
            </div>
            <Button size="sm" onClick={createCoupon}
              disabled={couponBusy || couponForm.code.trim().length < 3 || (couponForm.audience === "user" && !couponForm.userEmail.trim())}>
              {couponBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />} Create coupon
            </Button>
          </div>
          {couponMsg && <p className="text-sm text-muted-foreground">{couponMsg}</p>}

          {coupons === null ? (
            <Skeleton className="h-12 w-full" />
          ) : coupons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coupons yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {coupons.map((c) => (
                <li key={c._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-mono font-medium">{c.code} <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "active" : "inactive"}</Badge></p>
                    <p className="text-xs text-muted-foreground">
                      {c.discountPct != null ? `−${c.discountPct}% off` : `RM ${((c.priceSen ?? 0) / 100).toFixed(2)} (legacy)`}
                      {" · "}{c.audience === "user" ? `only ${c.userEmail}` : c.audience === "all" ? "everyone" : `${c.audience} package`}
                      {c.startsAt && c.endsAt && <> · {new Date(c.startsAt).toLocaleString("en-MY")} → {new Date(c.endsAt).toLocaleString("en-MY")}</>}
                      {" · "}used {c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : " (unlimited)"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toggleCoupon(c._id, !c.active)}>
                    {c.active ? "Deactivate" : "Activate"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Pending Payments</CardTitle>
            <CardDescription>QRs presented but not yet matched. Confirm manually after checking your TNG merchant app.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadPayments}>Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingPayments === null ? (
            <Skeleton className="h-12 w-full" />
          ) : pendingPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending payments.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {pendingPayments.map((p) => (
                <li key={p.providerRef} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{p.userEmail} — <span className="capitalize">{p.plan}</span></p>
                    <p className="text-xs text-muted-foreground">
                      RM {(p.amount / 100).toFixed(2)} · {p.providerRef} · {new Date(p.createdAt).toLocaleString("en-MY")} · {p.status}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={confirmingRef === p.providerRef} onClick={() => confirmPayment(p.providerRef)}>
                    {confirmingRef === p.providerRef ? <Loader2 size={12} className="animate-spin" /> : null}
                    Mark paid &amp; activate
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {notifyLog && notifyLog.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Recent phone notifications (bridge log)</p>
              <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                {notifyLog.map((n) => (
                  <li key={n._id} className="px-3 py-2">
                    <span className={n.matched ? "text-success font-medium" : "text-muted-foreground"}>{n.matched ? "MATCHED" : "unmatched"}</span>
                    <span className="mx-2 text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-MY")}</span>
                    {n.amountsSen.length > 0 && <span className="mr-2 font-mono">{n.amountsSen.map((a) => `RM${(a / 100).toFixed(2)}`).join(", ")}</span>}
                    <span className="text-muted-foreground break-all">{n.text.slice(0, 140)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
