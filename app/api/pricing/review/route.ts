import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/** Cross-project pricing review queue: all flagged records belonging to the user. */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const records = await db.collection("pricing_records").aggregate([
      { $match: { reviewFlag: { $ne: null } } },
      { $lookup: { from: "projects", localField: "projectId", foreignField: "_id", as: "project" } },
      { $unwind: "$project" },
      { $match: { "project.userId": new ObjectId(user.id), "project.archivedAt": { $exists: false } } },
      { $project: { project: { userId: 0 } } },
      { $sort: { updatedAt: -1 } },
      { $limit: 500 },
    ]).toArray();
    return ok(records.map((r) => ({
      ...r,
      _id: String(r._id),
      itemId: String(r.itemId),
      projectId: String(r.projectId),
      project: { _id: String(r.project._id), name: r.project.name },
    })));
  } catch (err) {
    return handleError(err);
  }
}
