import { ObjectId } from "mongodb";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getDb, ensureIndexes } from "@/lib/db";
import type { UserDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export interface OnboardingStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
}

/**
 * Getting-started checklist status, derived entirely from real user data so it
 * is always truthful (no separate event tracking). Steps complete automatically
 * as the user actually uses the product.
 */
export async function GET() {
  try {
    const user = await requireUser();
    await ensureIndexes();
    const db = await getDb();
    const uid = new ObjectId(user.id);

    const [userDoc, projectCount, documentCount, completedCount, exportedCount] = await Promise.all([
      db.collection<UserDoc>("users").findOne(
        { _id: uid },
        { projection: { companyName: 1, phone: 1, address: 1, onboardingChecklistDismissedAt: 1 } }
      ),
      db.collection("projects").countDocuments({ userId: uid, archivedAt: { $exists: false } }),
      db.collection("tender_documents").countDocuments({ userId: uid }),
      db.collection("projects").countDocuments({ userId: uid, status: "completed", archivedAt: { $exists: false } }),
      db.collection("audit_logs").countDocuments({ userId: uid, action: "pricing.exported" }),
    ]);

    const profileDone = Boolean(
      userDoc?.companyName?.trim() ||
      userDoc?.phone?.trim() ||
      (userDoc?.address && Object.values(userDoc.address).some((v) => v && String(v).trim()))
    );

    const steps: OnboardingStep[] = [
      { key: "profile", label: "Complete your company profile", href: "/settings", done: profileDone },
      { key: "project", label: "Create your first project", href: "/projects/new", done: projectCount > 0 },
      { key: "upload", label: "Upload a tender document", href: "/projects", done: documentCount > 0 },
      { key: "process", label: "Run AI analysis on a tender", href: "/projects", done: completedCount > 0 },
      { key: "export", label: "Export a priced BOQ", href: "/projects", done: exportedCount > 0 },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    return ok({
      steps,
      doneCount,
      total: steps.length,
      dismissed: Boolean(userDoc?.onboardingChecklistDismissedAt),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Dismiss the checklist permanently. */
export async function POST() {
  try {
    const user = await requireUser();
    const db = await getDb();
    await db.collection("users").updateOne(
      { _id: new ObjectId(user.id) },
      { $set: { onboardingChecklistDismissedAt: new Date(), updatedAt: new Date() } }
    );
    return ok({ dismissed: true });
  } catch (err) {
    return handleError(err);
  }
}
