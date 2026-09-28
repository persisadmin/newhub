"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Modal, Skeleton, Spinner, StatusBadge } from "@/components/ui";
import { formatMYR } from "@/lib/utils";

interface Subscription {
  plan: string; interval: string; status: string;
  currentPeriodStart: string; currentPeriodEnd: string;
}
interface Payment {
  _id: string; plan: string; interval: string; amount: number; status: string; createdAt: string; providerRef: string;
}
interface CreditEntry {
  _id: string; type: "grant" | "deduction" | "refund" | "adjustment"; amount: number; reason: string;
  projectId: string | null; createdAt: string;
  meta: { multiplier?: number; costUsd?: number; provider?: string; model?: string } | null;
}

const PACKAGES = [
  { key: "starter", name: "Starter", price: 29900, credits: 1000, blurb: "1,000 credits — try PERSIS on real tenders" },
  { key: "professional", name: "Professional", price: 49900, credits: 5000, blurb: "5,000 credits — for active tendering teams" },
  { key: "enterprise", name: "Enterprise", price: 99900, credits: 20000, blurb: "20,000 credits — high-volume pipeline" },
] as const;

const ENTRY_LABEL: Record<CreditEntry["type"], string> = {
  grant: "Top-up",
  deduction: "Processing",
  refund: "Refund",
  adjustment: "Adjustment",
};

