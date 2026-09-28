import crypto from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { audit } from "@/lib/audit";

const schema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(100)
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export async function POST(req: Request) {
  try {
    const { token, password } = schema.parse(await req.json());
    await ensureIndexes();
    const db = await getDb();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const reset = await db.collection("password_resets").findOne({
      tokenHash, usedAt: { $exists: false }, expiresAt: { $gt: new Date() },
    });
    if (!reset) return fail("This reset link is invalid or has expired.", 400, "INVALID_TOKEN");
    await db.collection("users").updateOne(
      { _id: reset.userId },
      { $set: { passwordHash: await bcrypt.hash(password, 12), updatedAt: new Date() } }
    );
    await db.collection("password_resets").updateOne({ _id: reset._id }, { $set: { usedAt: new Date() } });
    await audit({ userId: reset.userId, action: "user.password_reset", entityType: "user", entityId: reset.userId, source: "auth" });
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
