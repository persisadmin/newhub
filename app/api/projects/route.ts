import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    const status = url.searchParams.get("status");
    const filter: Record<string, unknown> = { userId: new ObjectId(user.id), archivedAt: { $exists: false } };
    if (status && ["draft", "processing", "awaiting_review", "completed", "archived"].includes(status)) {
      if (status === "archived") { delete filter.archivedAt; filter.status = "archived"; }
      else filter.status = status;
    }
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    const projects = await db.collection("projects").find(filter).sort({ createdAt: -1 }).limit(200).toArray();
    return ok(projects.map((p) => ({ ...p, _id: String(p._id), userId: String(p.userId) })));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());
    await ensureIndexes();
    const db = await getDb();
    const now = new Date();
    const res = await db.collection("projects").insertOne({
      userId: new ObjectId(user.id),
      name: body.name,
      description: body.description,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await audit({ userId: user.id, action: "project.created", entityType: "project", entityId: res.insertedId, newValue: { name: body.name }, source: "api" });
    return ok({ id: String(res.insertedId) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