function fmtCredits(n: number): string {
  return `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString("en-MY", { maximumFractionDigits: 1 })}`;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [creditHistory, setCreditHistory] = useState<CreditEntry[] | null>(null);
  const [paying, setPaying] = useState<{ providerRef: string; qrPayload: string; amountSen: number; plan: string; provider?: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/subscription");
    const json = await res.json();
    if (json.ok) {
      setSubscription(json.data.subscription);
      setSubscriptionActive(json.data.subscriptionActive);
      setPayments(json.data.payments);
      setCreditBalance(json.data.creditBalance);
      setCreditHistory(json.data.creditHistory);
    }
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  // Render the DuitNow QR payload locally (never sent to third-party QR services).
  useEffect(() => {
    if (!paying || paying.qrPayload.startsWith("{")) return; // mock JSON payload — dev placeholder
    let cancelled = false;
    (async () => {
      const QRCode = (await import("qrcode")).default;
      if (!cancelled && qrCanvasRef.current) {
        await QRCode.toCanvas(qrCanvasRef.current, paying.qrPayload, { width: 240, margin: 1, errorCorrectionLevel: "M" });
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [paying]);

  // While the QR is open, poll for activation (phone-notification bridge or webhook).
  useEffect(() => {
    if (!paying) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/payments/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerRef: paying.providerRef }),
      });
      const json = await res.json();
      if (json.ok && json.data.verified) { setPaying(null); load(); }
    }, 5000);
    return () => clearInterval(t);
  }, [paying]);

  async function subscribe(plan: string) {
    setError(null);
    const res = await fetch("/api/payments/initiate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval: "monthly", couponCode: couponApplied ?? undefined }),
    });
    const json = await res.json();
    if (!json.ok) {
      setError(json.error?.message ?? "Could not initiate payment.");
      if (["NOT_FOUND", "INACTIVE", "EXHAUSTED", "NOT_STARTED", "EXPIRED", "NOT_ELIGIBLE"].includes(json.error?.code)) setCouponApplied(null);
      return;
    }
    setPaying(json.data);
  }

  async function verify() {
    if (!paying) return;
    setVerifying(true);
    // With the mock provider this simulates the wallet scan; with a real gateway the
    // user scans the QR and the webhook moves the payment forward — Verify re-checks server-side.
    await fetch("/api/payments/simulate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerRef: paying.providerRef }),
    });
    const res = await fetch("/api/payments/verify", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerRef: paying.providerRef }),
    });
    const json = await res.json();
    setVerifying(false);
    if (json.ok && json.data.verified) {
      setPaying(null);
      load();
    } else {
      setError("Payment not confirmed yet. If you have paid, wait a moment and verify again.");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Profile, credits and billing.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              {(session?.user?.name ?? "U").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{session?.user?.name}</p>
              <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
              <Badge variant="secondary" className="mt-1">{(session?.user as { role?: string } | undefined)?.role ?? "contractor"}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Credit balance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit Balance</CardTitle>
          <CardDescription>1 credit = RM 1. Credits never expire; an active subscription is required to spend them.</CardDescription>
        </CardHeader>
        <CardContent>
          {!loaded ? <Skeleton className="h-16 w-full" /> : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-3xl font-bold tabular-nums">{creditBalance.toLocaleString("en-MY", { maximumFractionDigits: 1 })}<span className="ml-1 text-sm font-normal text-muted-foreground">credits</span></p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {subscriptionActive
                    ? <>Subscription active — {subscription ? <span className="capitalize">{subscription.plan}</span> : ""} until {subscription ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-MY") : ""}</>
                    : "No active subscription — top up below to unlock uploads and scanning."}
                </p>
              </div>
              {subscription && <StatusBadge status={subscriptionActive ? "active" : "expired"} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit packages */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Credit Packages</h2>
          <div className="flex items-center gap-2">
            {couponApplied ? (
              <>
                <Badge variant="success">Coupon {couponApplied} applied</Badge>
                <Button size="sm" variant="ghost" onClick={() => setCouponApplied(null)}>Remove</Button>
              </>
            ) : (
              <>
                <Input
                  className="w-40 uppercase"
                  placeholder="Coupon code"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                />
                <Button size="sm" variant="outline" disabled={couponInput.trim().length < 3}
                  onClick={() => { setCouponApplied(couponInput.trim().toUpperCase()); setError(null); }}>
                  Apply
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PACKAGES.map((p) => {
            const current = subscriptionActive && subscription?.plan === p.key;
            return (
              <Card key={p.key} className={current ? "border-primary" : undefined}>
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>{p.blurb}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{formatMYR(p.price)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{p.credits.toLocaleString()} credits · 30-day access</p>
                  <Button className="mt-4 w-full" variant={current ? "outline" : "default"} onClick={() => subscribe(p.key)}>
                    {subscriptionActive ? "Top up" : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>

      {/* Credit history */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Credit history</h2>
        {!loaded ? <Skeleton className="h-24 w-full" /> : creditHistory && creditHistory.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium text-right">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {creditHistory.map((c) => (
                  <tr key={c._id}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-MY")}</td>
                    <td className="px-4 py-3"><Badge variant={c.type === "deduction" ? "secondary" : "default"}>{ENTRY_LABEL[c.type]}</Badge></td>
                    <td className="px-4 py-3">
                      <p>{c.reason}</p>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${c.amount < 0 ? "text-destructive" : "text-success"}`}>{fmtCredits(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No credit transactions yet" description="Top-ups and processing deductions will appear here." />
        )}
      </div>

      {/* Payment history */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Payment history</h2>
        {!loaded ? <Skeleton className="h-24 w-full" /> : payments && payments.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Package</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {payments.map((p) => (
                  <tr key={p._id}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(p.createdAt).toLocaleString("en-MY")}</td>
                    <td className="px-4 py-3 capitalize">{p.plan}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.providerRef}</td>
                    <td className="px-4 py-3 text-right">{formatMYR(p.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payments yet" description="Your payment history will appear here after your first purchase." />
        )}
      </div>

      {/* TnG QR payment modal */}
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Pay with Touch 'n Go eWallet">
        {paying && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-center">
              {paying.qrPayload.startsWith("{") ? (
                /* Mock provider (dev) — no real QR available */
                <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-md border-2 border-dashed border-border bg-card p-3">
                  <p className="break-all font-mono text-[9px] text-muted-foreground">{paying.qrPayload}</p>
                </div>
              ) : (
                <canvas ref={qrCanvasRef} className="mx-auto rounded-md bg-white p-2" />
              )}
              <p className="mt-3 text-lg font-bold tabular-nums">
                RM {Math.floor(paying.amountSen / 100)}.{(paying.amountSen % 100).toString().padStart(2, "0")}
                <span className="ml-2 text-sm font-normal text-muted-foreground capitalize">— {paying.plan} package</span>
              </p>
              {!paying.qrPayload.startsWith("{") && (
                <p className="text-xs text-muted-foreground">
                  Scan with Touch &rsquo;n Go eWallet or any banking app — the <strong>exact</strong> amount and your payment reference are already in the QR, so just confirm and pay.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Credits and subscription activate automatically once your payment is received. This page checks every few seconds.
            </p>
            {paying.provider === "tng_mock" && (
              <Button className="w-full" onClick={verify} disabled={verifying}>
                {verifying && <Spinner />} Simulate payment (dev) &amp; verify
              </Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
