"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Modal, Skeleton } from "@/components/ui";

/**
 * Admin landing-page switcher.
 *
 * Shows every variant in the registry, which one is live at /, and lets an
 * admin activate another (audited). Each variant has its own /lp/<slug> URL so
 * it can be previewed before going live — or used directly for campaign
 * traffic regardless of which variant is currently active.
 */

interface Variant {
  slug: string;
  name: string;
  description: string;
  status: string;
  url: string;
}

export default function AdminLandingPage() {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Variant | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/landing");
    if (res.status === 403) { setForbidden(true); return; }
    const json = await res.json();
    if (json.ok) {
      setVariants(json.data.variants);
      setActive(json.data.activeVariant);
      setUpdatedAt(json.data.updatedAt);
    } else {
      setError(json.error?.message ?? "Could not load landing variants.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function activate(slug: string) {
    setBusy(slug); setMsg(null); setError(null);
    const res = await fetch("/api/admin/landing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeVariant: slug }),
    });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) { setError(json.error?.message ?? "Could not activate this variant."); return; }
    setActive(slug);
    setMsg(`Live. The home page is now serving “${variants?.find((v) => v.slug === slug)?.name ?? slug}”.`);
    load();
  }

  if (forbidden) {
    return <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Admin access required.</p>;
  }
  if (!variants) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Landing Pages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which landing page visitors see at <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/</code>.
          Every variant also has its own URL for campaigns and preview.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variants</CardTitle>
          <CardDescription>
            Preview opens the variant on its own URL (<code className="text-xs">/lp/&lt;slug&gt;</code>) — that URL is
            public and marked noindex, so it is safe to use for ads but won&apos;t compete with your home page in search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {variants.map((v) => {
            const isActive = v.slug === active;
            return (
              <div
                key={v.slug}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${isActive ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{v.name}</span>
                    {isActive && (
                      <Badge variant="success"><CheckCircle2 size={10} className="mr-1" /> Live</Badge>
                    )}
                    {v.status === "draft" && <Badge variant="secondary">Draft</Badge>}
                    <code className="text-xs text-muted-foreground">/lp/{v.slug}</code>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{v.description}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a href={v.url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><ExternalLink size={12} /> Preview</Button>
                  </a>
                  <Button size="sm" onClick={() => setConfirming(v)} disabled={isActive || busy !== null}>
                    {busy === v.slug ? <Loader2 size={12} className="animate-spin" /> : null}
                    {isActive ? "Active" : "Activate"}
                  </Button>
                </div>
              </div>
            );
          })}

          {msg && <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <p className="pt-1 text-xs text-muted-foreground">
            {updatedAt
              ? `Last switched ${new Date(updatedAt).toLocaleString("en-MY")}.`
              : "Never switched — serving the default variant."}
            {" "}Activations are recorded in the audit log, and reverting is simply activating the previous variant.
          </p>
        </CardContent>
      </Card>

      <Modal open={!!confirming} onClose={() => setConfirming(null)} title="Switch the live landing page?">
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm">
              Every visitor to <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/</code> will see{" "}
              <strong>{confirming.name}</strong> from the next page load.
            </p>
            <ul className="space-y-1 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <li>· Search engines will pick up this variant&apos;s title and description.</li>
              <li>· The change is recorded in the audit log.</li>
              <li>· Rollback is one click — every variant stays available at its own URL.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                onClick={() => { const slug = confirming.slug; setConfirming(null); activate(slug); }}
                disabled={busy !== null}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null} Activate
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
