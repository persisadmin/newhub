import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
};

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`upload:${user.id}`, 20, 60_000);
    if (!rl.allowed) return fail("Upload rate limit reached. Try again shortly.", 429, "RATE_LIMITED");
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    if (project.status === "processing") return fail("Project is currently processing.", 409, "BUSY");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("No file provided.", 422, "VALIDATION");

    const env = getEnv();
    if (file.size > env.UPLOAD_MAX_BYTES) return fail(`File exceeds the ${Math.round(env.UPLOAD_MAX_BYTES / 1048576)}MB limit.`, 413, "TOO_LARGE");

    const ext = path.extname(file.name).toLowerCase();
    const mimeOk = ALLOWED[file.type];
    const extOk = Object.values(ALLOWED).includes(ext);
    if (!mimeOk && !extOk) return fail("Unsupported file type. Upload a PDF, DOCX, or TXT file.", 415, "BAD_TYPE");

    await ensureIndexes();
    const dir = path.join(process.cwd(), "data", "uploads", id);
    await fs.mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, `${crypto.randomBytes(8).toString("hex")}${ext || ".bin"}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(storagePath, buf);

    const db = await getDb();
    const res = await db.collection("tender_documents").insertOne({
      projectId: new ObjectId(id),
      userId: new ObjectId(user.id),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath,
      uploadedAt: new Date(),
    });
    await db.collection("projects").updateOne({ _id: project._id }, { $set: { updatedAt: new Date() } });
    await audit({ userId: user.id, action: "tender.uploaded", entityType: "tender_document", entityId: res.insertedId, newValue: { filename: file.name, sizeBytes: file.size, projectId: id }, source: "api" });
    return ok({ id: String(res.insertedId), filename: file.name }, 201);
  } catch (err) {
    return handleError(err);
  }
}
