import { chat } from "./kimi";
import { parseLlmJsonObject } from "./parse-json";
import { GENERATION_SYSTEM } from "./prompts";
import type { TenderManifest } from "./boq-extractor";
export type { TenderManifest } from "./boq-extractor";

/** All generator outputs are free-form JSON documents keyed by document type. */
export type GeneratedDocument = Record<string, unknown>;

function scopeLine(manifest: TenderManifest | null): string {
  if (!manifest) return "";
  return `PROJECT: ${manifest.project_title || ""} | REF: ${manifest.project_ref || ""} | CLIENT: ${manifest.client || ""}\n\n`;
}

function tradesLine(manifest: TenderManifest | null): string {
  if (!manifest) return "";
  return `PROJECT: ${manifest.project_title || ""} | SCOPE: ${manifest.scope_summary || ""}\nWORK TRADES: ${(manifest.work_trades || []).join(", ")}\n\n`;
}

async function gen(prompt: string, text: string, maxTokens: number, task: string): Promise<GeneratedDocument> {
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}\n\nIMPORTANT: Return ONLY raw JSON starting with {. No \`\`\`json fences.` },
    ],
    maxTokens,
    task
  );
  return parseLlmJsonObject(raw);
}

export async function generateFormOfTender(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const prompt = `${scopeLine(manifest)}TASK: Extract and structure the Form of Tender / Borang Sebut Harga from this document.

Identify all fields that need to be filled by the tendering contractor including:
- Contractor details fields
- Tender price/amount fields
- Completion period fields
- Declaration and undertaking text
- Signature and witness fields

Return ONLY this JSON:
{
  "form_title": "string",
  "project_title": "string",
  "project_ref": "string or null",
  "client": "string or null",
  "sections": [
    {
      "section_title": "string",
      "fields": [
        {
          "field_name": "string",
          "field_type": "text/number/date/signature/checkbox",
          "label": "string — label as it appears in the form",
          "required": true,
          "value": null,
          "notes": "string or null"
        }
      ]
    }
  ],
  "declaration_text": "string or null",
  "notes": "string or null"
}`;
  return gen(prompt, text, 3000, "form_of_tender");
}

export async function generatePricingSchedule(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const procurementMethod = manifest?.procurement_method || "sebut_harga";
  const tenderCat = (
    (manifest as unknown as { tender_category?: string })?.tender_category ||
    manifest?.project_type ||
    ""
  ).toLowerCase();
  const isService = /\b(service|supply|ict|perkhidmatan|bekalan)\b/.test(tenderCat);

  const methodLabels: Record<string, string> = {
    pembelian_terus: "JADUAL SENARAI PRODUK / PERKHIDMATAN (PEMBELIAN TERUS)",
    sebut_harga: "JADUAL KADAR HARGA SEBUT HARGA",
    tender: "JADUAL KADAR HARGA / BILL OF QUANTITIES TENDER",
  };
  const scheduleLabel = methodLabels[procurementMethod] ?? "JADUAL KADAR HARGA";

  let itemSchema: string;
  let sectionNote: string;
  if (isService || procurementMethod === "pembelian_terus") {
    itemSchema = `{
          "item_no": "string",
          "nama_item": "string — item/service name",
          "spesifikasi": "string — specification details",
          "unit_ukuran": "string — unit of measurement e.g. unit, jam, hari, bulan, orang",
          "jenis_pemenuhan": "one-off or bermasa",
          "kuantiti": number or null,
          "harga_unit_indikatif": null,
          "jumlah_harga_indikatif": null,
          "tempoh_penghantaran": "string or null"
        }`;
    sectionNote =
      "For service items include: unit ukuran, kekerapan, jenis pemenuhan (one-off/bermasa), and tempoh kontrak where applicable per ePerolehan guidelines.";
  } else {
    itemSchema = `{
          "item_no": "string — e.g. 1.1, 1.2",
          "description": "string — full item description in BM or English as per document",
          "unit": "string — m2, m3, m, kg, nos, L.S, H.Pukal, unit",
          "quantity": number or null,
          "rate": null,
          "amount": null,
          "remarks": "string or null"
        }`;
    sectionNote =
      "Extract ALL work items. Use L.S (Lump Sum) or H.Pukal for items without specific quantities. Group by trade/section as per document.";
  }

  const prompt = `TASK: Generate a complete Pricing Schedule / Jadual Kadar Harga for this ${procurementMethod.replace(/_/g, " ")} document.

Schedule Type: ${scheduleLabel}
${sectionNote}

Return ONLY this JSON (no markdown, start with {{):
{
  "schedule_title": "${scheduleLabel}",
  "project_title": "string",
  "project_ref": "string or null",
  "client": "string or null",
  "procurement_method": "${procurementMethod}",
  "currency": "MYR",
  "sections": [
    {
      "section_no": "string",
      "section_title": "string",
      "items": [${itemSchema}],
      "section_subtotal": null
    }
  ],
  "grand_total": null,
  "notes": "string or null",
  "instructions_to_bidder": "string — any pricing instructions found in the document or null"
}

IMPORTANT: Extract ALL items found in the document. Do not summarise or skip items.
Return ONLY raw JSON starting with {. No \`\`\`json fences.`;

  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 20000)}\n\n---\n\n${prompt}` },
    ],
    8000,
    "pricing_schedule"
  );
  return parseLlmJsonObject(raw);
}

export async function generateMethodStatement(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const prompt = `${tradesLine(manifest)}TASK: Generate a Method Statement for this project.

