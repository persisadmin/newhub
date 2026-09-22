"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Archive, Trash2 } from "lucide-react";
import { Button, Input, StatusBadge, Skeleton, EmptyState, Modal } from "@/components/ui";

interface Project {
  _id: string;
  name: string;
  status: string;
  tenderTitle?: string;
  tenderNumber?: string;
  createdAt: string;
}

const FILTERS = ["all", "draft", "processing", "awaiting_review", "completed"] as const;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    const res = await fetch(`/api/projects?${params}`);
    const data = await res.json();
    if (data.ok) setProjects(data.data);
    else setError(data.error?.message ?? "Failed to load projects.");
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function archive(p: Project) {
    setBusy(true);
    await fetch(`/api/projects/${p._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: true }) });
    setBusy(false);
    load();
  }

  async function remove(p: Project) {
    setBusy(true);
    await fetch(`/api/projects/${p._id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Create, search and manage your tender projects.</p>
        </div>
        <Link href="/projects/new"><Button><Plus size={14} /> New Project</Button></Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${status === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All" : f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {projects === null ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects found"
          description={q || status !== "all" ? "Try adjusting your search or filter." : "Create your first project to begin."}
          action={<Link href="/projects/new"><Button>New Project</Button></Link>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Tender No.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {projects.map((p) => (
                <tr key={p._id} className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p._id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    {p.tenderTitle && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.tenderTitle}</p>}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{p.tenderNumber ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{new Date(p.createdAt).toLocaleDateString("en-MY")}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" disabled={busy} onClick={() => archive(p)} aria-label="Archive project"><Archive size={14} /></Button>
                      <Button variant="ghost" size="icon" disabled={busy} onClick={() => setConfirmDelete(p)} aria-label="Delete project"><Trash2 size={14} className="text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete project">
        <p className="text-sm text-muted-foreground">
          Delete <strong className="text-foreground">{confirmDelete?.name}</strong>? Its documents, BOQ and pricing records will be permanently removed.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={() => confirmDelete && remove(confirmDelete)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
