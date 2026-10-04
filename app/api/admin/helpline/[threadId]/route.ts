import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { getDb, ensureIndexes } from "@/lib/db";
import { putFile } from "@/lib/storage";
import { isSupportUser, appendMessage, serializeMessage } from "@/lib/support";
import type { SupportThreadDoc, SupportMessageDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ threadId: string }> };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
};
const TYPING_FRESH_MS = 30 * 1000;

const sendSchema = z.object({ body: z.string().trim().min(1).max(4000) });

async function requireSupportThread(threadId: string) {
  if (!ObjectId.isValid(threadId)) return { error: fail("Invalid thread id.", 400, "VALIDATION") };
  const db = await getDb();
  const thread = await db.collection<SupportThreadDoc>("support_threads").findOne({ _id: new ObjectId(threadId) });
  if (!thread) return { error: fail("Thread not found.", 404, "NOT_FOUND") };
  return { db, thread };
}

/** GET /api/admin/helpline/[threadId] — messages + user typing state (support only). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!isSupportUser(user)) return fail("Support access required.", 403, "FORBIDDEN");
    await ensureIndexes();
    const { threadId } = await ctx.params;
    const got = await requireSupportThread(threadId);
    if ("error" in got) return got.error;
    const { db, thread } = got;

    const messages = await db
      .collection<SupportMessageDoc>("support_messages")
      .find({ threadId: thread._id })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();

    const userTyping = Boolean(
      thread.userTypingAt && Date.now() - new Date(thread.userTypingAt).getTime() < TYPING_FRESH_MS
    );

    return ok({
      thread: {
        _id: String(thread._id),
        userName: thread.userName ?? thread.userEmail ?? "User",
        userEmail: thread.userEmail ?? "",
        lastMessageAt: thread.lastMessageAt,
      },
      messages: messages.map(serializeMessage),
      userTyping,
      userSeenSupport: Boolean(
        thread.userLastReadAt &&
        messages.length > 0 &&
        thread.userLastReadAt >= (messages[messages.length - 1]?.createdAt ?? new Date(0))
      ),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/admin/helpline/[threadId] — support reply: JSON text or multipart image. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!isSupportUser(user)) return fail("Support access required.", 403, "FORBIDDEN");
    await ensureIndexes();
    const rl = await rateLimit(`helpline:reply:${user.id}`, 60, 60);
    if (!rl.allowed) return fail(`Sending too fast. Retry in ${rl.retryAfterSec}s.`, 429, "RATE_LIMITED");
    const { threadId } = await ctx.params;
    const got = await requireSupportThread(threadId);
    if ("error" in got) return got.error;
    const { thread } = got;

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
        threadId: thread._id, senderRole: "support", senderId: user.id, senderName: user.name,
        kind: "image", body: caption || undefined, imagePath: storagePath, imageContentType: file.type,
      });
      return ok({}, 201);
    }

    const parsed = sendSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return fail("Message cannot be empty.", 400, "VALIDATION");
    await appendMessage({
      threadId: thread._id, senderRole: "support", senderId: user.id, senderName: user.name,
      kind: "text", body: parsed.data.body,
    });
    return ok({}, 201);
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/admin/helpline/[threadId] — { typing } or { read: true } (support only). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!isSupportUser(user)) return fail("Support access required.", 403, "FORBIDDEN");
    const { threadId } = await ctx.params;
    const got = await requireSupportThread(threadId);
    if ("error" in got) return got.error;
    const { db, thread } = got;

    const payload = await req.json().catch(() => ({}));
    if (payload?.read === true) {
      await db.collection("support_threads").updateOne({ _id: thread._id }, { $set: { supportLastReadAt: new Date() } });
      return ok({});
    }
    const parsed = z.object({ typing: z.boolean() }).safeParse(payload);
    if (!parsed.success) return fail("Invalid input.", 400, "VALIDATION");
    await db.collection("support_threads").updateOne(
      { _id: thread._id },
      parsed.data.typing ? { $set: { supportTypingAt: new Date() } } : { $unset: { supportTypingAt: "" } }
    );
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
