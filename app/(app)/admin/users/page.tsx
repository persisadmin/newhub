"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Skeleton, StatusBadge } from "@/components/ui";
import { formatMYR } from "@/lib/utils";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  companyName: string | null;
  phone: string | null;
  address: { line1?: string; line2?: string; city?: string; state?: string; postcode?: string } | null;
  role: string;
  accountType: "password" | "google";
  registeredAt: string;
  subscription: { plan: string; interval: string; status: string; currentPeriodEnd: string } | null;
  creditBalance: number;
  projectCount: number;
  totalPaidSen: number;
  paymentCount: number;
  lastPaymentAt: string | null;
}

type SortKey = "registeredAt" | "name" | "creditBalance" | "projectCount" | "totalPaidSen";

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("registeredAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      if (json.ok) setUsers(json.data.users);
      else setError(json.error?.message ?? "Could not load users.");
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    const base = q
      ? users.filter((u) =>
          [u.name, u.email, u.companyName ?? "", u.phone ?? ""].some((f) => f.toLowerCase().includes(q))
        )
      : users;
    const dir = sortAsc ? 1 : -1;
    return [...base].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  }, [users, query, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((s) => !s);
    else { setSortKey(key); setSortAsc(key === "name"); }
  }

  const totalPaidAll = (users ?? []).reduce((s, u) => s + u.totalPaidSen, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Every registered account, with subscription, credit and activity details.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Registered users</CardTitle>
            <CardDescription>
              {users ? `${users.length} account${users.length === 1 ? "" : "s"} · ${formatMYR(totalPaidAll)} collected` : "Loading…"}
            </CardDescription>
          </div>
          <Input
            className="w-64"
            placeholder="Search name, email, company, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!users && !error && <Skeleton className="h-40 w-full" />}
          {filtered && filtered.length === 0 && (
            <EmptyState title="No users found" description={query ? "Try a different search." : "No one has registered yet."} />
          )}
          {filtered && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <Th onClick={() => toggleSort("registeredAt")} active={sortKey === "registeredAt"} asc={sortAsc}>Registered</Th>
                    <Th onClick={() => toggleSort("name")} active={sortKey === "name"} asc={sortAsc}>User</Th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Subscription</th>
                    <Th className="text-right" onClick={() => toggleSort("creditBalance")} active={sortKey === "creditBalance"} asc={sortAsc}>Credits</Th>
                    <Th className="text-right" onClick={() => toggleSort("projectCount")} active={sortKey === "projectCount"} asc={sortAsc}>Projects</Th>
                    <Th className="text-right" onClick={() => toggleSort("totalPaidSen")} active={sortKey === "totalPaidSen"} asc={sortAsc}>Total paid</Th>
                    <th className="px-4 py-3 font-medium">Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {filtered.map((u) => (
                    <tr key={u.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(u)}>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(u.registeredAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.companyName ?? "—"}</td>
                      <td className="px-4 py-3">
                        {u.subscription ? (
                          <span className="flex items-center gap-2">
                            <span className="capitalize">{u.subscription.plan}</span>
                            <StatusBadge status={u.subscription.status} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.creditBalance.toLocaleString("en-MY", { maximumFractionDigits: 1 })}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.projectCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{u.totalPaidSen ? formatMYR(u.totalPaidSen) : "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={u.accountType === "google" ? "secondary" : "default"}>
                          {u.accountType === "google" ? "Google" : "Email"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setSelected(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">{selected.email}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">✕</button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <Section title="Account">
                <Row label="Registered" value={new Date(selected.registeredAt).toLocaleString("en-MY")} />
                <Row label="Role" value={selected.role} />
                <Row label="Sign-in" value={selected.accountType === "google" ? "Google OAuth" : "Email & password"} />
                <Row label="User ID" value={<span className="font-mono text-xs">{selected.id}</span>} />
              </Section>

              <Section title="Company & contact">
                <Row label="Company" value={selected.companyName ?? "—"} />
                <Row label="Phone" value={selected.phone ?? "—"} />
                <Row
                  label="Address"
                  value={
                    selected.address
                      ? [selected.address.line1, selected.address.line2, selected.address.city, selected.address.state, selected.address.postcode]
                          .filter(Boolean)
                          .join(", ") || "—"
                      : "—"
                  }
                />
              </Section>

              <Section title="Subscription">
                {selected.subscription ? (
                  <>
                    <Row label="Plan" value={<span className="capitalize">{selected.subscription.plan} · {selected.subscription.interval}</span>} />
                    <Row label="Status" value={<StatusBadge status={selected.subscription.status} />} />
                    <Row label="Renews/ends" value={fmtDate(selected.subscription.currentPeriodEnd)} />
                  </>
                ) : (
                  <p className="text-muted-foreground">No active subscription.</p>
                )}
                <Row label="Credit balance" value={selected.creditBalance.toLocaleString("en-MY", { maximumFractionDigits: 1 })} />
              </Section>

              <Section title="Activity">
                <Row label="Projects" value={String(selected.projectCount)} />
                <Row label="Verified payments" value={String(selected.paymentCount)} />
                <Row label="Total paid" value={selected.totalPaidSen ? formatMYR(selected.totalPaidSen) : "—"} />
                <Row label="Last payment" value={fmtDate(selected.lastPaymentAt)} />
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, onClick, active, asc, className = "" }: {
  children: React.ReactNode; onClick: () => void; active: boolean; asc: boolean; className?: string;
}) {
  return (
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button onClick={onClick} className="flex items-center gap-1 hover:text-foreground">
        {children}
        {active && <span aria-hidden>{asc ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="space-y-1 rounded-md border border-border p-3">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
