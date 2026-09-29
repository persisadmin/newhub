import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getCreditBalance, getActiveSubscription, listCreditHistory } from "@/lib/services/credits";
import { isDuitNowConfigured } from "@/lib/services/duitnow";
import { getPayHalalConfig, isPayHalalConfigured } from "@/lib/services/payhalal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const uid = new ObjectId(user.id);
    const [subscription, payments, creditBalance, active, creditHistory] = await Promise.all([
      db.collection("subscriptions").findOne({ userId: uid }),
      db.collection("payments").find({ userId: uid }).sort({ createdAt: -1 }).limit(20).toArray(),
      getCreditBalance(uid),
      getActiveSubscription(uid),
      listCreditHistory(uid, 50),
    ]);
    return ok({
      subscription: subscription ? { ...subscription, _id: String(subscription._id), userId: String(subscription.userId) } : null,
      subscriptionActive: active !== null,
      /** Which checkout methods the server has credentials for. */
      paymentMethods: {
        duitnow_qr: isDuitNowConfigured(),
        payhalal: isPayHalalConfigured(),
      },
      payhalalMode: getPayHalalConfig()?.mode ?? null,
      creditBalance,
      creditHistory: creditHistory.map((c) => ({
        _id: String(c._id), type: c.type, amount: c.amount, reason: c.reason,
        projectId: c.projectId ? String(c.projectId) : null, createdAt: c.createdAt,
        meta: c.meta ?? null,
      })),
      payments: payments.map((p) => ({
        _id: String(p._id), plan: p.plan, interval: p.interval, amount: p.amount, currency: p.currency,
        status: p.status, createdAt: p.createdAt, providerRef: p.providerRef,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
