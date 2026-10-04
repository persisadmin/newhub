"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, MessageSquare } from "lucide-react";
import { Button, Input, Textarea, Label, Modal, Skeleton, EmptyState } from "@/components/ui";

interface Issue {
  _id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "done";
  createdByName: string;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

function fmtDateTime(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_STYLE: Record<Issue["status"], string> = {
  open: "bg-warning/15 text-warning-foreground border-warning/30",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  done: "bg-success/15 text-success border-success/30",
};
const STATUS_LABEL: Record<Issue["status"], string> = { open: "Open", in_progress: "In progress", done: "Done" };

export default function AdminIssuesPage() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/issues");
    const json = await res.json();
    if (json.ok) setIssues(json.data);
    else setError(json.error?.message ?? "Could not load issues.");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setFormError(null);
    if (title.trim().length < 3) { setFormError("Give the issue a clear title."); return; }
    if (!description.trim()) { setFormError("Describe the issue."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setCreating(false); setTitle(""); setDescription("");
        load();
      } else {
        setFormError(json.error?.message ?? "Could not create the issue.");
      }
    } finally {
      setBusy(false);
    }
  }

  const open = (issues ?? []).filter((i) => i.status !== "done").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Issues</h1>
          <p className="text-sm text-muted-foreground">
            Internal issues raised by the admin team — discuss, track status, and resolve. {issues ? `${open} open · ${issues.length} total` : ""}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus size={14} /> New issue</Button>
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {issues === null ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : issues.length === 0 ? (
        <EmptyState
          title="No issues yet"
          description="Raise the first issue for the admin team to discuss."
          action={<Button onClick={() => setCreating(true)}><Plus size={14} /> New issue</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Raised by</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Created</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Last updated</th>
                <th className="hidden px-4 py-3 font-medium text-right sm:table-cell">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {issues.map((i) => (
                <tr key={i._id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/issues/${i._id}`} className="font-medium text-primary hover:underline">{i.title}</Link>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{i.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{i.createdByName}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{fmtDateTime(i.createdAt)}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{fmtDateTime(i.updatedAt)}</td>
                  <td className="hidden px-4 py-3 text-right text-muted-foreground sm:table-cell">
                    <span className="inline-flex items-center gap-1"><MessageSquare size={12} /> {i.commentCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Raise a new issue">
        <div className="space-y-4">
          <div>
            <Label htmlFor="issue-title">Title</Label>
            <Input id="issue-title" placeholder="e.g. DuitNow QR not appearing at checkout" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="issue-desc">Description</Label>
            <Textarea id="issue-desc" rows={5} placeholder="What's the issue? Steps to reproduce, expected vs actual, who it affects…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create issue"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
