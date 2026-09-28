import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Maintenance mode. When active, sign-in and registration are disabled for
 * everyone except admins (existing sessions are left alone). Stored in the
 * settings collection so it toggles at runtime with no redeploy.
 */

const SETTINGS_ID = "maintenance";
const CACHE_TTL_MS = 10_000;

let cache: { value: boolean; loadedAt: number } | null = null;

export async function isMaintenanceMode(): Promise<boolean> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;
  const db = await getDb();
  const doc = await db.collection("settings").findOne({ _id: SETTINGS_ID as never });
  const value = Boolean((doc as unknown as { enabled?: boolean } | null)?.enabled);
  cache = { value, loadedAt: Date.now() };
  return value;
}

export async function setMaintenanceMode(enabled: boolean, adminId: ObjectId): Promise<void> {
  const db = await getDb();
  await db.collection("settings").updateOne(
    { _id: SETTINGS_ID as never },
    { $set: { enabled, updatedAt: new Date() } },
    { upsert: true }
  );
  cache = null;
  await audit({
    userId: adminId,
    action: enabled ? "admin.maintenance_enabled" : "admin.maintenance_disabled",
    entityType: "settings",
    entityId: SETTINGS_ID,
    source: "admin",
  });
}
