import { chat } from "./kimi";
import { parseLlmJsonObject } from "./parse-json";
import {
  ANALYSIS_SYSTEM,
  ANALYSIS_PROMPT,
  GENERATION_SYSTEM,
  BOQ_SYSTEM_ADDITION,
  getBoqTypePrompt,
} from "./prompts";
import { logger } from "@/lib/logger";
import type { ParsedBoqLine } from "@/lib/services/extraction";

export interface BoqSection {
  section_no?: string;
  section_title?: string;
  items?: BoqItem[];
}

export interface BoqItem {
  item_no?: string;
  item_ref?: string;
  description?: string;
  unit?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

export interface BoqResult {
  project_title?: string;
  project_ref?: string | null;
  sections?: BoqSection[];
  summary?: { total_sections?: number; total_items?: number; notes?: string | null };
}

export interface TenderManifest {
  project_title?: string;
  project_ref?: string | null;
  client?: string | null;
  project_type?: string;
  location?: string | null;
  estimated_duration?: string | null;
  procurement_type?: string;
  procurement_method?: string;
  estimated_value?: string | null;
  submission_deadline?: string | null;
  scope_summary?: string;
  work_trades?: string[];
  requires_boq?: boolean;
  required_documents?: Array<{ type?: string; title?: string; priority?: string }>;
  special_requirements?: string[];
  notes?: string | null;
}

const ANALYSIS_DOC_LIMIT = 20_000;
const CHUNK_SIZE = 40_000; // ~13k tokens/chunk — safe output per chunk on K3

/** Phase 1 — read and understand the tender document. */
export async function analyseRequirements(text: string): Promise<TenderManifest> {
  const docText = text.length > ANALYSIS_DOC_LIMIT ? text.slice(0, ANALYSIS_DOC_LIMIT) : text;
  const raw = await chat(
    [
      { role: "system", content: ANALYSIS_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${docText}\n\n---\n\n${ANALYSIS_PROMPT}` },
    ],
    3000,
    "analysis"
  );
  return parseLlmJsonObject(raw) as unknown as TenderManifest;
}

function chunkText(text: string, size = CHUNK_SIZE): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const end = pos + size;
    if (end >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    let split = text.lastIndexOf("\n\n", end);
    if (split === -1 || split <= pos) split = text.lastIndexOf("\n", end);
    if (split === -1 || split <= pos) split = end;
    chunks.push(text.slice(pos, split));
    pos = split; // no overlap — overlap causes item duplication
  }
  return chunks;
}

function buildBoqPrompt(scope: string): string {
  return `${scope}TASK: Generate a complete Bills of Quantity for this tender document.

Read the document and extract ALL work items required to complete this project. Include:
- All Preliminaries and General Requirements
- Every work section and trade (in the same order as the document)
- All materials, labour, and equipment items
- Provisional sums and prime cost items
- Testing, commissioning, and handover items
- External works and site clearance

Return ONLY this JSON:
{
  "project_title": "string",
  "project_ref": "string or null",
  "sections": [
    {
      "section_no": "string",
      "section_title": "string",
      "items": [
        {
          "item_no": "string",
          "description": "string — full detailed description",
          "unit": "string",
          "quantity": number or null,
          "notes": "string or null"
        }
      ]
    }
  ],
  "summary": {
    "total_sections": number,
    "total_items": number,
    "notes": "string or null"
  }
}`;
}

async function extractChunk(chunk: string, part: number, total: number, scope: string, typePrompt: string): Promise<BoqResult> {
  const system = GENERATION_SYSTEM + BOQ_SYSTEM_ADDITION + typePrompt;
  const user =
    total === 1
      ? `TENDER DOCUMENT:\n\n${chunk}\n\n---\n\n${buildBoqPrompt(scope)}`
      : `TENDER DOCUMENT PART ${part} of ${total}:\n\n${chunk}\n\n---\n\n${buildBoqPrompt(scope)}\n\nIMPORTANT: Return ONLY raw JSON starting with {. No \`\`\`json fences. Extract ONLY the items visible in this part.`;

  try {
    const raw = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      total === 1 ? 16000 : 16000,
      `boq-chunk${part}`
    );
    return parseLlmJsonObject(raw) as unknown as BoqResult;
  } catch (err) {
    if (total === 1) throw err;
    logger.warn("boq.chunk_failed_retry", { part, error: String(err) });
    // Retry once with a simpler prompt (mirrors legacy recovery path)
    const raw = await chat(
      [
        {
          role: "system",
          content:
            'You are a quantity surveyor. Return ONLY raw JSON starting with {. Format: {"sections":[{"section_title":"str","items":[{"item_no":"str","description":"str","unit":"str","quantity":null,"notes":null}]}]}. No markdown fences.',
        },
        { role: "user", content: `Extract all BOQ items from this document part:\n\n${chunk.slice(0, 20000)}` },
      ],
      16000,
      `boq-chunk${part}-retry`
    );
    return parseLlmJsonObject(raw) as unknown as BoqResult;
  }
}

function hasItems(boq: BoqResult): boolean {
  return (boq.sections ?? []).some((s) => (s.items ?? []).length > 0);
}

/**
 * Phase 2 — generate the BOQ. Chunked for long documents, merged when needed.
 * Ported from the legacy PERSIS generate_boq().
 */
export async function generateBoq(text: string, manifest: TenderManifest | null): Promise<BoqResult> {
  const scope = manifest
    ? `PROJECT CONTEXT (from requirements analysis):
- Project: ${manifest.project_title || "Unknown"}
- Type: ${manifest.project_type || "Unknown"}
- Scope: ${manifest.scope_summary || ""}
- Work trades: ${(manifest.work_trades || []).join(", ")}

`
    : "";
  const typePrompt = getBoqTypePrompt(manifest as Record<string, unknown> | null);
  const chunks = chunkText(text);
  logger.info("boq.chunks", { count: chunks.length });

  if (chunks.length === 1) {
    const result = await extractChunk(chunks[0], 1, 1, scope, typePrompt);
    if (!hasItems(result)) throw new Error("BOQ extraction returned no items");
    return result;
  }

  const partials: BoqResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await extractChunk(chunks[i], i + 1, chunks.length, scope, typePrompt);
      if (hasItems(result)) partials.push(result);
    } catch (err) {
      logger.warn("boq.chunk_skipped", { part: i + 1, error: String(err) });
    }
  }
  if (partials.length === 0) throw new Error("No BOQ items extracted from any chunk");

  if (partials.length === 1) return partials[0];

  // Merge all partial BOQs
  const mergeInput = partials.map((b, i) => `PART ${i + 1}:\n${JSON.stringify(b)}`).join("\n\n");
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      {
        role: "user",
        content: `${mergeInput}\n\n---\nMerge these BOQ parts into one complete BOQ. Combine all sections. Renumber if needed. Same JSON structure. No explanation.`,
      },
    ],
    16000,
    "boq-merge"
  );
  const merged = parseLlmJsonObject(raw) as unknown as BoqResult;
  if (!hasItems(merged)) throw new Error("Merged BOQ contains no items");
  return merged;
}

