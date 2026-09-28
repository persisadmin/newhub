import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import { grantCredits } from "@/lib/services/credits";
import type { SubscriptionDoc } from "@/lib/domain/types";

/**
 * Launch promotion. When enabled, every NEW sign-up inside the date window
 * automatically receives a free trial subscription (xx days) plus free
 * credits — no payment required. Stored in settings; toggles at runtime.
 */

export interface PromoSettings {
  enabled: boolean;
  startsAt: Date;
  endsAt: Date;
  trialDays: number;
  credits: number;
}

const SETTINGS_ID = "promo";
const CACHE_TTL_MS = 15_000;

let cache: { value: PromoSettings; loadedAt: number } | null = null;

export async function getPromo(): Promise<PromoSettings | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  const db = await getDb();
  const doc = await db.collection("settings").findOne({ _id: SETTINGS_ID as never });
  const value = doc ? (doc as unknown as PromoSettings) : null;
  cache = { value: value as PromoSettings, loadedAt: Date.now() };
  return value as PromoSettings | null;
}

export async function savePromo(promo: PromoSettings, adminId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { ...promo, updatedAt: new Date() } },
    { upsert: true }
  );
  cache = null;
  await audit({
    userId: adminId,
    action: "admin.promo_updated",
    entityType: "settings",
    entityId: SETTINGS_ID,
    newValue: promo,
    source: "admin",
  });
}

export function isPromoActive(promo: PromoSettings | null): boolean {
  if (!promo?.enabled) return false;
  const now = Date.now();
  return new Date(promo.startsAt).getTime() <= now && now <= new Date(promo.endsAt).getTime();
}

/**
 * Grant the launch promo to a freshly created user: trial subscription +
 * free credits. No-op when the promo is inactive. Called exactly once per
 * user, at account creation.
 */
export async function applySignupPromo(userId: ObjectId, email: string): Promise<boolean> {
  const promo = await getPromo();
  if (!isPromoActive(promo)) return false;
  const p = promo!;
  const db = await getDb();
  const now = new Date();
  const end = new Date(now.getTime() + p.trialDays * 24 * 60 * 60 * 1000);
  await db.collection<SubscriptionDoc>("subscriptions").updateOne(
    { userId },
    {
      $set: {
        plan: "trial", interval: "monthly", status: "active",
        currentPeriodStart: now, currentPeriodEnd: end, updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  if (p.credits > 0) {
    await grantCredits(userId, p.credits, `Launch promo — ${p.credits.toLocaleString()} free credits`);
  }
  await audit({
    userId,
    action: "promo.applied",
    entityType: "user",
    entityId: userId,
    newValue: { email, trialDays: p.trialDays, credits: p.credits },
    source: "promo",
  });
  return true;
}
