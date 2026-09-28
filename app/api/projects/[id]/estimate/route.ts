import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { estimateProcessingCost, getCreditBalance, hasActiveSubscription } from "@/lib/services/credits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/estimate?documentId=…
 * Pre-flight credit estimate for processing a document, plus the user's
 * balance and whether this attempt qualifies as the one free retry.
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const documentId = new URL(req.url).searchParams.get("documentId");
    if (!documentId || !ObjectId.isValid(documentId)) return fail("Invalid document.", 422, "VALIDATION");
    const db = await getDb();
    const doc = await db.collection("tender_documents").findOne({ _id: new ObjectId(documentId), projectId: project._id });
    if (!doc) return fail("Document not found in this project.", 404, "NOT_FOUND");

    const estimate = await estimateProcessingCost({
      sizeBytes: doc.sizeBytes as number,
      contentType: (doc.contentType as string) ?? "",
      filename: doc.filename as string,
    });

    const subscribed = user.role === "admin" || (await hasActiveSubscription(new ObjectId(user.id)));
    const balance = await getCreditBalance(new ObjectId(user.id));

    // One free retry per project: a previous failed job and retry not yet used.
    const lastJob = await db.collection("processing_jobs").findOne({ projectId: project._id }, { sort: { attempt: -1 } });
    const freeRetry = Boolean(lastJob && lastJob.status === "failed" && !project.freeRetryUsed);

    return ok({
      estimate,
      balance,
      subscribed,
      freeRetry,
      sufficient: freeRetry || balance + 1e-9 >= estimate.credits,
    });
  } catch (err) {
    return handleError(err);
  }
}
