"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label, Textarea, Spinner } from "@/components/ui";
import { RegionFields, type RegionValue } from "@/components/region-fields";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState<RegionValue>({});
  const [profitMargin, setProfitMargin] = useState("");
  const [contingency, setContingency] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const marginNum = profitMargin.trim() === "" ? null : Number(profitMargin);
  const contingencyNum = contingency.trim() === "" ? null : Number(contingency);
  const marginValid = marginNum === null || (Number.isFinite(marginNum) && marginNum >= 0 && marginNum <= 100);
  const contingencyValid = contingencyNum === null || (Number.isFinite(contingencyNum) && contingencyNum >= 0 && contingencyNum <= 100);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        ...region,
        profitMarginPct: marginNum,
        contingencyPct: contingencyNum,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!data.ok) { setError(data.error?.message ?? "Failed to create project."); return; }
    router.push(`/projects/${data.data.id}`);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New tender project</CardTitle>
          <CardDescription>Create a project, then upload the tender document for analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project name</Label>
              <Input id="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. JKR School Upgrade Tender 2026" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes about this tender…" />
            </div>
            <RegionFields value={region} onChange={setRegion} />
            <div className="space-y-3 rounded-md border border-border p-4">
              <p className="text-sm font-medium">Pricing <span className="font-normal text-muted-foreground">(optional — you can change these later)</span></p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contingency">Contingency sum</Label>
                  <div className="relative">
                    <Input
                      id="contingency"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="0"
                      value={contingency}
                      onChange={(e) => setContingency(e.target.value)}
                      className="pr-7 text-right"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Buffer for unforeseen costs, applied before margin.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profit-margin">Target profit margin</Label>
                  <div className="relative">
                    <Input
                      id="profit-margin"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder="0"
                      value={profitMargin}
                      onChange={(e) => setProfitMargin(e.target.value)}
                      className="pr-7 text-right"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground">%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Your markup on top of cost + contingency.</p>
                </div>
              </div>
              {!marginValid && <p role="alert" className="text-xs text-destructive">Profit margin must be between 0 and 100%.</p>}
              {!contingencyValid && <p role="alert" className="text-xs text-destructive">Contingency must be between 0 and 100%.</p>}
            </div>
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Link href="/projects"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={loading || !marginValid || !contingencyValid}>{loading && <Spinner />} Create project</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