/** Sequence of Works / Method Statement generator (legacy generate_sow). */
export async function generateSow(text: string, manifest: TenderManifest | null): Promise<Record<string, unknown>> {
  const scope = manifest
    ? `PROJECT CONTEXT:
- Project: ${manifest.project_title || "Unknown"}
- Type: ${manifest.project_type || "Unknown"}
- Scope: ${manifest.scope_summary || ""}
- Work trades: ${(manifest.work_trades || []).join(", ")}
- Duration: ${manifest.estimated_duration || "Not stated"}

`
    : "";
  const prompt = `${scope}TASK: Generate a detailed Sequence of Works / Method Statement.

Sequence all work activities in practical construction order:
1. Mobilisation and preliminaries
2. Site preparation and earthworks
3. Substructure works
4. Superstructure works (trade by trade)
5. Services and M&E (coordinated with civil)
6. Finishes (wet trades before dry trades)
7. External works
8. Testing, commissioning, and handover

Each work item must be specific and actionable. State dependencies clearly.

Return ONLY this JSON:
{
  "project_title": "string",
  "phases": [
    {
      "phase_no": 1,
      "phase_title": "string",
      "duration_weeks": number or null,
      "works": [
        {
          "order": 1,
          "work_item": "string — specific activity",
          "description": "string — what is involved in this activity",
          "dependencies": ["prior work items this depends on"],
          "notes": "string or null"
        }
      ]
    }
  ],
  "total_duration_weeks": number or null,
  "notes": "string or null"
}`;
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}` },
    ],
    4000,
    "sow"
  );
  return parseLlmJsonObject(raw);
}

/** Technical Specifications generator (legacy generate_specs). */
export async function generateSpecs(text: string, manifest: TenderManifest | null): Promise<Record<string, unknown>> {
  const scope = manifest ? `PROJECT: ${manifest.project_title || ""} | TYPE: ${manifest.project_type || ""}\n\n` : "";
  const prompt = `${scope}TASK: Extract and generate Technical Specifications.

