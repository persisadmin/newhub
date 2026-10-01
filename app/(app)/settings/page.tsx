"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Label, Skeleton, Spinner, StatusBadge } from "@/components/ui";
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
  /** Online banking (Chip FPX) is the only payment method offered. */
  const [payMethods, setPayMethods] = useState<{ chip_fpx: boolean }>({ chip_fpx: false });
  /** Which checkout is being started (for the spinner). */
  const [payStarting, setPayStarting] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<string | null>(null);
  // Editable profile + change password
  const [profile, setProfile] = useState<{ name: string; companyName: string; phone: string; address: { line1: string; line2: string; city: string; state: string; postcode: string } }>({
    name: "", companyName: "", phone: "", address: { line1: "", line2: "", city: "", state: "", postcode: "" },
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

    // Returning from the hosted checkout (Chip or legacy PayHalal). Verification
    // is server-side (we ask the gateway for the authoritative status) and the
    // signed callback normally activates the payment within seconds, so poll
    // briefly rather than assume.
    const params = new URLSearchParams(window.location.search);
    const gateway = params.get("payment");
    if (gateway !== "payhalal" && gateway !== "chip") return;
    const order = params.get("order");
    const label = gateway === "chip" ? "Chip" : "PayHalal";
    // Failure/cancel return: the gateway already told us the outcome — don't poll.
    if (params.get("result") === "failure") {
      setReturnNotice("The payment was not completed — no charge was made. You can try again below whenever you're ready.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    setReturnNotice(`Confirming your ${label} payment…`);
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
        setReturnNotice(`${label} is still confirming your payment. Your credits will appear automatically once it completes.`);
        load();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Load the editable profile (name, company, phone, address) once.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/user/profile");
        const json = await res.json();
        if (json.ok) {
          const d = json.data;
          setProfile({
            name: d.name ?? "",
            companyName: d.companyName ?? "",
            phone: d.phone ?? "",
            address: {
              line1: d.address?.line1 ?? "",
              line2: d.address?.line2 ?? "",
              city: d.address?.city ?? "",
              state: d.address?.state ?? "",
              postcode: d.address?.postcode ?? "",
            },
          });
          setHasPassword(Boolean(d.hasPassword));
        }
      } finally {
        setProfileLoaded(true);
      }
    })();
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          companyName: profile.companyName,
          phone: profile.phone,
          address: profile.address,
        }),
      });
      const json = await res.json();
      setProfileMsg(json.ok
        ? { ok: true, text: "Profile saved." }
        : { ok: false, text: json.error?.message ?? "Could not save your profile." });
    } catch {
      setProfileMsg({ ok: false, text: "Network error — please try again." });
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const json = await res.json();
      if (json.ok) {
        setPwMsg({ ok: true, text: "Password changed." });
        setPwForm({ current: "", next: "", confirm: "" });
      } else {
        setPwMsg({ ok: false, text: json.error?.message ?? "Could not change your password." });
      }
    } catch {
      setPwMsg({ ok: false, text: "Network error — please try again." });
    } finally {
      setPwSaving(false);
    }
  }

  /** Customer picked a plan: start the online-banking checkout. */
  function choosePayment(plan: string) {
    setError(null);
    setPayError(null);
    if (loaded && !payMethods.chip_fpx) {
      setError("Online payment is temporarily unavailable. Please try again shortly or contact support.");
      return;
    }
    startPayment(plan);
  }

  async function startPayment(plan: string) {
    setError(null);
    setPayError(null);
    setPayStarting(plan);
    try {
      const res = await fetch("/api/payments/initiate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval: "monthly", couponCode: couponApplied ?? undefined, method: "chip_fpx" }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setPayError(json?.error?.message ?? "Could not start the payment. Please try again.");
        if (["NOT_FOUND", "INACTIVE", "EXHAUSTED", "NOT_STARTED", "EXPIRED", "NOT_ELIGIBLE"].includes(json?.error?.code)) setCouponApplied(null);
        return;
      }
      // Chip's checkout_url is a plain GET page — hand the browser over to it.
      if (json.data?.redirectUrl) { window.location.href = json.data.redirectUrl; return; }
      setPayError("The payment page could not be opened. Please try again.");
    } catch {
      setPayError("Network error — please check your connection and try again.");
    } finally {
      setPayStarting(null);
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
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              {(profile.name || session?.user?.name || "U").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <CardTitle className="text-base">Profile &amp; company</CardTitle>
              <CardDescription>
                {session?.user?.email} · {(session?.user as { role?: string } | undefined)?.role ?? "contractor"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!profileLoaded ? <Skeleton className="h-40 w-full" /> : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" id="pf-name">
                  <Input id="pf-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Your name" />
                </Field>
                <Field label="Company name" id="pf-company">
                  <Input id="pf-company" value={profile.companyName} onChange={(e) => setProfile({ ...profile, companyName: e.target.value })} placeholder="Optional" />
                </Field>
                <Field label="Phone number" id="pf-phone">
                  <Input id="pf-phone" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="Optional" />
                </Field>
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-3 text-sm font-medium">Address <span className="font-normal text-muted-foreground">(optional)</span></p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Address line 1" id="pf-line1" className="sm:col-span-2">
                    <Input id="pf-line1" value={profile.address.line1} onChange={(e) => setProfile({ ...profile, address: { ...profile.address, line1: e.target.value } })} />
                  </Field>
                  <Field label="Address line 2" id="pf-line2" className="sm:col-span-2">
                    <Input id="pf-line2" value={profile.address.line2} onChange={(e) => setProfile({ ...profile, address: { ...profile.address, line2: e.target.value } })} />
                  </Field>
                  <Field label="City" id="pf-city">
                    <Input id="pf-city" value={profile.address.city} onChange={(e) => setProfile({ ...profile, address: { ...profile.address, city: e.target.value } })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="State" id="pf-state">
                      <Input id="pf-state" value={profile.address.state} onChange={(e) => setProfile({ ...profile, address: { ...profile.address, state: e.target.value } })} />
                    </Field>
                    <Field label="Postcode" id="pf-postcode">
                      <Input id="pf-postcode" value={profile.address.postcode} onChange={(e) => setProfile({ ...profile, address: { ...profile.address, postcode: e.target.value } })} />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={saveProfile} disabled={profileSaving || profile.name.trim().length < 2}>
                  {profileSaving && <Spinner />} Save profile
                </Button>
                {profileMsg && (
                  <p className={`text-sm ${profileMsg.ok ? "text-success" : "text-destructive"}`}>{profileMsg.text}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Email can&apos;t be changed — it&apos;s your sign-in identity. Name must be at least 2 characters; everything else is optional.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>
            {hasPassword
              ? "Enter your current password to set a new one."
              : "This account signs in with Google, so there is no password to change."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasPassword ? (
            <div className="max-w-sm space-y-4">
              <Field label="Current password" id="pw-current">
                <Input id="pw-current" type="password" autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} />
              </Field>
              <Field label="New password" id="pw-next">
                <Input id="pw-next" type="password" autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} />
              </Field>
              <Field label="Confirm new password" id="pw-confirm">
                <Input id="pw-confirm" type="password" autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} />
              </Field>
              <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
              <div className="flex items-center gap-3">
                <Button onClick={changePassword} disabled={pwSaving || !pwForm.current || pwForm.next.length < 8}>
                  {pwSaving && <Spinner />} Change password
                </Button>
                {pwMsg && <p className={`text-sm ${pwMsg.ok ? "text-success" : "text-destructive"}`}>{pwMsg.text}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You signed up with Google. To use a password instead, sign out and use &quot;Forgot password&quot; on the sign-in page to set one.
            </p>
          )}
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
                  <Button
                    className="mt-4 w-full"
                    variant={current ? "outline" : "default"}
                    disabled={!!payStarting}
                    onClick={() => choosePayment(p.key)}
                  >
                    {payStarting === p.key && <Spinner />}
                    {subscriptionActive ? "Top up" : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {payError && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{payError}</p>}
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

    </div>
  );
}

/** Label + control wrapper for the settings forms. */
function Field({ label, id, className, children }: { label: string; id: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
