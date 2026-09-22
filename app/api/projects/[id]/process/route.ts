import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";
import { startProcessing, requestCancel, isRunning } from "@/lib/services/processing/runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const startSchema = z.object({ documentId: z.string() });

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireOwnedProject(id, user);
    if (isRunning(id)) return fail("Processing is already running for this project.", 409, "BUSY");
    const { documentId } = startSchema.parse(await req.json());
    if (!ObjectId.isValid(documentId)) return fail("Invalid document.", 422, "VALIDATION");
    await ensureIndexes();
    const db = await getDb();
    const doc = await db.collection("tender_documents").findOne({ _id: new ObjectId(documentId), projectId: new ObjectId(id) });
    if (!doc) return fail("Document not found in this project.", 404, "NOT_FOUND");
    const last = await db.collection("processing_jobs").findOne({ projectId: new ObjectId(id) }, { sort: { attempt: -1 } });
    const attempt = (last?.attempt ?? 0) + 1;
    await db.collection("processing_jobs").insertOne({
      projectId: new ObjectId(id), userId: new ObjectId(user.id), documentId: new ObjectId(documentId),
      attempt, stage: "document_processing", status: "running", startedAt: new Date(),
    });
    startProcessing(id, documentId, user.id, attempt);
    await audit({ userId: user.id, action: "tender.processing_started", entityType: "project", entityId: id, newValue: { attempt, documentId }, source: "api" });
    return ok({ attempt }, 202);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireOwnedProject(id, user);
    const cancelled = requestCancel(id);
    if (!cancelled) return fail("No running processing job to cancel.", 409, "NOT_RUNNING");
    return ok({ cancelled: true });
  } catch (err) {
    return handleError(err);
  }
}
