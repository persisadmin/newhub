import crypto from "node:crypto";
import { z } from "zod";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError, getIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  try {
    const rl = rateLimit(`forgot:${getIp(req)}`, 5, 60_000);
    if (!rl.allowed) return ok({}); // don't leak rate-limit state either
    const { email } = schema.parse(await req.json());
    await ensureIndexes();
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: email.toLowerCase() });
    // Always return ok to prevent account enumeration.
    if (user?.passwordHash) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await db.collection("password_resets").insertOne({
        userId: user._id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      // In production, email this link. In dev it is logged server-side only.
      console.log(`[persis] Password reset link: /reset-password?token=${token}`);
    }
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
