import { getDb } from "@/lib/db";
import { ok } from "@/lib/api";
import { startTrialNudgeScheduler } from "@/lib/services/trial-nudges";
import { startSupportSweepScheduler } from "@/lib/support";

export const dynamic = "force-dynamic";

// This route is Node-bundled (it imports mongodb), so it's a reliable place to
// boot the in-process schedulers. Both starters are idempotent, so repeated
// health hits are cheap no-ops after the first.
startTrialNudgeScheduler();
startSupportSweepScheduler();

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
