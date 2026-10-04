import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { DEFAULT_VARIANT_SLUG } from "@/components/landing/registry";

/**
 * Which landing variant is currently live.
 *
 * Stored in the `settings` collection (id "landing") — the same runtime-editable
 * pattern as the LLM chain, promo and billing settings. Only a slug is kept
 * here; resolving a slug to a component is the registry's job, so this service
 * stays free of UI imports.
 */

export interface SocialLinks {
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  instagram?: string;
}

export interface LandingSettings {
  activeVariant: string;
  /** Social profile URLs shown as icons in the landing footer. Empty = hidden. */
  socials?: SocialLinks;
  updatedAt?: Date;
  updatedBy?: ObjectId;
}

const SETTINGS_ID = "landing";
const CACHE_TTL_MS = 30_000;

const SOCIAL_KEYS = ["facebook", "youtube", "tiktok", "instagram"] as const;

/** Keep only valid http(s) URLs for the four known networks. */
export function sanitiseSocials(input: unknown): SocialLinks {
  const out: SocialLinks = {};
  if (!input || typeof input !== "object") return out;
  for (const key of SOCIAL_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") out[key] = u.toString();
    } catch { /* not a URL — drop it */ }
  }
  return out;
}

let cache: { value: LandingSettings; loadedAt: number } | null = null;

/**
 * Read the active variant + socials. Never throws: the marketing page must
 * render even if the database is unreachable, so failures fall back to the
 * default variant and are not cached.
 */
export async function getLandingSettings(): Promise<LandingSettings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;

  const fallback: LandingSettings = { activeVariant: DEFAULT_VARIANT_SLUG, socials: {} };
  try {
    const db = await getDb();
    const doc = await db.collection("settings").findOne({ _id: SETTINGS_ID as never });
    if (!doc) return fallback;
    const d = doc as unknown as { activeVariant?: unknown; socials?: unknown; updatedAt?: Date; updatedBy?: ObjectId };
    const value: LandingSettings = {
      activeVariant: typeof d.activeVariant === "string" && d.activeVariant ? d.activeVariant : DEFAULT_VARIANT_SLUG,
      socials: sanitiseSocials(d.socials),
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy,
    };
    cache = { value, loadedAt: Date.now() };
    return value;
  } catch (err) {
    logger.warn("landing.settings_read_failed", { error: String(err) });
    return fallback;
  }
}

/**
 * Persist the active variant. Callers (the admin API) validate the slug against
 * the registry first; `resolveVariant` still guards rendering either way.
 */
export async function saveLandingSettings(activeVariant: string, adminId: ObjectId): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { activeVariant, updatedAt: now, updatedBy: adminId } },
    { upsert: true }
  );
  cache = null;
  await audit({
    userId: adminId,
    action: "admin.landing_activated",
    entityType: "settings",
    entityId: SETTINGS_ID,
    newValue: { activeVariant },
    source: "admin",
  });
}

/** Public webhook-free invalidation, used by tests and future schedulers. */
export function invalidateLandingCache(): void {
  cache = null;
}

/** Persist the footer social links (audited). Cleared fields are stored empty. */
export async function saveSocialLinks(input: unknown, adminId: ObjectId): Promise<SocialLinks> {
  const socials = sanitiseSocials(input);
  const db = await getDb();
  const now = new Date();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { socials, updatedAt: now, updatedBy: adminId } },
    { upsert: true }
  );
  cache = null;
  await audit({
    userId: adminId,
    action: "admin.landing_socials_saved",
    entityType: "settings",
    entityId: SETTINGS_ID,
    newValue: socials,
    source: "admin",
  });
  return socials;
}
