import { ObjectId } from "mongodb";
import { handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { readMessageImage, isSupportUser } from "@/lib/support";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

/** GET /api/helpline/image/[messageId] — serve a chat image (thread owner or support only). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { messageId } = await ctx.params;
    if (!ObjectId.isValid(messageId)) {
      return Response.json({ ok: false, error: { code: "VALIDATION", message: "Invalid id." } }, { status: 400 });
    }
    // Authorisation: the requester must own the thread the image belongs to, or be support.
    const db = await getDb();
    const msg = await db.collection("support_messages").findOne(
      { _id: new ObjectId(messageId) },
      { projection: { threadId: 1 } }
    );
    if (!msg) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
    const thread = await db.collection("support_threads").findOne({ _id: msg.threadId }, { projection: { userId: 1 } });
    const isOwner = thread && String(thread.userId) === user.id;
    if (!isOwner && !isSupportUser(user)) {
      return Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Forbidden." } }, { status: 403 });
    }

    const img = await readMessageImage(messageId);
    if (!img) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
    return new Response(new Uint8Array(img.buf), {
      headers: { "Content-Type": img.contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    return handleError(err);
  }
}
