"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Modal, Skeleton, Spinner, StatusBadge } from "@/components/ui";
import { formatMYR } from "@/lib/utils";

interface Subscription {
  plan: string; interval: string; status: string;
  currentPeriodStart: string; currentPeriodEnd: string;
}
interface Payment {
  _id: string; plan: string; interval: string; amount: number; status: string; createdAt: string; providerRef: string;
}

const PLANS = [
  { key: "starter", name: "Starter", monthly: 9900, yearly: 99000, blurb: "10 tender projects / month" },
  { key: "professional", name: "Professional", monthly: 24900, yearly: 249000, blurb: "Unlimited projects + hybrid pricing" },
  { key: "enterprise", name: "Enterprise", monthly: 59900, yearly: 599000, blurb: "Multi-user + custom integrations" },
] as const;

export default function SettingsPage() {
  const { data: session } = useSession();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  const [paying, setPaying] = useState<{ providerRef: string; qrPayload: string; amountSen: number; plan: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const res = await fetch("/api/subscription");
    const json = await res.json();
    if (json.ok) { setSubscription(json.data.subscription); setPayments(json.data.payments); }
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function subscribe(plan: string) {
    setError(null);
    const res = await fetch("/api/payments/initiate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, interval }),
    });
    const json = await res.json();
    if (!json.ok) { setError(json.error?.message ?? "Could not initiate payment."); return; }
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
        <p className="text-sm text-muted-foreground">Profile, subscription and billing.</p>
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

      {/* Current subscription */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>Your current plan and billing period.</CardDescription>
        </CardHeader>
        <CardContent>
          {!loaded ? <Skeleton className="h-16 w-full" /> : subscription ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold capitalize">{subscription.plan}</p>
                  <StatusBadge status={subscription.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground capitalize">
                  {subscription.interval} · {new Date(subscription.currentPeriodStart).toLocaleDateString("en-MY")} → {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-MY")}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active subscription. Choose a plan below to unlock PERSIS.</p>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="flex rounded-md border border-border p-0.5">
            {(["monthly", "yearly"] as const).map((i) => (
              <button key={i} onClick={() => setInterval_(i)} className={`rounded px-3 py-1 text-xs font-medium capitalize cursor-pointer ${interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                {i}{i === "yearly" && " (−17%)"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => {
            const current = subscription?.status === "active" && subscription.plan === p.key && subscription.interval === interval;
            return (
              <Card key={p.key} className={current ? "border-primary" : undefined}>
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>{p.blurb}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{formatMYR(p[interval])}<span className="text-sm font-normal text-muted-foreground">/{interval === "monthly" ? "mo" : "yr"}</span></p>
                  <Button className="mt-4 w-full" variant={current ? "outline" : "default"} disabled={current} onClick={() => subscribe(p.key)}>
                    {current ? "Current plan" : subscription?.status === "active" ? "Switch to this plan" : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
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
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {payments.map((p) => (
                  <tr key={p._id}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(p.createdAt).toLocaleString("en-MY")}</td>
                    <td className="px-4 py-3 capitalize">{p.plan} ({p.interval})</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.providerRef}</td>
                    <td className="px-4 py-3 text-right">{formatMYR(p.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payments yet" description="Your payment history will appear here after your first subscription." />
        )}
      </div>

      {/* TnG QR payment modal */}
      <Modal open={!!paying} onClose={() => setPaying(null)} title="Pay with Touch 'n Go eWallet">
        {paying && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-center">
              {/* QR placeholder: in production this renders a real TNG QR code image from the gateway */}
              <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-md border-2 border-dashed border-border bg-card p-3">
                <p className="break-all font-mono text-[9px] text-muted-foreground">{paying.qrPayload}</p>
              </div>
              <p className="mt-3 text-sm font-medium">{formatMYR(paying.amountSen)} — {paying.plan} plan</p>
              <p className="text-xs text-muted-foreground">Scan with Touch &rsquo;n Go eWallet</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Your subscription activates only after server-side payment verification — a success screen alone is never trusted.
            </p>
            <Button className="w-full" onClick={verify} disabled={verifying}>
              {verifying && <Spinner />} I have paid — verify payment
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
