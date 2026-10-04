import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { getDb, ensureIndexes } from "@/lib/db";
import type { IssueDoc, IssueCommentDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().min(1).max(20000).optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty.").max(5000),
});

/** GET /api/admin/issues/[id] — one issue plus its comment thread (admin only). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return fail("Invalid issue id.", 400, "VALIDATION");
    const db = await getDb();
    const issue = await db.collection<IssueDoc>("issues").findOne({ _id: new ObjectId(id) });
    if (!issue) return fail("Issue not found.", 404, "NOT_FOUND");
    const comments = await db
      .collection<IssueCommentDoc>("issue_comments")
      .find({ issueId: new ObjectId(id) })
      .sort({ createdAt: 1 })
      .toArray();
    return ok({
      issue: { ...issue, _id: String(issue._id), createdBy: String(issue.createdBy) },
      comments: comments.map((c) => ({ ...c, _id: String(c._id), issueId: String(c.issueId), createdBy: String(c.createdBy) })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/admin/issues/[id] — update status / title / description (admin only). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return fail("Invalid issue id.", 400, "VALIDATION");
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400, "VALIDATION");
    const db = await getDb();
    const update: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    const res = await db.collection("issues").updateOne({ _id: new ObjectId(id) }, { $set: update });
    if (res.matchedCount === 0) return fail("Issue not found.", 404, "NOT_FOUND");
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/admin/issues/[id] — add a feedback comment (admin only). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return fail("Invalid issue id.", 400, "VALIDATION");
    const parsed = commentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400, "VALIDATION");

    await ensureIndexes();
    const db = await getDb();
    const issue = await db.collection("issues").findOne({ _id: new ObjectId(id) });
    if (!issue) return fail("Issue not found.", 404, "NOT_FOUND");

    const comment: Omit<IssueCommentDoc, "_id"> = {
      issueId: new ObjectId(id),
      body: parsed.data.body,
      createdBy: new ObjectId(user.id),
      createdByName: user.name ?? user.email,
      createdAt: new Date(),
    };
    await db.collection("issue_comments").insertOne(comment as IssueCommentDoc);
    await db.collection("issues").updateOne(
      { _id: new ObjectId(id) },
      { $inc: { commentCount: 1 }, $set: { updatedAt: new Date() } }
    );
    return ok({}, 201);
  } catch (err) {
    return handleError(err);
  }
}
