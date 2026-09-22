import { ObjectId } from "mongodb";
import Link from "next/link";
import { FolderKanban, Cpu, CheckCircle2, Flag, ArrowRight, FileWarning } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDb, ensureIndexes } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, StatusBadge, Button, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await ensureIndexes();
  const db = await getDb();
  const uid = new ObjectId(session.user.id);

  const [byStatus, flagAgg, missing, recent] = await Promise.all([
    db.collection("projects").aggregate([
      { $match: { userId: uid, archivedAt: { $exists: false } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    db.collection("pricing_records").aggregate([
      { $lookup: { from: "projects", localField: "projectId", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.userId": uid } },
      { $match: { reviewFlag: { $ne: null } } },
      { $count: "n" },
    ]).toArray(),
    db.collection("pricing_records").aggregate([
      { $lookup: { from: "projects", localField: "projectId", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.userId": uid, reviewFlag: "missing_price" } },
      { $count: "n" },
    ]).toArray(),
    db.collection("projects").find({ userId: uid, archivedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(5).toArray(),
  ]);

  const counts: Record<string, number> = {};
  for (const r of byStatus) counts[r._id as string] = r.count as number;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const reviewCount = flagAgg[0]?.n ?? 0;
  const missingCount = missing[0]?.n ?? 0;

  const kpis = [
    { label: "Total Projects", value: total, icon: FolderKanban },
    { label: "Processing", value: counts["processing"] ?? 0, icon: Cpu },
    { label: "Completed", value: counts["completed"] ?? 0, icon: CheckCircle2 },
    { label: "Items to Review", value: reviewCount, icon: Flag },
    { label: "Missing Prices", value: missingCount, icon: FileWarning },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">Your tender workspace at a glance.</p>
        </div>
        <Link href="/projects/new"><Button>New Project <ArrowRight size={14} /></Button></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
          </Card>
        ))}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent projects</h2>
          <Link href="/projects" className="text-sm text-primary hover:underline">View all</Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project and upload a tender document to see extraction and pricing intelligence in action."
            action={<Link href="/projects/new"><Button>Create project</Button></Link>}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {recent.map((p) => (
                  <tr key={String(p._id)} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/projects/${p._id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                      {p.tenderTitle && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.tenderTitle}</p>}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{p.tenderNumber ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{new Date(p.createdAt).toLocaleDateString("en-MY")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
