import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { confirmAndActivate } from "@/lib/services/payment";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/admin/payments — pending payments + recent notification log. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const db = await getDb();
    const [pending, notifications] = await Promise.all([
      db.collection("payments").find({ status: { $in: ["qr_presented", "initiated", "paid_pending_verify"] } }).sort({ createdAt: -1 }).limit(20).toArray(),
      db.collection("payment_notifications").find({}).sort({ createdAt: -1 }).limit(20).toArray(),
    ]);
    const users = await db.collection("users").find({ _id: { $in: pending.map((p) => p.userId) } }, { projection: { email: 1 } }).toArray();
    const emailById = new Map(users.map((u) => [String(u._id), u.email as string]));
    return ok({
      pending: pending.map((p) => ({
        providerRef: p.providerRef, amount: p.amount, plan: p.plan, status: p.status,
        createdAt: p.createdAt, userEmail: emailById.get(String(p.userId)) ?? "?",
      })),
      notifications: notifications.map((n) => ({
        _id: String(n._id), text: n.text, amountsSen: n.amountsSen, matched: n.matched, createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const confirmSchema = z.object({ providerRef: z.string().min(4) });

/** POST /api/admin/payments — manual fallback: mark a payment as received. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { providerRef } = confirmSchema.parse(await req.json());
    const res = await confirmAndActivate(providerRef);
    if (!res.ok) return fail(`Cannot confirm payment (${res.reason}).`, 409, "NOT_CONFIRMABLE");
    await audit({
      userId: new ObjectId(user.id),
      action: "admin.payment_confirmed",
      entityType: "payment",
      entityId: providerRef,
      source: "admin",
    });
    return ok({ confirmed: true });
  } catch (err) {
    return handleError(err);
  }
}
