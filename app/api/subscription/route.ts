import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const [subscription, payments] = await Promise.all([
      db.collection("subscriptions").findOne({ userId: new ObjectId(user.id) }),
      db.collection("payments").find({ userId: new ObjectId(user.id) }).sort({ createdAt: -1 }).limit(20).toArray(),
    ]);
    return ok({
      subscription: subscription ? { ...subscription, _id: String(subscription._id), userId: String(subscription.userId) } : null,
      payments: payments.map((p) => ({
        _id: String(p._id), plan: p.plan, interval: p.interval, amount: p.amount, currency: p.currency,
        status: p.status, createdAt: p.createdAt, providerRef: p.providerRef,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
