import fs from "fs/promises";
import { getDb } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** Download a generated tender deliverable (ownership enforced). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id, docId } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const db = await getDb();
    const doc = await db.collection<{ storagePath: string; filename: string; contentType: string }>(
      "project_documents"
    ).findOne({ _id: new (await import("mongodb")).ObjectId(docId), projectId: project._id });
    if (!doc) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

    const buf = await fs.readFile(doc.storagePath);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.filename)}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
