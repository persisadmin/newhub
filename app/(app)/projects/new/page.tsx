"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input, Label, Textarea, Spinner } from "@/components/ui";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
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
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Link href="/projects"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={loading}>{loading && <Spinner />} Create project</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
