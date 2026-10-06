import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";
import { startProcessing, requestCancel, isRunning } from "@/lib/services/processing/runner";
import {
  estimateProcessingCost, deductCredits, getCreditBalance,
  hasActiveSubscription, InsufficientCreditsError,
} from "@/lib/services/credits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const startSchema = z.object({ documentId: z.string(), deriveBoq: z.boolean().optional() });

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireOwnedProject(id, user);
    if (isRunning(id)) return fail("Processing is already running for this project.", 409, "BUSY");
    const { documentId, deriveBoq } = startSchema.parse(await req.json());
    if (!ObjectId.isValid(documentId)) return fail("Invalid document.", 422, "VALIDATION");
    await ensureIndexes();
    const db = await getDb();
    const doc = await db.collection("tender_documents").findOne({ _id: new ObjectId(documentId), projectId: new ObjectId(id) });
    if (!doc) return fail("Document not found in this project.", 404, "NOT_FOUND");
    const last = await db.collection("processing_jobs").findOne({ projectId: new ObjectId(id) }, { sort: { attempt: -1 } });
    const attempt = (last?.attempt ?? 0) + 1;

    // --- Credit gate (server-side; admins bypass for testing) ---
    let charged: { credits: number; balanceAfter: number } | null = null;
    if (user.role !== "admin") {
      if (!(await hasActiveSubscription(new ObjectId(user.id)))) {
        return fail("An active subscription is required to process tenders. Choose a credit package in Settings.", 402, "SUBSCRIPTION_REQUIRED");
      }
      const estimate = await estimateProcessingCost({
        sizeBytes: doc.sizeBytes as number,
        contentType: (doc.contentType as string) ?? "",
        filename: doc.filename as string,
      });
      const project = await db.collection("projects").findOne({ _id: new ObjectId(id) });
      const freeRetry = Boolean(last && last.status === "failed" && !project?.freeRetryUsed);
      if (freeRetry) {
        // One free retry per project after a failed attempt — no deduction.
        await db.collection("projects").updateOne({ _id: new ObjectId(id) }, { $set: { freeRetryUsed: true, updatedAt: new Date() } });
      } else {
        const balance = await getCreditBalance(new ObjectId(user.id));
        if (balance + 1e-9 < estimate.credits) {
          return fail(
            `Insufficient credits: this tender costs ~${estimate.credits} credits, your balance is ${balance}. Top up in Settings.`,
            402,
            "INSUFFICIENT_CREDITS"
          );
        }
        try {
          const balanceAfter = await deductCredits(new ObjectId(user.id), estimate.credits, `Tender processing — ${doc.filename}`, {
            projectId: new ObjectId(id),
            attempt,
            meta: {
              estimatedTokensIn: estimate.estimatedTokensIn,
              estimatedTokensOut: estimate.estimatedTokensOut,
              costUsd: estimate.costUsd,
              usdToMyr: estimate.usdToMyr,
              multiplier: estimate.multiplier,
              provider: estimate.provider,
              model: estimate.model,
              documentId,
            },
          });
          charged = { credits: estimate.credits, balanceAfter };
        } catch (err) {
          if (err instanceof InsufficientCreditsError) {
            return fail(`Insufficient credits: need ${err.needed}, have ${err.balance}. Top up in Settings.`, 402, "INSUFFICIENT_CREDITS");
          }
          throw err;
        }
      }
    }

    await db.collection("processing_jobs").insertOne({
      projectId: new ObjectId(id), userId: new ObjectId(user.id), documentId: new ObjectId(documentId),
      attempt, stage: "document_processing", status: "running", startedAt: new Date(),
    });
    startProcessing(id, documentId, user.id, attempt, { deriveBoq: Boolean(deriveBoq) });
    await audit({ userId: user.id, action: "tender.processing_started", entityType: "project", entityId: id, newValue: { attempt, documentId, charged }, source: "api" });
    return ok({ attempt, charged }, 202);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireOwnedProject(id, user);
    const cancelled = requestCancel(id);
    if (!cancelled) return fail("No running processing job to cancel.", 409, "NOT_RUNNING");
    return ok({ cancelled: true });
  } catch (err) {
    return handleError(err);
  }
}
