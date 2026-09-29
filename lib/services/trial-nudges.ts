import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { createCoupon } from "@/lib/services/coupons";
import { sendTrialEndingEmail } from "@/lib/email";
import type { SubscriptionDoc } from "@/lib/domain/types";

/**
 * Trial-expiry conversion nudge.
 *
 * An hourly in-process sweep finds trial subscriptions expiring within the
 * next 24 hours whose user hasn't subscribed to a paid package, then:
 *
 *   1. Claims the user atomically (trialNudgeSentAt) — exactly-once, safe
 *      against concurrent runners and repeated sweeps.
 *   2. Creates a single-use, user-scoped coupon (e.g. TRIAL15-A3F9K2) valid
 *      for `couponHours`. It appears in the admin coupon list automatically;
 *      expired coupons are physically removed by the TTL index on endsAt.
 *   3. Emails the user a trial-ending reminder with the code + subscribe link.
 *
 * Discount % and coupon lifetime are admin-configurable (settings collection,
 * id "trial_nudge"); defaults 15% / 24h.
 */

export interface TrialNudgeSettings {
  enabled: boolean;
  discountPct: number;
  couponHours: number;
}

const SETTINGS_ID = "trial_nudge";
const CACHE_TTL_MS = 30_000;
const SYSTEM_ACTOR = new ObjectId("000000000000000000000000");

export const DEFAULT_TRIAL_NUDGE: TrialNudgeSettings = { enabled: true, discountPct: 15, couponHours: 24 };

let cache: { value: TrialNudgeSettings; loadedAt: number } | null = null;

export async function getTrialNudgeSettings(): Promise<TrialNudgeSettings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  const db = await getDb();
  const doc = await db.collection("settings").findOne({ _id: SETTINGS_ID as never });
  const raw = (doc ?? {}) as Partial<TrialNudgeSettings>;
  const value: TrialNudgeSettings = {
    enabled: raw.enabled ?? DEFAULT_TRIAL_NUDGE.enabled,
    discountPct: raw.discountPct ?? DEFAULT_TRIAL_NUDGE.discountPct,
    couponHours: raw.couponHours ?? DEFAULT_TRIAL_NUDGE.couponHours,
  };
  cache = { value, loadedAt: Date.now() };
  return value;
}

export async function saveTrialNudgeSettings(settings: TrialNudgeSettings, adminId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
  cache = null;
  await audit({
    userId: adminId,
    action: "admin.trial_nudge_updated",
    entityType: "settings",
    entityId: SETTINGS_ID,
    newValue: settings,
    source: "admin",
  });
}

type TrialSub = SubscriptionDoc & { trialNudgeSentAt?: Date };

/**
 * One sweep. Returns the number of nudges sent. Exported so a future cron
 * endpoint (or tests) can trigger it on demand.
 */
export async function runTrialNudgeSweep(): Promise<number> {
  const cfg = await getTrialNudgeSettings();
  if (!cfg.enabled) return 0;
  const db = await getDb();
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Trials expiring within 24h. Paid users have plan != "trial", and the
  // claim filter below excludes anyone already nudged.
  const candidates = await db
    .collection<TrialSub>("subscriptions")
    .find({ plan: "trial", status: "active", currentPeriodEnd: { $gt: now, $lte: horizon } })
    .limit(200)
    .toArray();

  let sent = 0;
  for (const sub of candidates) {
    // Exactly-once claim: only the first concurrent writer succeeds.
    const claimed = await db.collection<TrialSub>("subscriptions").findOneAndUpdate(
      { _id: sub._id, trialNudgeSentAt: { $exists: false } },
      { $set: { trialNudgeSentAt: now, updatedAt: now } },
      { returnDocument: "after" }
    );
    if (!claimed) continue;

    try {
      const user = await db.collection("users").findOne({ _id: sub.userId }, { projection: { email: 1, name: 1 } });
      if (!user?.email) continue;

      const couponExpiresAt = new Date(now.getTime() + cfg.couponHours * 60 * 60 * 1000);
      const code = `TRIAL${cfg.discountPct}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      await createCoupon({
        code,
        discountPct: cfg.discountPct,
        startsAt: now,
        endsAt: couponExpiresAt,
        audience: "user",
        userEmail: user.email as string,
        maxUses: 1,
        note: `Auto: trial-expiry nudge for ${user.email}`,
        createdBy: SYSTEM_ACTOR,
      });

      await sendTrialEndingEmail(user.email as string, {
        name: (user.name as string) || "there",
        couponCode: code,
        discountPct: cfg.discountPct,
        couponHours: cfg.couponHours,
        trialEndsAt: new Date(sub.currentPeriodEnd),
        couponExpiresAt,
        subscribeUrl: `${getEnv().NEXTAUTH_URL}/settings`,
      });
      sent++;
      logger.info("trial_nudge.sent", { userId: String(sub.userId), code, couponExpiresAt });
    } catch (err) {
      // Roll back the claim so the next sweep retries this user.
      await db.collection("subscriptions").updateOne(
        { _id: sub._id },
        { $unset: { trialNudgeSentAt: "" }, $set: { updatedAt: new Date() } }
      );
      logger.error("trial_nudge.failed", { userId: String(sub.userId), error: String(err) });
    }
  }
  if (sent > 0) logger.info("trial_nudge.sweep_done", { sent, scanned: candidates.length });
  return sent;
}

/* ---------------- in-process scheduler ---------------- */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
let timer: ReturnType<typeof setInterval> | null = null;

/** Idempotent scheduler start, called from the Node-bundled /api/health route. */
export function startTrialNudgeScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runTrialNudgeSweep().catch((err) => logger.error("trial_nudge.sweep_error", { error: String(err) }));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.(); // never keep the process alive for a background sweep
  // First run shortly after boot (give Mongo a moment to connect).
  const boot = setTimeout(() => {
    runTrialNudgeSweep().catch((err) => logger.error("trial_nudge.sweep_error", { error: String(err) }));
  }, 15_000);
  boot.unref?.();
}
