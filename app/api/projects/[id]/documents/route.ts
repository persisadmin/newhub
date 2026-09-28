import fs from "fs/promises";
import path from "path";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";
import { hasActiveSubscription } from "@/lib/services/credits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
};
const ALLOWED_EXT = [".pdf", ".docx", ".txt"];

/** List generated tender deliverables for a project. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const db = await getDb();
    const docs = await db
      .collection("project_documents")
      .find({ projectId: project._id })
      .sort({ type: 1 })
      .project({ _id: 1, type: 1, title: 1, filename: 1, contentType: 1, size: 1, createdAt: 1 })
      .toArray();
    return ok({ documents: docs });
  } catch (err) {
    return handleError(err);
  }
}

/** Upload a tender document (PDF / DOCX / TXT) into a project. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`upload:${user.id}:${getIp(req)}`, 30, 60_000);
    if (!rl.allowed) {
      return fail(`Too many uploads. Retry in ${rl.retryAfterSec}s.`, 429, "RATE_LIMITED");
    }
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    // Uploads and scans require an active subscription (admins bypass).
    if (user.role !== "admin" && !(await hasActiveSubscription(new ObjectId(user.id)))) {
      return fail(
        "An active subscription is required to upload or scan tender documents. Choose a credit package in Settings.",
        402,
        "SUBSCRIPTION_REQUIRED"
      );
    }
    const env = getEnv();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: "No file provided." } },
        { status: 400 }
      );
    }
    if (file.size > env.UPLOAD_MAX_BYTES) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: `File exceeds the ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)}MB limit.` } },
        { status: 400 }
      );
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.includes(ext) && !ALLOWED_TYPES[file.type]) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: "Only PDF, DOCX and TXT files are supported." } },
        { status: 400 }
      );
    }

    await ensureIndexes();
    const db = await getDb();
    const docId = new ObjectId();
    const dir = path.join("data", "uploads", project._id.toString());
    await fs.mkdir(dir, { recursive: true });
    const safeExt = ALLOWED_EXT.includes(ext) ? ext : ALLOWED_TYPES[file.type] ?? ".bin";
    const storagePath = path.join(dir, `${docId.toString()}${safeExt}`);
    await fs.writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

    const record = {
      _id: docId,
      projectId: project._id,
      userId: new ObjectId(user.id),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath,
      uploadedAt: new Date(),
    };
    await db.collection("tender_documents").insertOne(record);
    await audit({
      userId: new ObjectId(user.id),
      action: "tender.uploaded",
      entityType: "tender_document",
      entityId: docId,
      newValue: { projectId: project._id.toString(), filename: file.name, sizeBytes: file.size },
      source: "api",
    });
    return ok({ document: { ...record, _id: String(docId) } });
  } catch (err) {
    return handleError(err);
  }
}
