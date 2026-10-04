import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { grantCredits, getCreditBalance } from "@/lib/services/credits";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  amount: z.coerce.number().positive("Amount must be positive.").max(10000, "Max 10,000 credits per grant."),
  reason: z.string().trim().min(3, "Give a short reason.").max(200),
});

/**
 * POST /api/admin/users/[id]/credits — grant free credits to a user (testing,
 * support, goodwill). Admin-only, ledgered + audited. No payment is created and
 * no subscription is activated — this is a plain credit grant.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const admin = await requireUser();
    requireRole(admin, "admin");

    const rl = await rateLimit(`admin:grant-credits:${admin.id}`, 30, 3600);
    if (!rl.allowed) return fail(`Too many grants. Retry in ${rl.retryAfterSec}s.`, 429, "RATE_LIMITED");

    const { id } = await ctx.params;
    if (!ObjectId.isValid(id)) return fail("Invalid user id.", 400, "VALIDATION");

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400, "VALIDATION");
    const { amount, reason } = parsed.data;

    const db = await getDb();
    const target = await db.collection<{ _id: ObjectId; email?: string; name?: string }>("users").findOne({ _id: new ObjectId(id) });
    if (!target) return fail("User not found.", 404, "NOT_FOUND");

    await grantCredits(new ObjectId(id), amount, `[admin grant] ${reason}`);
    const balance = await getCreditBalance(new ObjectId(id));

    await audit({
      userId: admin.id,
      action: "admin.credits.granted",
      entityType: "user",
      entityId: id,
      newValue: { targetEmail: target.email, amount, reason, balanceAfter: balance },
      source: "api",
    });

    return ok({ balance, amount });
  } catch (err) {
    return handleError(err);
  }
}
