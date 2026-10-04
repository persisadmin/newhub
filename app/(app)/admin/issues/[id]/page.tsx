"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea, Skeleton } from "@/components/ui";

type Status = "open" | "in_progress" | "done";

interface Issue {
  _id: string; title: string; description: string; status: Status;
  createdByName?: string; createdAt: string; updatedAt: string; commentCount: number;
}
interface Comment { _id: string; body: string; createdByName?: string; createdAt: string; }

function fmtDateTime(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}
const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", done: "Done" };
const STATUS_STYLE: Record<Status, string> = {
  open: "bg-warning/15 text-warning-foreground border-warning/30",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  done: "bg-success/15 text-success border-success/30",
};
const NEXT: Record<Status, Status | null> = { open: "in_progress", in_progress: "done", done: null };

export default function AdminIssueDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/issues/${id}`);
    const json = await res.json();
    if (json.ok) { setIssue(json.data.issue); setComments(json.data.comments); }
    else setNotFound(true);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(status: Status) {
    setBusy(true);
    await fetch(`/api/admin/issues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setBusy(false);
    load();
  }

  async function addComment() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/admin/issues/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: body.trim() }) });
    setBusy(false);
    const json = await res.json();
    if (json.ok) { setBody(""); load(); }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link href="/admin/issues" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft size={14} /> Back to issues</Link>
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Issue not found.</p>
      </div>
    );
  }
  if (!issue) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;

  const next = NEXT[issue.status];

  return (
    <div className="space-y-6">
      <Link href="/admin/issues" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft size={14} /> Back to issues</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{issue.title}</h1>
            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[issue.status]}`}>{STATUS_LABEL[issue.status]}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Raised by {issue.createdByName ?? "Admin"} · Created {fmtDateTime(issue.createdAt)} · Last updated {fmtDateTime(issue.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {issue.status !== "open" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("open")}>Reopen</Button>
          )}
          {next && (
            <Button size="sm" disabled={busy} onClick={() => setStatus(next)}>
              {next === "in_progress" ? "Start progress" : "Mark done"}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
        <CardContent><p className="whitespace-pre-wrap text-sm">{issue.description}</p></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquare size={16} /> Discussion ({comments.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet — start the discussion.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c._id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.createdByName ?? "Admin"} · {fmtDateTime(c.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border-t border-border pt-4">
            <Textarea rows={3} placeholder="Add your feedback…" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex justify-end">
              <Button size="sm" onClick={addComment} disabled={busy || !body.trim()}><Send size={12} /> Comment</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
