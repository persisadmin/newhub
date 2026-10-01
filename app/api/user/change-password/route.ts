import { z } from "zod";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { UserDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8).max(100)
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

/**
 * Change the signed-in user's password. Requires the current password.
 * OAuth-only accounts (no password set) are rejected — they sign in with Google.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`changepw:${user.id}:${getIp(req)}`, 5, 60_000);
    if (!rl.allowed) return fail("Too many attempts. Try again later.", 429, "RATE_LIMITED");

    const body = schema.parse(await req.json());
    const db = await getDb();
    const doc = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(user.id) });
    if (!doc) return handleError(new Error("User not found"));
    if (!doc.passwordHash) {
      return fail("This account signs in with Google, so there is no password to change.", 400, "OAUTH_ACCOUNT");
    }

    const valid = await bcrypt.compare(body.currentPassword, doc.passwordHash);
    if (!valid) {
      logger.warn("auth.change_password_wrong_current", { userId: user.id });
      return fail("Your current password is incorrect.", 400, "WRONG_PASSWORD");
    }
    if (body.newPassword === body.currentPassword) {
      return fail("New password must be different from the current one.", 400, "SAME_PASSWORD");
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await db.collection<UserDoc>("users").updateOne(
      { _id: new ObjectId(user.id) },
      { $set: { passwordHash, updatedAt: new Date() } }
    );
    await audit({
      userId: new ObjectId(user.id),
      action: "user.password_changed",
      entityType: "user",
      entityId: new ObjectId(user.id),
      newValue: null,
      source: "settings",
    });
    return ok({ changed: true });
  } catch (err) {
    return handleError(err);
  }
}