Describe in detail HOW each major work activity will be carried out. Include:
- Plant, equipment, and tools required
- Sequence of operations
- Quality control measures
- Safety considerations
- Key materials and their handling

Return ONLY this JSON:
{
  "project_title": "string",
  "methods": [
    {
      "activity": "string",
      "description": "string — overall description",
      "equipment_required": ["string"],
      "sequence_of_operations": ["string — step by step"],
      "quality_control": ["string"],
      "safety_notes": ["string"],
      "notes": "string or null"
    }
  ],
  "notes": "string or null"
}`;
  return gen(prompt, text, 4000, "method_statement");
}

export async function generatePrelims(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const prompt = `PROJECT: ${manifest?.project_title || ""} | DURATION: ${manifest?.estimated_duration || "Not stated"}\n\nTASK: Generate the Preliminaries section for this tender.

Include all site establishment, management, and general obligation items:
- Site setup and accommodation
- Safety and welfare
- Management and supervision
- Insurance and bonds
- Testing and inspections
- Temporary works
- Site clearance and handover

Return ONLY this JSON:
{
  "project_title": "string",
  "sections": [
    {
      "section_title": "string",
      "items": [
        {
          "item_no": "string",
          "description": "string",
          "unit": "string",
          "quantity": number or null,
          "notes": "string or null"
        }
      ]
    }
  ],
  "notes": "string or null"
}`;
  return gen(prompt, text, 3000, "prelims");
}

export async function generateTechnicalChecklist(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const procurementMethod = manifest?.procurement_method || "sebut_harga";
  const prompt = `TASK: Generate a Senarai Semak Teknikal (Technical Checklist) for this tender document.

Project Type: ${manifest?.project_type || ""}
Scope: ${manifest?.scope_summary || ""}
Work Trades: ${(manifest?.work_trades || []).join(", ")}
Procurement Method: ${procurementMethod}

This checklist will be used by the AGENCY to evaluate contractor submissions per ePerolehan guidelines.
Generate realistic technical evaluation criteria based on the tender scope.

Return ONLY this JSON (no markdown, start with {{):
{
  "checklist_title": "SENARAI SEMAK TEKNIKAL",
  "project_title": "string",
  "project_ref": "string or null",
  "procurement_method": "${procurementMethod}",
  "wajaran_type": "secara_terus or mengikut_keutamaan",
  "markah_lulus_teknikal": 70,
  "sections": [
    {
      "section_no": "string — e.g. A, B, C",
      "section_title": "string — e.g. Spesifikasi Teknikal, Pengalaman Syarikat, Dokumen Sokongan",
      "wajaran_percent": number,
      "items": [
        {
          "item_no": "string — e.g. A1, A2",
          "criteria": "string — specification or requirement to be evaluated",
          "jenis_maklumbalas": "ya_atau_tidak or nilai_digit or teks",
          "jenis_skor": "automatik or pengguna",
          "skor_maksimum": number,
          "skema_skor": "string — e.g. Ya=10, Tidak=0",
          "tindakan_pembekal": "string",
          "dokumen_sokongan": "string or null",
          "wajib": true
        }
      ]
    }
  ],
  "elemen_tambahan": [
    {
      "item_no": "string",
      "criteria": "string — additional criterion e.g. Lesen, Sijil, Pengalaman",
      "mekanisma": "borang_atas_talian or janaan_sistem or ptj_muat_naik or pembekal_muat_naik or sampel or demonstrasi",
      "tindakan_pembekal": "string",
      "perlu_penilaian": true,
      "skor_maksimum": number or null
    }
  ],
  "jumlah_skor_maksimum": number,
  "notes": "string or null"
}

Generate at least 3 sections with 3-5 items each. Base criteria on the actual tender scope.`;
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}` },
    ],
    8000,
    "technical_checklist"
  );
  return parseLlmJsonObject(raw);
}

