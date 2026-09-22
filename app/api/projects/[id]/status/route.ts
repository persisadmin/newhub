import { getDb } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { isRunning } from "@/lib/services/processing/runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const db = await getDb();
    const stats = await db.collection("pricing_records").aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: null, total: { $sum: 1 }, flagged: { $sum: { $cond: [{ $ne: ["$reviewFlag", null] }, 1, 0] } },
        missing: { $sum: { $cond: [{ $eq: ["$reviewFlag", "missing_price"] }, 1, 0] } } } },
    ]).toArray();
    return ok({
      status: project.status,
      currentStage: project.currentStage ?? null,
      stageUpdatedAt: project.stageUpdatedAt ?? null,
      running: isRunning(id),
      error: project.processingError ?? null,
      pricing: stats[0] ?? { total: 0, flagged: 0, missing: 0 },
    });
  } catch (err) {
    return handleError(err);
  }
}
