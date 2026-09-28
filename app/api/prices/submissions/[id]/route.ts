import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getSubmission, commitSubmission, discardSubmission } from "@/lib/services/price-submissions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwned(ctx: Ctx, user: { id: string; role?: string }) {
  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) return { error: fail("Not found.", 404, "NOT_FOUND") };
  const sub = await getSubmission(id);
  if (!sub) return { error: fail("Not found.", 404, "NOT_FOUND") };
  const isAdmin = user.role === "admin";
  if (!isAdmin && String(sub.userId) !== user.id) return { error: fail("Not found.", 404, "NOT_FOUND") };
  if (sub.kind === "benchmark" && !isAdmin) return { error: fail("Not found.", 404, "NOT_FOUND") };
  return { sub };
}

/** GET /api/prices/submissions/[id] — full submission with extracted rows. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { sub, error } = await loadOwned(ctx, user);
    if (error) return error;
    return ok({
      submission: {
        _id: String(sub!._id),
        kind: sub!.kind,
        sourceName: sub!.sourceName,
        filename: sub!.filename,
        status: sub!.status,
        rows: sub!.rows,
        effectiveDate: sub!.effectiveDate ?? null,
        createdAt: sub!.createdAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/prices/submissions/[id] — commit into the live price library. */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { sub, error } = await loadOwned(ctx, user);
    if (error) return error;
    const written = await commitSubmission(sub!, new ObjectId(user.id));
    return ok({ committed: written });
  } catch (err) {
    if (err instanceof Error && /already been processed/.test(err.message)) {
      return fail(err.message, 409, "ALREADY_PROCESSED");
    }
    return handleError(err);
  }
}

/** DELETE /api/prices/submissions/[id] — discard without committing. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { sub, error } = await loadOwned(ctx, user);
    if (error) return error;
    await discardSubmission(sub!, new ObjectId(user.id));
    return ok({ discarded: true });
  } catch (err) {
    return handleError(err);
  }
}
