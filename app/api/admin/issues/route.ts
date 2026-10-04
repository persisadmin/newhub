import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { getDb, ensureIndexes } from "@/lib/db";
import type { IssueDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(3, "Title is too short.").max(200),
  description: z.string().trim().min(1, "Description is required.").max(20000),
});

/** GET /api/admin/issues — list all issues (admin only). */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    await ensureIndexes();
    const db = await getDb();
    const issues = await db
      .collection<IssueDoc>("issues")
      .find({})
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray();
    return ok(
      issues.map((i) => ({
        _id: String(i._id),
        title: i.title,
        description: i.description,
        status: i.status,
        createdByName: i.createdByName ?? "Admin",
        commentCount: i.commentCount ?? 0,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      }))
    );
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/admin/issues — raise a new issue (admin only). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400, "VALIDATION");

    await ensureIndexes();
    const db = await getDb();
    const now = new Date();
    const doc: Omit<IssueDoc, "_id"> = {
      title: parsed.data.title,
      description: parsed.data.description,
      status: "open",
      createdBy: new ObjectId(user.id),
      createdByName: user.name ?? user.email,
      createdAt: now,
      updatedAt: now,
      commentCount: 0,
    };
    const res = await db.collection("issues").insertOne(doc as IssueDoc);
    return ok({ _id: String(res.insertedId) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
