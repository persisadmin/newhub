import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    await ensureIndexes();
    const db = await getDb();
    const url = new URL(req.url);
    const flag = url.searchParams.get("flag");
    const filter: Record<string, unknown> = { projectId: project._id };
    if (flag === "flagged") filter.reviewFlag = { $ne: null };
    const records = await db.collection("pricing_records").find(filter).sort({ createdAt: 1 }).limit(2000).toArray();
    return ok(records.map((r) => ({ ...r, _id: String(r._id), itemId: String(r.itemId), projectId: String(r.projectId) })));
  } catch (err) {
    return handleError(err);
  }
}
