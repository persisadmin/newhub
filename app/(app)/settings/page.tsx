"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Modal, Skeleton, Spinner, StatusBadge } from "@/components/ui";
import { formatMYR } from "@/lib/utils";
import { PACKAGE_LIST, type PackageKey } from "@/lib/packages";

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

/** Marketing blurbs per package — prices and credits come from lib/packages.ts. */
const PACKAGE_BLURB: Record<PackageKey, string> = {
  starter: "try PERSIS on real tenders",
  professional: "for active tendering teams",
  enterprise: "high-volume tender pipeline",
};

const PACKAGES = PACKAGE_LIST.map((p) => ({
  ...p,
  blurb: `${p.credits.toLocaleString()} credits — ${PACKAGE_BLURB[p.key]}`,
}));

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
  const [paying, setPaying] = useState<{ providerRef: string; qrPayload?: string; amountSen: number; plan: string; provider?: string; method?: string } | null>(null);
  const [payMethods, setPayMethods] = useState<{ duitnow_qr: boolean; payhalal: boolean }>({ duitnow_qr: false, payhalal: false });
  /** Plan the customer picked, while they choose how to pay. */
  const [payMethodFor, setPayMethodFor] = useState<string | null>(null);
  const [payStarting, setPayStarting] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
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
      if (json.data.paymentMethods) setPayMethods(json.data.paymentMethods);
    }
    setLoaded(true);
  }
  useEffect(() => {
    load();

    // Returning from PayHalal's hosted page. Verification is server-side (we ask
    // PayHalal for the authoritative status) and the signed callback normally
    // activates the payment within seconds, so poll briefly rather than assume.
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "payhalal") return;
    const order = params.get("order");
    setReturnNotice("Confirming your PayHalal payment…");
    // Drop the query string so a refresh doesn't re-run this.
    window.history.replaceState({}, "", window.location.pathname);

    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      let verified = false;
      if (order) {
        const res = await fetch("/api/payments/verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerRef: order }),
        });
        const json = await res.json();
        verified = Boolean(json.ok && json.data?.verified);
      }
      if (verified) {
        clearInterval(timer);
        setReturnNotice("Payment received — your credits and subscription are active.");
        load();
      } else if (attempts >= 12) {
        clearInterval(timer);
        setReturnNotice("PayHalal is still confirming your payment. Your credits will appear automatically once it completes.");
        load();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Render the DuitNow QR payload locally (never sent to third-party QR services).
  useEffect(() => {
    const payload = paying?.qrPayload;
    if (!payload || payload.startsWith("{")) return; // mock JSON payload — dev placeholder
    let cancelled = false;
    (async () => {
      const QRCode = (await import("qrcode")).default;
      if (!cancelled && qrCanvasRef.current) {
        await QRCode.toCanvas(qrCanvasRef.current, payload, { width: 240, margin: 1, errorCorrectionLevel: "M" });
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

  /** Customer picked a plan: ask how they want to pay (unless only one way works). */
  function choosePayment(plan: string) {
    setError(null);
    setPayError(null);
    const available = (["payhalal", "duitnow_qr"] as const).filter((m) => payMethods[m]);
    // None reported (e.g. still loading): the QR flow always has a provider, so use it.
    if (available.length === 0) { startPayment(plan, "duitnow_qr"); return; }
    if (available.length === 1) { startPayment(plan, available[0]); return; }
    setPayMethodFor(plan);
  }

  async function startPayment(plan: string, method: "duitnow_qr" | "payhalal") {
    setError(null);
    setPayError(null);
    setPayStarting(method);
    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval: "monthly", couponCode: couponApplied ?? undefined, method }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        // Keep the chooser open so the failure is visible, not a silent dead click.
        const msg = json?.error?.message ?? "Could not initiate payment. Please try again.";
        setPayError(msg);
        if (["NOT_FOUND", "INACTIVE", "EXHAUSTED", "NOT_STARTED", "EXPIRED", "NOT_ELIGIBLE"].includes(json?.error?.code)) setCouponApplied(null);
        return;
      }
      setPayMethodFor(null);
      // PayHalal hosts the payment page, so hand the browser over to it.
      if (json.data.redirectUrl) { window.location.href = json.data.redirectUrl; return; }
      setPaying(json.data);
    } catch {
      setPayError("Network error — please check your connection and try again.");
    } finally {
      setPayStarting(null);
    }
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
                  <Button className="mt-4 w-full" variant={current ? "outline" : "default"} onClick={() => choosePayment(p.key)}>
                    {subscriptionActive ? "Top up" : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {returnNotice && <p className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{returnNotice}</p>}
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

      {/* DuitNow QR payment modal */}
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Scan to pay">
        {paying && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-center">
              {(paying.qrPayload ?? "").startsWith("{") ? (
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
              {!(paying.qrPayload ?? "").startsWith("{") && (
                <p className="text-xs text-muted-foreground">
                  Scan with Touch &rsquo;n Go eWallet or any banking app — the <strong>exact</strong> amount and your payment reference are already in the QR, so just confirm and pay.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Credits and subscription activate automatically once your payment is received. This page checks every few seconds.
            </p>
            {paying.provider === "tng_mock" && (
              <div className="space-y-3">
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Test mode — this server has no real DuitNow merchant QR configured, so the code above can&apos;t be
                  scanned. Use the button below to simulate a successful payment (no real charge).
                </p>
                <Button className="w-full" onClick={verify} disabled={verifying}>
                  {verifying && <Spinner />} Simulate test payment &amp; verify
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Payment method chooser */}
      <Modal open={!!payMethodFor} onClose={() => setPayMethodFor(null)} title="How would you like to pay?">
        {payMethodFor && (() => {
          const pkg = PACKAGES.find((p) => p.key === payMethodFor);
          return (
            <div className="space-y-4">
              {pkg && (
                <p className="text-sm text-muted-foreground">
                  {pkg.name} package · <span className="font-medium text-foreground">{formatMYR(pkg.price)}</span>
                  {couponApplied && <span className="ml-1">· coupon {couponApplied} applied</span>}
                </p>
              )}

              {payError && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{payError}</p>
              )}

              {payMethods.payhalal && (
                <button
                  onClick={() => startPayment(payMethodFor, "payhalal")}
                  disabled={!!payStarting}
                  className="w-full cursor-pointer rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="flex items-center gap-2 font-medium">
                    {payStarting === "payhalal" && <Spinner />}
                    Online banking, card or e-wallet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    FPX, debit/credit card and e-wallets via PayHalal&apos;s secure payment page. You&apos;ll be
                    redirected to complete the payment, then returned here.
                  </p>
                </button>
              )}

              {payMethods.duitnow_qr && (
                <button
                  onClick={() => startPayment(payMethodFor, "duitnow_qr")}
                  disabled={!!payStarting}
                  className="w-full cursor-pointer rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="flex items-center gap-2 font-medium">
                    {payStarting === "duitnow_qr" && <Spinner />}
                    DuitNow QR
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Scan a QR with Touch &rsquo;n Go eWallet or any participating banking app. Stay on this page —
                    credits activate automatically once the payment is received.
                  </p>
                </button>
              )}

              {!payMethods.payhalal && !payMethods.duitnow_qr && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  No payment method is configured yet. Please contact support.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