export async function generateFinancialChecklist(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const procurementMethod = manifest?.procurement_method || "sebut_harga";
  const prompt = `TASK: Generate a Senarai Semak Kewangan (Financial Checklist) for this tender document.

Project Type: ${manifest?.project_type || ""}
Scope: ${manifest?.scope_summary || ""}
Procurement Method: ${procurementMethod}

This checklist is used by the AGENCY to evaluate financial proposals from contractors per ePerolehan guidelines.
It includes indicative prices, scoring, and financial capability criteria.

Return ONLY this JSON (no markdown, start with {{):
{
  "checklist_title": "SENARAI SEMAK KEWANGAN",
  "project_title": "string",
  "project_ref": "string or null",
  "procurement_method": "${procurementMethod}",
  "markah_lulus_kewangan": 70,
  "penilaian_type": "pakej or item",
  "peratus_teknikal": 50,
  "peratus_kewangan": 50,
  "items": [
    {
      "item_no": "string",
      "nama_item": "string",
      "unit_ukuran": "string",
      "kuantiti": number or null,
      "harga_indikatif_unit": number or null,
      "jumlah_harga_indikatif": number or null,
      "varian_percent": 10,
      "skor_bawah_varian": 20,
      "skor_dalam_varian": 40,
      "skor_melebihi_varian": 20,
      "jenis_skor": "automatik or pengguna",
      "skor_maksimum": 40
    }
  ],
  "elemen_kewangan_lain": [
    {
      "item_no": "string",
      "criteria": "string — e.g. Penyata Bank 3 Bulan, Kemudahan Kredit",
      "mekanisma": "borang_atas_talian or pembekal_muat_naik",
      "skor_maksimum": number,
      "peratus": number
    }
  ],
  "jumlah_harga_indikatif_pakej": number or null,
  "varian_pakej_percent": 5,
  "markah_lulus_pakej": 70,
  "jumlah_skor_maksimum": 100,
  "notes": "string or null"
}

Base indicative prices on typical Malaysian market rates for this type of work.`;
  const raw = await chat(
    [
      { role: "system", content: GENERATION_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 18000)}\n\n---\n\n${prompt}` },
    ],
    6000,
    "financial_checklist"
  );
  return parseLlmJsonObject(raw);
}

export const QS_EXPERT_SYSTEM = `You are an expert Quantity Surveyor and Construction Estimator with 20+ years of experience in Malaysian and international construction procurement.

You carefully read tender documents, specifications, and drawings, then extract and organise all project requirements into professional deliverables.

You are thorough, accurate, and precise. You never fabricate items that aren't implied by the document. When quantities aren't explicitly stated, you note "TBD" with a brief rationale rather than guessing.

You handle Bahasa Malaysia and English naturally.

Return ONLY valid JSON. No markdown fences. No \`\`\`json. Start your response with {.`;

export async function generateComprehensiveSow(text: string, manifest: TenderManifest | null): Promise<GeneratedDocument> {
  const ctx = manifest
    ? `PROJECT CONTEXT:
- Project Name: ${manifest.project_title || "Unknown"}
- Location: ${manifest.location || "Not stated"}
- Type/Sector: ${manifest.project_type || "Unknown"}
- Procurement: ${manifest.procurement_type || "Unknown"}

`
    : "";
  const prompt = `${ctx}TASK: Read and analyse this tender document. Produce a comprehensive Scope of Work (SOW) and extract all commercial & compliance terms.

Return ONLY this JSON (start with {{, no markdown):
{
  "project_name": "string",
  "project_location": "string or null",
  "industry_sector": "string — e.g. Commercial Construction, MEP, Civil, IT Services",
  "executive_summary": "string — brief overview of project objectives (3-5 sentences)",
  "inclusions": ["string — detailed list of all work to be executed, materials supplied, and deliverables"],
  "exclusions": ["string — items, works, or services explicitly OUT of the contractor's scope"],
  "deliverables": ["string — required reports, warranties, testing, and handover documentation"],
  "commercial_terms": {
    "submission_deadline": "string or null",
    "project_duration": "string or null",
    "payment_terms": "string or null — payment terms & milestones",
    "liquidated_damages": "string or null",
    "onerous_clauses": ["string — any unusual penalty clauses, severe liability limits, or unusual contract conditions"]
  },
  "notes": "string or null"
}

Be thorough. Extract everything relevant. If a commercial term is not stated, use null.
Return ONLY raw JSON starting with {. No \`\`\`json fences.`;
  const raw = await chat(
    [
      { role: "system", content: QS_EXPERT_SYSTEM },
      { role: "user", content: `TENDER DOCUMENT:\n\n${text.slice(0, 20000)}\n\n---\n\n${prompt}` },
    ],
    8000,
    "comprehensive_sow"
  );
  return parseLlmJsonObject(raw);
}

export interface CategorizedBoqItem {
  item_no?: string;
  description?: string;
  unit?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

export interface CategorizedBoq {
  project_title?: string;
  project_ref?: string | null;
  categories?: Array<{ category_name?: string; items?: CategorizedBoqItem[] }>;
  summary?: { total_categories?: number; total_items?: number; notes?: string | null };
}

export async function generateCategorizedBoq(text: string, manifest: TenderManifest | null): Promise<CategorizedBoq> {
  const scope = manifest
    ? `PROJECT CONTEXT:
- Project: ${manifest.project_title || "Unknown"}
- Type: ${manifest.project_type || "Unknown"}
- Scope: ${manifest.scope_summary || ""}
- Work trades: ${(manifest.work_trades || []).join(", ")}

`
    : "";
  const system = `You are an expert Quantity Surveyor and Construction Estimator with 20+ years of experience in Malaysian construction procurement. You carefully read tender documents and organise all measurable work into priced categories. Return ONLY valid JSON. No markdown fences. Start with {.`;

  const makePrompt = (docPart: string) =>
    `${scope}TASK: Extract ALL measurable work items from this tender document and organise them into standard construction cost categories (e.g. Preliminaries, Earthworks, Concrete Works, Masonry, Finishes, M&E, External Works).

${docPart}

Return ONLY this JSON:
{
  "project_title": "string",
  "project_ref": "string or null",
  "categories": [
    {
      "category_name": "string — e.g. Preliminaries, Earthworks, Concrete Works",
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
  ]
}

Rules:
- Every measurable item in the document must appear in exactly one category
- Unstated quantities: quantity=null (never guess)
- L.S / H.Pukal items: quantity=1, unit="L.S"
Return ONLY raw JSON starting with {. No \`\`\`json fences.`;

  // Chunked extraction with category de-duplication (ported from legacy merge logic)
  const CHUNK = 40_000;
  const chunks: string[] = [];
  if (text.length <= CHUNK) chunks.push(text);
  else {
    let pos = 0;
    while (pos < text.length) {
      const end = pos + CHUNK;
      if (end >= text.length) { chunks.push(text.slice(pos)); break; }
      let split = text.lastIndexOf("\n\n", end);
      if (split <= pos) split = text.lastIndexOf("\n", end);
      if (split <= pos) split = end;
      chunks.push(text.slice(pos, split));
      pos = split;
    }
  }

  const merged: CategorizedBoq = { project_title: "", project_ref: null, categories: [] };
  const seen = new Map<string, { items?: CategorizedBoqItem[] }>();

  for (let i = 0; i < chunks.length; i++) {
    const ctxNote = i > 0 && (merged.categories?.length ?? 0) > 0
      ? `\n\nALREADY EXTRACTED (do not duplicate): ${(merged.categories ?? []).map((c) => c.category_name).filter(Boolean).join(", ")}\n`
      : "";
    try {
      const raw = await chat(
        [
          { role: "system", content: system },
          { role: "user", content: makePrompt(`TENDER DOCUMENT PART ${i + 1} of ${chunks.length}:${ctxNote}\n\n${chunks[i]}`) },
        ],
        16000,
        `categorized_boq-chunk${i + 1}`
      );
      const result = parseLlmJsonObject(raw) as unknown as CategorizedBoq;
      if (!merged.project_title && result.project_title) {
        merged.project_title = result.project_title;
        merged.project_ref = result.project_ref ?? null;
      }
      for (const cat of result.categories ?? []) {
        const key = (cat.category_name || "").trim().toLowerCase();
        const existing = key ? seen.get(key) : undefined;
        if (existing) existing.items?.push(...(cat.items ?? []));
        else {
          if (key) seen.set(key, cat as { items?: CategorizedBoqItem[] });
          merged.categories?.push(cat);
        }
      }
    } catch (err) {
      // Non-fatal: skip failed chunk (mirrors legacy behaviour)
      if (i === 0 && chunks.length === 1) throw err;
    }
  }

  const total = (merged.categories ?? []).reduce((n, c) => n + (c.items?.length ?? 0), 0);
  merged.summary = { total_categories: merged.categories?.length ?? 0, total_items: total, notes: null };
  if (total === 0) throw new Error("No BOQ items extracted from any chunk");
  return merged;
}

/** Registry of the additional document generators (beyond BOQ/SOW/specs/summary). */
export const DOCUMENT_GENERATORS: Record<
  string,
  (text: string, manifest: TenderManifest | null) => Promise<GeneratedDocument>
> = {
  form_of_tender: generateFormOfTender,
  pricing_schedule: generatePricingSchedule,
  method_statement: generateMethodStatement,
  prelims: generatePrelims,
  technical_checklist: generateTechnicalChecklist,
  financial_checklist: generateFinancialChecklist,
  comprehensive_sow: generateComprehensiveSow,
};
