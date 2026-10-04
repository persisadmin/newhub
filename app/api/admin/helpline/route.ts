import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getDb, ensureIndexes } from "@/lib/db";
import { isSupportUser } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/helpline — the support inbox: every thread with the user's
 * name, last activity, and the unread (for support) count. Support-only
 * (admins + SUPPORT_EMAILS).
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isSupportUser(user)) return fail("Support access required.", 403, "FORBIDDEN");
    await ensureIndexes();
    const db = await getDb();

    const threads = await db
      .collection("support_threads")
      .find({})
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .toArray();

    const items = await Promise.all(
      threads.map(async (t) => {
        const unread = await db.collection("support_messages").countDocuments({
          threadId: t._id,
          senderRole: "user",
          ...(t.supportLastReadAt ? { createdAt: { $gt: t.supportLastReadAt } } : {}),
        });
        const last = await db
          .collection("support_messages")
          .find({ threadId: t._id })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        const lastMsg = last[0];
        return {
          _id: String(t._id),
          userName: t.userName ?? t.userEmail ?? "User",
          userEmail: t.userEmail ?? "",
          lastMessageAt: t.lastMessageAt,
          unread,
          preview: lastMsg ? (lastMsg.kind === "image" ? "[image]" : (lastMsg.body ?? "").slice(0, 80)) : "",
          previewAt: lastMsg?.createdAt ?? t.lastMessageAt,
        };
      })
    );

    const totalUnread = items.reduce((s, i) => s + i.unread, 0);
    return ok({ threads: items, totalUnread });
  } catch (err) {
    return handleError(err);
  }
}
