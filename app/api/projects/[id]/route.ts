import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";
import { isRunning } from "@/lib/services/processing/runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  archive: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    await ensureIndexes();
    const db = await getDb();
    const pid = new ObjectId(id);
    const [documents, extraction, boqItems, jobs] = await Promise.all([
      db.collection("tender_documents").find({ projectId: pid }).sort({ uploadedAt: -1 }).toArray(),
      db.collection("tender_extractions").findOne({ projectId: pid }, { sort: { attempt: -1 } }),
      db.collection("boq_items").find({ projectId: pid }).sort({ itemNo: 1 }).toArray(),
      db.collection("processing_jobs").find({ projectId: pid }).sort({ attempt: -1 }).limit(20).toArray(),
    ]);
    return ok({
      project: { ...project, _id: String(project._id), userId: String(project.userId), processing: isRunning(id) },
      documents: documents.map((d) => ({ ...d, _id: String(d._id), projectId: String(d.projectId), userId: String(d.userId), storagePath: undefined })),
      extraction: extraction ? { ...extraction, _id: String(extraction._id), projectId: String(extraction.projectId) } : null,
      boqItems: boqItems.map((b) => ({ ...b, _id: String(b._id), projectId: String(b.projectId) })),
      jobs: jobs.map((j) => ({ ...j, _id: String(j._id), projectId: String(j.projectId), userId: String(j.userId) })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const body = patchSchema.parse(await req.json());
    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.archive !== undefined) {
      update.status = body.archive ? "archived" : "draft";
      update.archivedAt = body.archive ? new Date() : undefined;
    }
    await db.collection("projects").updateOne({ _id: project._id }, { $set: update });
    await audit({ userId: user.id, action: "project.updated", entityType: "project", entityId: id, previousValue: { name: project.name, status: project.status }, newValue: update, source: "api" });
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    if (isRunning(id)) return fail("Cannot delete a project while it is processing.", 409, "BUSY");
    const db = await getDb();
    const pid = new ObjectId(id);
    await Promise.all([
      db.collection("projects").deleteOne({ _id: pid }),
      db.collection("tender_documents").deleteMany({ projectId: pid }),
      db.collection("tender_extractions").deleteMany({ projectId: pid }),
      db.collection("boq_items").deleteMany({ projectId: pid }),
      db.collection("pricing_records").deleteMany({ projectId: pid }),
      db.collection("processing_jobs").deleteMany({ projectId: pid }),
    ]);
    await audit({ userId: user.id, action: "project.deleted", entityType: "project", entityId: id, previousValue: { name: project.name }, source: "api" });
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
