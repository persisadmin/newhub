import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { getDb, ensureIndexes } from "@/lib/db";
import { putFile } from "@/lib/storage";
import {
  getOrCreateThread, appendMessage, maybeNotifySupport, serializeMessage, isSupportUser,
} from "@/lib/support";
import type { SupportMessageDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
};
const TYPING_FRESH_MS = 30 * 1000;

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  kind: z.literal("text").default("text"),
});
const typingSchema = z.object({ typing: z.boolean() });

/**
 * GET /api/helpline — the user's thread: messages, peer typing state, unread
 * count for the shell badge (?badge=1 returns only counts), and whether any
 * support reply exists yet (drives the "attending shortly" indicator).
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const thread = await getOrCreateThread(user);

    const badgeOnly = new URL(req.url).searchParams.get("badge") === "1";
    const unreadForUser = await db.collection("support_messages").countDocuments({
      threadId: thread._id,
      senderRole: "support",
      ...(thread.userLastReadAt ? { createdAt: { $gt: thread.userLastReadAt } } : {}),
    });
    if (badgeOnly) return ok({ unread: unreadForUser });

    const messages = await db
      .collection<SupportMessageDoc>("support_messages")
      .find({ threadId: thread._id })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();

    const supportTyping = Boolean(
      thread.supportTypingAt && Date.now() - new Date(thread.supportTypingAt).getTime() < TYPING_FRESH_MS
    );
    const hasSupportReply = messages.some((m) => m.senderRole === "support");

    return ok({
      threadId: String(thread._id),
      messages: messages.map(serializeMessage),
      unread: unreadForUser,
      supportTyping,
      hasSupportReply,
      supportSeenUser: Boolean(
        thread.supportLastReadAt &&
        messages.length > 0 &&
        thread.supportLastReadAt >= (messages[messages.length - 1]?.createdAt ?? new Date(0))
      ),
      isSupport: isSupportUser(user),
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/helpline — send a message. JSON { body } for text, or multipart
 * form-data with `image` (≤5 MB jpg/png/webp) + optional `caption`.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const rl = await rateLimit(`helpline:send:${user.id}`, 30, 60);
    if (!rl.allowed) return fail(`Sending too fast. Retry in ${rl.retryAfterSec}s.`, 429, "RATE_LIMITED");

    const thread = await getOrCreateThread(user);
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("image");
      const caption = typeof form.get("caption") === "string" ? String(form.get("caption")).slice(0, 500) : undefined;
      if (!(file instanceof File)) return fail("Attach an image to send.", 400, "VALIDATION");
      const ext = ALLOWED_IMAGE_TYPES[file.type];
      if (!ext) return fail("Images must be JPG, PNG or WebP.", 400, "VALIDATION");
      if (file.size > MAX_IMAGE_BYTES) return fail("Images must be under 5 MB.", 400, "VALIDATION");
      const buf = Buffer.from(await file.arrayBuffer());
      const { storagePath } = await putFile(`helpline/${thread._id.toString()}/${new ObjectId().toString()}${ext}`, buf, file.type);
      await appendMessage({
        threadId: thread._id, senderRole: "user", senderId: user.id, senderName: user.name,
        kind: "image", body: caption || undefined, imagePath: storagePath, imageContentType: file.type,
      });
      await maybeNotifySupport(thread, caption ? `[image] ${caption}` : "[image]");
      return ok({}, 201);
    }

    const parsed = sendSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("Message cannot be empty.", 400, "VALIDATION");
    await appendMessage({
      threadId: thread._id, senderRole: "user", senderId: user.id, senderName: user.name,
      kind: "text", body: parsed.data.body,
    });
    await maybeNotifySupport(thread, parsed.data.body);
    return ok({}, 201);
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/helpline — { typing: boolean } to set the typing indicator, or { read: true } to mark read. */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const db = await getDb();
    const thread = await getOrCreateThread(user);
    const payload = await req.json().catch(() => ({}));

    if (payload?.read === true) {
      await db.collection("support_threads").updateOne({ _id: thread._id }, { $set: { userLastReadAt: new Date() } });
      return ok({});
    }
    const parsed = typingSchema.safeParse(payload);
    if (!parsed.success) return fail("Invalid input.", 400, "VALIDATION");
    await db.collection("support_threads").updateOne(
      { _id: thread._id },
      parsed.data.typing ? { $set: { userTypingAt: new Date() } } : { $unset: { userTypingAt: "" } }
    );
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