Include all material specifications, workmanship standards, testing requirements, and quality standards referenced in or implied by this document. Reference Malaysian standards (MS), British standards (BS), and other applicable codes.

Return ONLY this JSON:
{
  "project_title": "string",
  "sections": [
    {
      "section_title": "string",
      "specifications": [
        {
          "item": "string",
          "standard": "string or null",
          "description": "string",
          "requirements": ["string"]
        }
      ]
    }
  ],
  "references": ["applicable standards and codes"],
  "notes": "string or null"
}`;
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}` },
    ],
    4000,
    "specs"
  );
  return parseLlmJsonObject(raw);
}

/** Tender Summary generator (legacy generate_summary; reuses the manifest when present). */
export async function generateSummary(text: string, manifest: TenderManifest | null): Promise<Record<string, unknown>> {
  if (manifest) {
    return {
      project_title: manifest.project_title || "",
      project_ref: manifest.project_ref ?? null,
      client: manifest.client ?? null,
      location: manifest.location ?? null,
      project_type: manifest.project_type || "",
      procurement_type: manifest.procurement_type || "",
      scope_of_works: manifest.scope_summary || "",
      work_trades: manifest.work_trades || [],
      key_requirements: manifest.special_requirements || [],
      estimated_duration: manifest.estimated_duration ?? null,
      submission_deadline: manifest.submission_deadline ?? null,
      notes: manifest.notes ?? null,
    };
  }
  const prompt = `TASK: Generate a Tender Summary Report — what a contractor needs to know before deciding to bid.

Return ONLY this JSON:
{
  "project_title": "string",
  "project_ref": "string or null",
  "client": "string or null",
  "location": "string or null",
  "scope_of_works": "string",
  "key_requirements": ["string"],
  "estimated_duration": "string or null",
  "special_conditions": ["string"],
  "submission_requirements": ["string"],
  "notes": "string or null"
}`;
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}` },
    ],
    2000,
    "summary"
  );
  return parseLlmJsonObject(raw);
}

/** Convert a BOQ result into parser-agnostic line items for the pipeline. */
export function boqToParsedLines(boq: BoqResult): ParsedBoqLine[] {
  const lines: ParsedBoqLine[] = [];
  let seq = 0;
  for (const section of boq.sections ?? []) {
    const sectionLabel =
      [section.section_no, section.section_title].filter(Boolean).join(" — ") || undefined;
    for (const item of section.items ?? []) {
      const desc = (item.description ?? "").replace(/\s+/g, " ").trim();
      if (!desc) continue;
      if (/^(total|jumlah|amount|sub-?total)\b/i.test(desc)) continue;
      seq += 1;
      const quantity = typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : null;
      lines.push({
        itemNo: item.item_no || item.item_ref || String(seq),
        description: desc,
        quantity,
        unit: item.unit ?? null,
        ...(sectionLabel ? { section: sectionLabel } : {}),
      });
    }
  }
  return lines;
}
