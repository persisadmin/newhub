import { ObjectId } from "mongodb";
import fs from "fs/promises";
import path from "path";
import { getDb, ensureIndexes } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isLlmConfigured, getLlmFeatures } from "@/lib/services/llm/kimi";
import { generateSow, generateSpecs, generateSummary } from "@/lib/services/llm/boq-extractor";
import {
  DOCUMENT_GENERATORS,
  generateCategorizedBoq,
  type GeneratedDocument,
  type TenderManifest,
} from "@/lib/services/llm/document-generators";
import {
  buildBoqXlsx,
  buildCategorizedBoqXlsx,
  buildChecklistXlsx,
  buildGenericPdf,
  buildPrelimsXlsx,
  buildPricingScheduleXlsx,
  buildSowDocx,
  type BuiltFile,
} from "./builders";

export interface GeneratedDocSummary {
  type: string;
  title: string;
  filename: string;
}

const MAX_DOCUMENTS = 8;

function requiredTypesFromManifest(manifest: TenderManifest | null): string[] {
  const types = new Set<string>();
  for (const d of manifest?.required_documents ?? []) {
    if (d.type) types.add(d.type);
  }
  if (manifest?.requires_boq) types.add("boq");
  // Sensible defaults so every processed project yields a usable pack
  types.add("summary");
  types.add("method_statement");
  return [...types].slice(0, MAX_DOCUMENTS);
}

function docTitle(type: string, data: Record<string, unknown>): string {
  const t = data.project_title || data.project_name || data.form_title || data.schedule_title || data.checklist_title;
  const name = String(t || "");
  const labels: Record<string, string> = {
    boq: "Bills of Quantity",
    categorized_boq: "Bills of Quantity (Categorized)",
    sow: "Sequence of Works",
    comprehensive_sow: "Scope of Work (Comprehensive)",
    specs: "Technical Specifications",
    summary: "Tender Summary",
    form_of_tender: "Form of Tender / Borang Sebut Harga",
    pricing_schedule: "Jadual Kadar Harga",
    method_statement: "Method Statement",
    prelims: "Preliminaries",
    technical_checklist: "Senarai Semak Teknikal",
    financial_checklist: "Senarai Semak Kewangan",
  };
  return name ? `${labels[type] ?? type} — ${name}` : (labels[type] ?? type);
}

async function buildFileFor(
  type: string,
  data: Record<string, unknown>,
  projectTitle: string
): Promise<BuiltFile> {
  switch (type) {
    case "boq":
      return buildBoqXlsx(data, projectTitle);
    case "categorized_boq":
      return buildCategorizedBoqXlsx(data as never, projectTitle);
    case "pricing_schedule":
      return buildPricingScheduleXlsx(data, projectTitle);
    case "prelims":
      return buildPrelimsXlsx(data, projectTitle);
    case "technical_checklist":
      return buildChecklistXlsx(data, "SenaraiSemakTeknikal", projectTitle);
    case "financial_checklist":
      return buildChecklistXlsx(data, "SenaraiSemakKewangan", projectTitle);
    case "sow":
    case "comprehensive_sow":
      return buildSowDocx(data, projectTitle);
    case "specs":
      return buildGenericPdf(data, "SpesifikasiTeknikal", "Technical Specifications");
    case "summary":
      return buildGenericPdf(data, "RingkasanTender", "Tender Summary");
    case "form_of_tender":
      return buildGenericPdf(data, "BorangTender", "Form of Tender");
    case "method_statement":
      return buildGenericPdf(data, "KaedahKerja", "Method Statement");
    default:
      return buildGenericPdf(data, type, type);
  }
}

/** Build the BOQ document payload from the project's already-extracted boq_items. */
async function boqFromItems(projectId: ObjectId): Promise<Record<string, unknown>> {
  const db = await getDb();
  const items = await db.collection("boq_items").find({ projectId }).sort({ itemNo: 1 }).toArray();
  const sections = new Map<string, Array<Record<string, unknown>>>();
  for (const item of items) {
    const key = item.section || "Bill of Quantities";
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push({
      item_no: item.itemNo,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      rate: null,
      amount: null,
      notes: null,
    });
  }
  return {
    project_title: "",
    sections: [...sections.entries()].map(([section_title, sitems]) => ({ section_title, items: sitems })),
  };
}

/**
 * Generate all required tender deliverables for a project (post-pricing stage).
 * Sequential to respect provider rate limits. Per-document failures are logged
 * and skipped — never fatal to the pipeline.
 */
export async function generateProjectDocuments(
  userId: ObjectId,
  projectId: ObjectId,
  text: string,
  manifest: TenderManifest | null
): Promise<{ generated: GeneratedDocSummary[]; failed: string[] }> {
    const generated: GeneratedDocSummary[] = [];
  const failed: string[] = [];
  const features = await getLlmFeatures();
  if (!(await isLlmConfigured()) || !features.generateDocs) return { generated, failed };

  const db = await getDb();
  await ensureIndexes();
  const project = await db.collection<{ name?: string }>("projects").findOne({ _id: projectId });
  const projectTitle = project?.name || manifest?.project_title || "project";

  // Fresh pack per processing run
  await db.collection("project_documents").deleteMany({ projectId });
  await fs.rm(path.join("data", "documents", projectId.toString()), { recursive: true, force: true });

  for (const type of requiredTypesFromManifest(manifest)) {
    try {
      let data: Record<string, unknown>;
      if (type === "boq") {
        data = await boqFromItems(projectId);
        if (!((data.sections as unknown[]).length)) continue; // nothing to emit
      } else if (type === "categorized_boq") {
        const cb = await generateCategorizedBoq(text, manifest);
        data = cb as unknown as Record<string, unknown>;
      } else if (type === "sow") {
        data = (await generateSow(text, manifest)) as Record<string, unknown>;
      } else if (type === "specs") {
        data = (await generateSpecs(text, manifest)) as Record<string, unknown>;
      } else if (type === "summary") {
        data = (await generateSummary(text, manifest)) as Record<string, unknown>;
      } else if (DOCUMENT_GENERATORS[type]) {
        data = (await DOCUMENT_GENERATORS[type](text, manifest)) as GeneratedDocument;
      } else {
        continue; // unknown type
      }

      const file = await buildFileFor(type, data, projectTitle);
      const dir = path.join("data", "documents", projectId.toString());
      await fs.mkdir(dir, { recursive: true });
      const storagePath = path.join(dir, `${type}${path.extname(file.filename)}`);
      await fs.writeFile(storagePath, file.buffer);

      const title = docTitle(type, data);
      await db.collection("project_documents").insertOne({
        projectId,
        userId,
        type,
        title,
        filename: file.filename,
        storagePath,
        contentType: file.contentType,
        size: file.buffer.length,
        createdAt: new Date(),
      });
      generated.push({ type, title, filename: file.filename });
      logger.info("doc.generated", { projectId: projectId.toString(), type, bytes: file.buffer.length });
    } catch (err) {
      failed.push(type);
      logger.warn("doc.failed", { projectId: projectId.toString(), type, error: String(err) });
    }
  }
  return { generated, failed };
}
