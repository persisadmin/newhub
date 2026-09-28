import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "./db";
import { logger } from "./logger";

export async function audit(entry: {
  userId: ObjectId | string | null;
  action: string;
  entityType: string;
  entityId: ObjectId | string;
  previousValue?: unknown;
  newValue?: unknown;
  source: string;
}): Promise<void> {
  try {
    await ensureIndexes();
    const db = await getDb();
    await db.collection("audit_logs").insertOne({
      userId: entry.userId
        ? typeof entry.userId === "string"
          ? new ObjectId(entry.userId)
          : entry.userId
        : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
      source: entry.source,
      timestamp: new Date(),
    });
  } catch (err) {
    // Audit must never break the primary operation, but it must be visible.
    logger.error("audit.write_failed", { error: String(err), action: entry.action });
  }
}
