import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(200),
  password: z.string().min(8).max(100)
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export async function POST(req: Request) {
  try {
    const rl = rateLimit(`register:${getIp(req)}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again later.", 429, "RATE_LIMITED");
    const body = schema.parse(await req.json());
    await ensureIndexes();
    const db = await getDb();
    const email = body.email.toLowerCase();
    const existing = await db.collection("users").findOne({ email });
    if (existing) return fail("An account with this email already exists.", 409, "EMAIL_TAKEN");
    const now = new Date();
    const res = await db.collection("users").insertOne({
      email,
      name: body.name,
      passwordHash: await bcrypt.hash(body.password, 12),
      role: "contractor",
      createdAt: now,
      updatedAt: now,
    });
    await audit({ userId: res.insertedId, action: "user.registered", entityType: "user", entityId: res.insertedId, newValue: { email, via: "credentials" }, source: "auth" });
    return ok({ id: String(res.insertedId) }, 201);
  } catch (err) {
    return handleError(err);
  }
}
