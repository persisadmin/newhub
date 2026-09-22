import fs from "node:fs/promises";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import type { PipelineStage, ProjectDoc, ProcessingJobDoc } from "@/lib/domain/types";
import { extractText, extractTenderInfo, parseBoqLines, normaliseItem } from "@/lib/services/extraction";
import { priceProject } from "@/lib/services/pricing-service";

const STAGES: PipelineStage[] = [
  "document_processing",
  "text_extraction",
  "tender_info_extraction",
  "material_extraction",
  "work_extraction",
  "boq_generation",
  "price_matching",
  "pricing_analysis",
  "completed",
];

// In-process job registry. Replace with a durable queue (e.g. BullMQ/Redis) when
// scaling horizontally — the service boundary stays identical.
const running = new Map<string, { cancelled: boolean }>();

async function setStage(projectId: ObjectId, stage: PipelineStage) {
  const db = await getDb();
  await db.collection<ProjectDoc>("projects").updateOne(
    { _id: projectId },
    { $set: { currentStage: stage, stageUpdatedAt: new Date() } }
  );
}

async function tick(ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
}

export function requestCancel(projectId: string): boolean {
  const job = running.get(projectId);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

export function isRunning(projectId: string): boolean {
  return running.has(projectId);
}

/** Fire-and-forget pipeline execution. Returns immediately. */
export function startProcessing(projectId: string, documentId: string, userId: string, attempt: number): void {
  const pid = new ObjectId(projectId);
  const did = new ObjectId(documentId);
  const uid = new ObjectId(userId);
  running.set(projectId, { cancelled: false });
  runPipeline(pid, did, uid, attempt)
    .catch(async (err) => {
      logger.error("pipeline.failed", { projectId, error: String(err) });
      const db = await getDb();
      await db.collection<ProjectDoc>("projects").updateOne(
        { _id: pid },
        { $set: { status: "draft", currentStage: undefined, processingError: "Processing failed. Please try again." } }
      );
      await db.collection<ProcessingJobDoc>("processing_jobs").updateOne(
        { projectId: pid, attempt },
        { $set: { status: "failed", error: "Processing failed", finishedAt: new Date() } }
      );
    })
    .finally(() => running.delete(projectId));
}

async function checkCancelled(projectId: string): Promise<void> {
  if (running.get(projectId)?.cancelled) throw new Error("cancelled");
  await tick();
}

async function runPipeline(pid: ObjectId, did: ObjectId, uid: ObjectId, attempt: number): Promise<void> {
  await ensureIndexes();
  const db = await getDb();
  const key = String(pid);

  try {
    await db.collection<ProjectDoc>("projects").updateOne(
      { _id: pid },
      { $set: { status: "processing", processingError: undefined, updatedAt: new Date() } }
    );

    // Stage 1: document processing
    await setStage(pid, "document_processing");
    await checkCancelled(key);
    const doc = await db.collection("tender_documents").findOne({ _id: did, projectId: pid });
    if (!doc) throw new Error("document not found");
    const buf = await fs.readFile(doc.storagePath);

    // Stage 2: text extraction
    await setStage(pid, "text_extraction");
    await checkCancelled(key);
    const text = await extractText(buf, doc.contentType, doc.filename);

    // Stage 3: tender information extraction
    await setStage(pid, "tender_info_extraction");
    await checkCancelled(key);
    const info = extractTenderInfo(text);
    await db.collection("tender_extractions").insertOne({
      projectId: pid,
      attempt,
      ...info,
      rawTextLength: text.length,
      extractedAt: new Date(),
    });
    await db.collection<ProjectDoc>("projects").updateOne(
      { _id: pid },
      {
        $set: {
          tenderTitle: info.title,
          tenderNumber: info.tenderNumber,
          tenderAgency: info.agency,
          tenderCategory: info.category,
          closingDate: info.closingDate,
        },
      }
    );

    // Stage 4/5: material & work extraction
    await setStage(pid, "material_extraction");
    await checkCancelled(key);
    const lines = parseBoqLines(text);
    await setStage(pid, "work_extraction");
    await checkCancelled(key);
    const normalised = lines.map(normaliseItem);

    // Stage 6: BOQ generation
    await setStage(pid, "boq_generation");
    await checkCancelled(key);
    await db.collection("boq_items").deleteMany({ projectId: pid });
    if (normalised.length) {
      await db.collection("boq_items").insertMany(
        normalised.map((n) => ({ ...n, projectId: pid, createdAt: new Date() }))
      );
    }

    // Stage 7/8: price matching + pricing analysis
    await setStage(pid, "price_matching");
    await checkCancelled(key);
    await setStage(pid, "pricing_analysis");
    const { priced, flagged } = await priceProject(uid, pid);

    // Done
    await setStage(pid, "completed");
    await db.collection<ProjectDoc>("projects").updateOne(
      { _id: pid },
      { $set: { status: flagged > 0 ? "awaiting_review" : "completed", updatedAt: new Date() } }
    );
    await db.collection<ProcessingJobDoc>("processing_jobs").updateOne(
      { projectId: pid, attempt },
      { $set: { status: "completed", stage: "completed", finishedAt: new Date() } }
    );
    await audit({
      userId: uid,
      action: "tender.processed",
      entityType: "project",
      entityId: pid,
      newValue: { attempt, itemsExtracted: normalised.length, priced, flagged },
      source: "pipeline",
    });
  } catch (err) {
    if (String(err).includes("cancelled")) {
      await db.collection<ProjectDoc>("projects").updateOne(
        { _id: pid },
        { $set: { status: "draft", currentStage: undefined } }
      );
      await db.collection<ProcessingJobDoc>("processing_jobs").updateOne(
        { projectId: pid, attempt },
        { $set: { status: "cancelled", finishedAt: new Date() } }
      );
      await audit({
        userId: uid,
        action: "tender.processing_cancelled",
        entityType: "project",
        entityId: pid,
        source: "pipeline",
      });
      return;
    }
    throw err;
  }
}
