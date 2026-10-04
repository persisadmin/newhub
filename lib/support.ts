import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getFile, deleteFile } from "@/lib/storage";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import type { SupportThreadDoc, SupportMessageDoc } from "@/lib/domain/types";

/**
 * Helpline support chat helpers.
 *
 * Support = every admin PLUS any emails listed in the SUPPORT_EMAILS env var
 * (comma-separated). All chat data lives in support_threads / support_messages;
 * retention is 14 days after the thread's last activity via Mongo TTL indexes.
 */

/** Emails of support personnel (admins are resolved separately by role). */
export function supportExtraEmails(): string[] {
  return (getEnv().SUPPORT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when this user may answer the helpline (admin role or listed email). */
export function isSupportUser(user: { email: string; role?: string }): boolean {
  if (user.role === "admin") return true;
  return supportExtraEmails().includes((user.email ?? "").toLowerCase());
}

/** All support inboxes to notify (admin users + SUPPORT_EMAILS). */
export async function supportNotifyEmails(): Promise<string[]> {
  const db = await getDb();
  const admins = await db
    .collection<{ email?: string }>("users")
    .find({ role: "admin" }, { projection: { email: 1 } })
    .toArray();
  const set = new Set<string>(supportExtraEmails());
  for (const a of admins) if (a.email) set.add(a.email.toLowerCase());
  return [...set];
}

/** Get or lazily create the caller's own thread. */
export async function getOrCreateThread(user: { id: string; name?: string; email?: string }): Promise<SupportThreadDoc> {
  const db = await getDb();
  const uid = new ObjectId(user.id);
  const existing = await db.collection<SupportThreadDoc>("support_threads").findOne({ userId: uid });
  if (existing) return existing;
  const now = new Date();
  const doc: Omit<SupportThreadDoc, "_id"> = {
    userId: uid,
    userName: user.name ?? undefined,
    userEmail: user.email ?? undefined,
    createdAt: now,
    lastMessageAt: now,
  };
  const res = await db.collection("support_threads").insertOne(doc as SupportThreadDoc);
  return { ...doc, _id: res.insertedId } as SupportThreadDoc;
}

export interface AppendMessageInput {
  threadId: ObjectId;
  senderRole: "user" | "support";
  senderId: string;
  senderName?: string;
  kind: "text" | "image";
  body?: string;
  imagePath?: string;
  imageContentType?: string;
}

/** Append a message and bump thread activity/read markers. */
export async function appendMessage(input: AppendMessageInput): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db.collection<SupportMessageDoc>("support_messages").insertOne({
    _id: new ObjectId(),
    threadId: input.threadId,
    senderRole: input.senderRole,
    senderId: new ObjectId(input.senderId),
    senderName: input.senderName,
    kind: input.kind,
    body: input.body,
    imagePath: input.imagePath,
    imageContentType: input.imageContentType,
    createdAt: now,
  });
  // Sending a message marks the sender as "read up to now" and bumps activity.
  const readField = input.senderRole === "user" ? "userLastReadAt" : "supportLastReadAt";
  await db.collection("support_threads").updateOne(
    { _id: input.threadId },
    { $set: { lastMessageAt: now, [readField]: now }, $unset: { [input.senderRole === "user" ? "userTypingAt" : "supportTypingAt"]: "" } }
  );
}

/** Email the support team about a user message (throttled per thread). */
export async function maybeNotifySupport(thread: SupportThreadDoc, preview: string): Promise<void> {
  const now = Date.now();
  const last = thread.supportNotifiedAt ? new Date(thread.supportNotifiedAt).getTime() : 0;
  const THROTTLE_MS = 15 * 60 * 1000; // at most one email per thread per 15 min
  if (now - last < THROTTLE_MS) return;
  const recipients = await supportNotifyEmails();
  if (recipients.length === 0) return;
  const db = await getDb();
  await db.collection("support_threads").updateOne({ _id: thread._id }, { $set: { supportNotifiedAt: new Date(now) } });
  const url = `${getEnv().NEXTAUTH_URL}/admin/helpline`;
  const name = thread.userName ?? thread.userEmail ?? "A user";
  await sendEmail({
    to: recipients.join(","),
    subject: `Helpline: new message from ${name}`,
    text: `${name} wrote:\n\n"${preview.slice(0, 300)}"\n\nReply in the Helpline inbox: ${url}`,
    html: `<p><strong>${name}</strong> wrote on the Helpline:</p><blockquote style="border-left:3px solid #ccc;padding-left:8px;color:#444">${preview.slice(0, 300).replace(/</g, "&lt;")}</blockquote><p><a href="${url}">Open the Helpline inbox</a> to reply.</p>`,
  }).catch((err) => logger.warn("helpline.notify_failed", { error: String(err) }));
}

/** Serialize a message for API responses (imagePath -> serving URL). */
export function serializeMessage(m: SupportMessageDoc) {
  return {
    _id: String(m._id),
    threadId: String(m.threadId),
    senderRole: m.senderRole,
    senderName: m.senderName ?? (m.senderRole === "support" ? "Support" : "You"),
    kind: m.kind,
    body: m.body,
    imageUrl: m.imagePath ? `/api/helpline/image/${String(m._id)}` : undefined,
    createdAt: m.createdAt,
  };
}

/** Read a message's stored image (ownership/role checked by caller). */
export async function readMessageImage(messageId: string): Promise<{ buf: Buffer; contentType: string } | null> {
  if (!ObjectId.isValid(messageId)) return null;
  const db = await getDb();
  const msg = await db.collection<SupportMessageDoc>("support_messages").findOne({ _id: new ObjectId(messageId) });
  if (!msg?.imagePath) return null;
  const buf = await getFile(msg.imagePath);
  return { buf, contentType: msg.imageContentType ?? "image/jpeg" };
}

/**
 * Retention sweep for stored images: Mongo TTL removes the DB records, but the
 * image bytes in object storage would linger. Deletes R2/local objects whose
 * message no longer exists (or whose thread was TTL-deleted), and removes
 * orphaned messages whose thread is gone. Safe to run daily.
 */
export async function sweepSupportImages(): Promise<{ messagesRemoved: number; imagesRemoved: number }> {
  const db = await getDb();
  let messagesRemoved = 0;
  let imagesRemoved = 0;

  // 1) Orphaned messages (thread deleted by TTL) — delete their images + records.
  const orphans = db.collection<SupportMessageDoc>("support_messages").find({});
  const staleMessageIds: ObjectId[] = [];
  for await (const m of orphans) {
    const t = await db.collection("support_threads").findOne({ _id: m.threadId }, { projection: { _id: 1 } });
    if (t) continue;
    if (m.imagePath) {
      await deleteFile(m.imagePath);
      imagesRemoved++;
    }
    staleMessageIds.push(m._id);
  }
  if (staleMessageIds.length > 0) {
    const res = await db.collection("support_messages").deleteMany({ _id: { $in: staleMessageIds } });
    messagesRemoved += res.deletedCount;
  }

  // 2) Threads that still exist but are idle past the retention window are
  //    handled by the TTL index itself — nothing to do here.
  logger.info("helpline.sweep", { messagesRemoved, imagesRemoved });
  return { messagesRemoved, imagesRemoved };
}

/* ---------------- scheduler ---------------- */

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Idempotent daily sweep starter, called from the Node-bundled /api/health route. */
export function startSupportSweepScheduler(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepSupportImages().catch((err) => logger.error("helpline.sweep_error", { error: String(err) }));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  const boot = setTimeout(() => {
    sweepSupportImages().catch((err) => logger.error("helpline.sweep_error", { error: String(err) }));
  }, 60_000);
  boot.unref?.();
}
