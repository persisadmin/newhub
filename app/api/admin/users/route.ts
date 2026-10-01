import { ObjectId } from "mongodb";
import { ok, handleError } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { getActiveSubscription } from "@/lib/services/credits";
import type { UserDoc, PaymentDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/**
 * Admin: list every registered user with their account, subscription, credit
 * and activity details. Subscriptions are fetched per-user via the same helper
 * the customer flow uses (so "active" is computed identically); payments and
 * project counts are aggregated in bulk to stay cheap as the user base grows.
 */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const db = await getDb();

    const users = await db
      .collection<UserDoc>("users")
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    // Bulk: latest verified payment + project count per user.
    const [paymentAgg, projectAgg, creditAgg] = await Promise.all([
      db.collection<PaymentDoc>("payments").aggregate([
        { $match: { status: "verified" } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$userId", lastPaymentAt: { $first: "$createdAt" }, totalPaidSen: { $sum: "$amount" }, paymentCount: { $sum: 1 } } },
      ]).toArray(),
      db.collection("projects").aggregate([
        { $group: { _id: "$userId", count: { $sum: 1 } } },
      ]).toArray(),
      db.collection("credit_ledger").aggregate([
        { $group: { _id: "$userId", balance: { $sum: "$amount" } } },
      ]).toArray(),
    ]);
    const payByUser = new Map(paymentAgg.map((p) => [String(p._id), p]));
    const projByUser = new Map(projectAgg.map((p) => [String(p._id), p.count as number]));
    const creditByUser = new Map(creditAgg.map((c) => [String(c._id), c.balance as number]));

    const list = await Promise.all(
      users.map(async (u) => {
        const uid = new ObjectId(String(u._id));
        const sub = await getActiveSubscription(uid).catch(() => null);
        const key = String(u._id);
        const pay = payByUser.get(key);
        return {
          id: key,
          name: u.name,
          email: u.email,
          companyName: u.companyName ?? null,
          phone: u.phone ?? null,
          address: u.address ?? null,
          role: u.role,
          accountType: (u as { passwordHash?: string }).passwordHash ? "password" : "google",
          registeredAt: u.createdAt,
          subscription: sub
            ? { plan: sub.plan, interval: sub.interval, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }
            : null,
          creditBalance: creditByUser.get(key) ?? 0,
          projectCount: projByUser.get(key) ?? 0,
          totalPaidSen: (pay?.totalPaidSen as number) ?? 0,
          paymentCount: (pay?.paymentCount as number) ?? 0,
          lastPaymentAt: (pay?.lastPaymentAt as Date) ?? null,
        };
      })
    );

    return ok({ users: list });
  } catch (err) {
    return handleError(err);
  }
}
