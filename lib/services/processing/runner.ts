import fs from "node:fs/promises";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import type { PipelineStage, ProjectDoc, ProcessingJobDoc } from "@/lib/domain/types";
import { extractText, extractTenderInfo, parseBoqLinesWithStats, normaliseItem } from "@/lib/services/extraction";
import type { ParsedBoqLine } from "@/lib/services/extraction";
import { isLlmConfigured, getLlmFeatures } from "@/lib/services/llm/kimi";
import { analyseRequirements, generateBoq, boqToParsedLines } from "@/lib/services/llm/boq-extractor";
import type { TenderManifest } from "@/lib/services/llm/boq-extractor";
import { looksScanned, ocrPdf } from "@/lib/services/ocr";
import { generateProjectDocuments } from "@/lib/services/documents/generation";

function parseDeadline(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
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
        { $set: { status: "draft", currentStage: undefined, processingError: err instanceof Error ? err.message : "Processing failed. Please try again." } }
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
      { $set: { status: "processing", processingError: undefined, processingStartedAt: new Date(), updatedAt: new Date() } }
    );

    // Stage 1: document processing
    await setStage(pid, "document_processing");
    await checkCancelled(key);
    const doc = await db.collection("tender_documents").findOne({ _id: did, projectId: pid });
    if (!doc) throw new Error("document not found");
    const buf = await fs.readFile(doc.storagePath);

    // Stage 2: text extraction (+ OCR for scanned PDFs when Kimi is configured)
    await setStage(pid, "text_extraction");
    await checkCancelled(key);
    const extracted = await extractText(buf, doc.contentType, doc.filename);
    let text = extracted.text;
    let ocrUsed = false;

    if (looksScanned(text, extracted.pageCount ?? 1)) {
      if (await isLlmConfigured()) {
        logger.info("doc.scanned_ocr", { projectId: pid.toString(), pages: extracted.pageCount });
        const ocrText = await ocrPdf(buf);
        if (ocrText.trim().length > text.trim().length) {
          text = ocrText;
          ocrUsed = true;
        }
      } else {
        logger.warn("doc.scanned_no_ocr", { projectId: pid.toString() });
      }
    }
    // Stage 3: tender information extraction (regex first; LLM manifest enriches below)
    await setStage(pid, "tender_info_extraction");
    await checkCancelled(key);
    const info = extractTenderInfo(text);
    await db.collection("tender_extractions").insertOne({
      projectId: pid,
      attempt,
      ...info,
      rawTextLength: text.length,
      ocrUsed,
      extractedAt: new Date(),
    });

    if (text.trim().length < 200) {
      throw new Error(
        "Document appears to be scanned/image-only (no extractable text). " +
          "Please re-upload a text-based PDF or Word document, or configure KIMI_API_KEY to enable OCR."
      );
    }

    // Stage 4/5: material & work extraction — LLM (Kimi) primary, regex fallback
    await setStage(pid, "material_extraction");
    await checkCancelled(key);
    let lines: ParsedBoqLine[] = [];
    let extractionMethod: "llm" | "regex" | null = null;
    let manifest: TenderManifest | null = null;

    if (await isLlmConfigured()) {
      try {
        manifest = await analyseRequirements(text);
        const boq = await generateBoq(text, manifest);
        lines = boqToParsedLines(boq);
        extractionMethod = "llm";
        logger.info("boq.llm_extracted", { projectId: pid.toString(), items: lines.length });
      } catch (err) {
        logger.warn("boq.llm_failed_fallback_regex", { projectId: pid.toString(), error: String(err) });
      }
    }

    if (extractionMethod === null) {
      const { items, stats } = parseBoqLinesWithStats(text);
      lines = items;
      extractionMethod = "regex";
      logger.info("boq.parse_stats", { projectId: pid.toString(), ...stats, itemsFound: items.length });
    }

    await db.collection("tender_extractions").updateOne(
      { projectId: pid, attempt },
      {
        $set: {
          itemsParsed: lines.length,
          extractionMethod,
          ...(manifest ? { manifest } : {}),
        },
      }
    );

    // Enrich project with LLM manifest (falls back to regex info)
    await db.collection<ProjectDoc>("projects").updateOne(
      { _id: pid },
      {
        $set: {
          tenderTitle: manifest?.project_title ?? info.title,
          tenderNumber: manifest?.project_ref ?? info.tenderNumber,
          tenderAgency: manifest?.client ?? info.agency,
          tenderCategory: manifest?.project_type ?? info.category,
          closingDate: parseDeadline(manifest?.submission_deadline) ?? info.closingDate,
        },
      }
    );

    if (lines.length === 0) {
      throw new Error(
        "No BOQ line items could be extracted from this document. " +
          "It may not contain a measurable works schedule (e.g. a service/supply tender), " +
          "or the layout is unsupported — contact support with a sample for parser tuning."
      );
    }
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

    // Stage 9: veteran-contractor strategy narrative (LLM; non-fatal on failure)
    await setStage(pid, "strategy_narrative");
    await checkCancelled(key);
    if (await isLlmConfigured()) {
      try {
        const { generateStrategyNarrative } = await import("@/lib/services/llm/strategy-narrative");
        const narrative = await generateStrategyNarrative(text, manifest);
        await db.collection<ProjectDoc>("projects").updateOne(
          { _id: pid },
          { $set: { strategyNarrative: narrative, strategyNarrativeAt: new Date() } }
        );
        logger.info("strategy.generated", { projectId: pid.toString(), words: narrative.split(/\s+/).length });
        // Studio-quality audio via Qwen TTS (non-fatal; browser speech remains the fallback)
        try {
          const { synthesizeToFiles } = await import("@/lib/services/tts");
          const parts = await synthesizeToFiles(pid.toString(), narrative);
          await db.collection<ProjectDoc>("projects").updateOne(
            { _id: pid },
            { $set: { strategyAudioParts: parts } }
          );
          logger.info("tts.generated", { projectId: pid.toString(), parts });
        } catch (ttsErr) {
          logger.warn("tts.failed", { projectId: pid.toString(), error: String(ttsErr) });
        }
      } catch (narrErr) {
        logger.warn("strategy.failed", { projectId: pid.toString(), error: String(narrErr) });
      }
    }

    // Stage 10: generate tender deliverable documents (BOQ xlsx, SOW, specs, etc.)
    await setStage(pid, "document_generation");
    await checkCancelled(key);
    const { generated, failed } = await generateProjectDocuments(uid, pid, text, manifest);
    if (generated.length) {
      logger.info("docs.generated", { projectId: pid.toString(), count: generated.length, failed });
    }

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
