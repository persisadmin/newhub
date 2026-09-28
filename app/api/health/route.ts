import { getDb } from "@/lib/db";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "down";
  try {
    await (await getDb()).command({ ping: 1 });
    db = "up";
  } catch {
    db = "down";
  }
  return ok({ status: db === "up" ? "healthy" : "degraded", db, ts: new Date().toISOString() });
}
