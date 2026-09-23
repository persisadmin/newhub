import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import PDFDocument from "pdfkit";
import type { CategorizedBoq } from "@/lib/services/llm/document-generators";

/**
 * File builders for generated tender deliverables.
 * Ported from the legacy document_builder.py: xlsx for tabular documents
 * (BOQ, pricing schedule, checklists, prelims), docx for narrative documents
 * (SOW), pdf for the rest (specs, summary, form of tender, method statement).
 */

export interface BuiltFile {
  filename: string;
  buffer: Buffer;
  contentType: string;
}

function safeName(title: string, maxLen = 40): string {
  const s = (title || "document").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  return s.slice(0, maxLen) || "document";
}

export function makeFilename(prefix: string, projectTitle: string, ext: string): string {
  return `${safeName(prefix)}_${safeName(projectTitle)}.${ext}`;
}

const HEADER_FILL: ExcelJS.FillPattern = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin" } };
  });
}

// ── BOQ xlsx ──────────────────────────────────────────────────────────────

export async function buildBoqXlsx(boq: Record<string, unknown>, projectTitle: string): Promise<BuiltFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PERSIS";
  const ws = wb.addWorksheet("BOQ");
  ws.columns = [
    { header: "Bil", key: "itemNo", width: 12 },
    { header: "Description / Perihal Kerja", key: "description", width: 70 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Quantity / Kuantiti", key: "quantity", width: 14 },
    { header: "Rate (RM)", key: "rate", width: 14 },
    { header: "Amount (RM)", key: "amount", width: 16 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sections = Array.isArray(boq.sections) ? boq.sections : [];
  for (const section of sections as Array<Record<string, unknown>>) {
    const title = [section.section_no, section.section_title].filter(Boolean).join(" — ");
    if (title) {
      const r = ws.addRow({ description: title });
      r.font = { bold: true, size: 12 };
    }
    const items = Array.isArray(section.items) ? (section.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      ws.addRow({
        itemNo: item.item_no ?? "",
        description: item.description ?? "",
        unit: item.unit ?? "",
        quantity: item.quantity ?? "",
        rate: item.rate ?? "",
        amount: item.amount ?? "",
        notes: item.notes ?? "",
      });
    }
  }
  ws.getColumn("description").alignment = { wrapText: true, vertical: "top" };

  const title = String(boq.project_title || projectTitle || "BOQ");
  ws.insertRow(1, [title]);
  ws.mergeCells(1, 1, 1, 7);
  ws.getRow(1).font = { bold: true, size: 14 };

  return {
    filename: makeFilename("BOQ", title, "xlsx"),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── Categorized BOQ xlsx ──────────────────────────────────────────────────

export async function buildCategorizedBoqXlsx(boq: CategorizedBoq, projectTitle: string): Promise<BuiltFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PERSIS";
  const ws = wb.addWorksheet("BOQ");
  ws.columns = [
    { header: "Bil", key: "itemNo", width: 12 },
    { header: "Description / Perihal Kerja", key: "description", width: 70 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  for (const cat of boq.categories ?? []) {
    const r = ws.addRow({ description: cat.category_name ?? "" });
    r.font = { bold: true, size: 12 };
    for (const item of cat.items ?? []) {
      ws.addRow({
        itemNo: item.item_no ?? "",
        description: item.description ?? "",
        unit: item.unit ?? "",
        quantity: item.quantity ?? "",
        notes: item.notes ?? "",
      });
    }
  }

  const title = String(boq.project_title || projectTitle || "BOQ");
  ws.insertRow(1, [title]);
  ws.mergeCells(1, 1, 1, 5);
  ws.getRow(1).font = { bold: true, size: 14 };

  return {
    filename: makeFilename("BOQ", title, "xlsx"),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── Pricing schedule xlsx ─────────────────────────────────────────────────

export async function buildPricingScheduleXlsx(data: Record<string, unknown>, projectTitle: string): Promise<BuiltFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PERSIS";
  const ws = wb.addWorksheet("Jadual Kadar Harga");
  ws.columns = [
    { header: "Bil", key: "itemNo", width: 10 },
    { header: "Perihal Kerja / Description", key: "description", width: 60 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Kuantiti", key: "quantity", width: 12 },
    { header: "Kadar (RM)", key: "rate", width: 14 },
    { header: "Jumlah (RM)", key: "amount", width: 16 },
    { header: "Catatan", key: "remarks", width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sections = Array.isArray(data.sections) ? (data.sections as Array<Record<string, unknown>>) : [];
  for (const section of sections) {
    const title = [section.section_no, section.section_title].filter(Boolean).join(" — ");
    if (title) {
      const r = ws.addRow({ description: title });
      r.font = { bold: true, size: 12 };
    }
    const items = Array.isArray(section.items) ? (section.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      const nama = item.nama_item ?? item.description ?? "";
      const unit = item.unit_ukuran ?? item.unit ?? "";
      const qty = item.kuantiti ?? item.quantity ?? "";
      const rate = item.harga_unit_indikatif ?? item.rate ?? "";
      const amt = item.jumlah_harga_indikatif ?? item.amount ?? "";
      const remarks = [item.remarks, item.spesifikasi, item.jenis_pemenuhan, item.tempoh_penghantaran]
        .filter(Boolean)
        .join(" | ");
      ws.addRow({ itemNo: item.item_no ?? "", description: nama, unit, quantity: qty, rate, amount: amt, remarks });
    }
  }
  ws.getColumn("description").alignment = { wrapText: true, vertical: "top" };

  const title = String(data.schedule_title || "Jadual Kadar Harga");
  ws.insertRow(1, [title]);
  ws.mergeCells(1, 1, 1, 7);
  ws.getRow(1).font = { bold: true, size: 14 };

  return {
    filename: makeFilename("JadualKadarHarga", String(data.project_title || projectTitle || "pricing"), "xlsx"),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── Checklists xlsx (technical & financial share a columnar layout) ───────

export async function buildChecklistXlsx(data: Record<string, unknown>, prefix: string, projectTitle: string): Promise<BuiltFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PERSIS";
  const ws = wb.addWorksheet("Senarai Semak");
  ws.columns = [
    { header: "Bil", key: "no", width: 8 },
    { header: "Kriteria / Item", key: "criteria", width: 55 },
    { header: "Jenis Maklumbalas", key: "resp", width: 18 },
    { header: "Skor Maksimum", key: "maxScore", width: 14 },
    { header: "Skema Skor", key: "scheme", width: 25 },
    { header: "Tindakan Pembekal", key: "action", width: 25 },
    { header: "Dokumen Sokongan", key: "docs", width: 25 },
    { header: "Wajib", key: "wajib", width: 8 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sections = Array.isArray(data.sections) ? (data.sections as Array<Record<string, unknown>>) : [];
  for (const section of sections) {
    const title = [
      section.section_no,
      section.section_title,
      section.wajaran_percent != null ? `(${section.wajaran_percent}%)` : "",
    ]
      .filter(Boolean)
      .join(" — ");
    const r = ws.addRow({ criteria: title });
    r.font = { bold: true, size: 12 };
    const items = Array.isArray(section.items) ? (section.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      ws.addRow({
        no: item.item_no ?? "",
        criteria: item.criteria ?? item.nama_item ?? "",
        resp: item.jenis_maklumbalas ?? item.unit_ukuran ?? "",
        maxScore: item.skor_maksimum ?? "",
        scheme: item.skema_skor ?? "",
        action: item.tindakan_pembekal ?? "",
        docs: item.dokumen_sokongan ?? "",
        wajib: item.wajib != null ? (item.wajib ? "Ya" : "Tidak") : "",
      });
    }
  }
  const extras = Array.isArray(data.elemen_tambahan)
    ? (data.elemen_tambahan as Array<Record<string, unknown>>)
    : Array.isArray(data.elemen_kewangan_lain)
      ? (data.elemen_kewangan_lain as Array<Record<string, unknown>>)
      : [];
  if (extras.length) {
    const r = ws.addRow({ criteria: "ELEMEN TAMBAHAN" });
    r.font = { bold: true, size: 12 };
    for (const e of extras) {
      ws.addRow({
        no: e.item_no ?? "",
        criteria: e.criteria ?? "",
        maxScore: e.skor_maksimum ?? "",
        action: e.tindakan_pembekal ?? "",
      });
    }
  }

  const title = String(data.checklist_title || prefix);
  ws.insertRow(1, [title]);
  ws.mergeCells(1, 1, 1, 8);
  ws.getRow(1).font = { bold: true, size: 14 };

  return {
    filename: makeFilename(prefix, String(data.project_title || projectTitle || "checklist"), "xlsx"),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── Prelims xlsx ──────────────────────────────────────────────────────────

export async function buildPrelimsXlsx(data: Record<string, unknown>, projectTitle: string): Promise<BuiltFile> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PERSIS";
  const ws = wb.addWorksheet("Preliminaries");
  ws.columns = [
    { header: "Bil", key: "itemNo", width: 10 },
    { header: "Perihal", key: "description", width: 65 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Kuantiti", key: "quantity", width: 12 },
    { header: "Catatan", key: "notes", width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));

  const sections = Array.isArray(data.sections) ? (data.sections as Array<Record<string, unknown>>) : [];
  for (const section of sections) {
    const r = ws.addRow({ description: section.section_title ?? "" });
    r.font = { bold: true, size: 12 };
    const items = Array.isArray(section.items) ? (section.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      ws.addRow({
        itemNo: item.item_no ?? "",
        description: item.description ?? "",
        unit: item.unit ?? "",
        quantity: item.quantity ?? "",
        notes: item.notes ?? "",
      });
    }
  }

  const title = `PRELIMINARIES / PERUNTUKAN AM — ${String(data.project_title || projectTitle || "")}`;
  ws.insertRow(1, [title]);
  ws.mergeCells(1, 1, 1, 5);
  ws.getRow(1).font = { bold: true, size: 14 };

  return {
    filename: makeFilename("Preliminaries", String(data.project_title || projectTitle || "prelims"), "xlsx"),
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── SOW docx ──────────────────────────────────────────────────────────────

export async function buildSowDocx(data: Record<string, unknown>, projectTitle: string): Promise<BuiltFile> {
  const children: Paragraph[] = [];
  const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  const p = (text: string, opts: { bullet?: boolean; bold?: boolean } = {}) =>
    new Paragraph({
      children: [new TextRun({ text, bold: opts.bold })],
      ...(opts.bullet ? { bullet: { level: 0 } } : {}),
      spacing: { after: 60 },
    });

  children.push(h(String(data.project_title || data.project_name || projectTitle || "Sequence of Works"), HeadingLevel.TITLE));

  if (Array.isArray(data.phases)) {
    for (const phase of data.phases as Array<Record<string, unknown>>) {
      children.push(h(`${phase.phase_no ?? ""}. ${phase.phase_title ?? ""}`, HeadingLevel.HEADING_1));
      if (phase.duration_weeks != null) children.push(p(`Duration: ${phase.duration_weeks} weeks`));
      for (const w of (phase.works ?? []) as Array<Record<string, unknown>>) {
        children.push(p(String(w.work_item ?? ""), { bold: true }));
        children.push(p(String(w.description ?? "")));
        if (Array.isArray(w.dependencies) && (w.dependencies as unknown[]).length)
          children.push(p(`Depends on: ${(w.dependencies as string[]).join(", ")}`));
      }
    }
  }
  if (Array.isArray(data.inclusions)) {
    children.push(h("Inclusions", HeadingLevel.HEADING_1));
    for (const i of data.inclusions as string[]) children.push(p(String(i), { bullet: true }));
  }
  if (Array.isArray(data.exclusions)) {
    children.push(h("Exclusions", HeadingLevel.HEADING_1));
    for (const i of data.exclusions as string[]) children.push(p(String(i), { bullet: true }));
  }
  if (Array.isArray(data.deliverables)) {
    children.push(h("Deliverables", HeadingLevel.HEADING_1));
    for (const i of data.deliverables as string[]) children.push(p(String(i), { bullet: true }));
  }
  const terms = data.commercial_terms as Record<string, unknown> | undefined;
  if (terms) {
    children.push(h("Commercial Terms", HeadingLevel.HEADING_1));
    for (const [k, v] of Object.entries(terms)) {
      if (Array.isArray(v)) {
        children.push(p(k.replace(/_/g, " "), { bold: true }));
        for (const i of v as string[]) children.push(p(String(i), { bullet: true }));
      } else if (v != null) {
        children.push(p(`${k.replace(/_/g, " ")}: ${v}`));
      }
    }
  }
  if (Array.isArray(data.methods)) {
    for (const m of data.methods as Array<Record<string, unknown>>) {
      children.push(h(String(m.activity ?? ""), HeadingLevel.HEADING_1));
      children.push(p(String(m.description ?? "")));
      for (const key of ["equipment_required", "sequence_of_operations", "quality_control", "safety_notes"] as const) {
        if (Array.isArray(m[key])) {
          children.push(p(key.replace(/_/g, " "), { bold: true }));
          for (const i of m[key] as string[]) children.push(p(String(i), { bullet: true }));
        }
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const title = String(data.project_title || data.project_name || projectTitle || "SOW");
  return {
    filename: makeFilename("SOW", title, "docx"),
    buffer,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

// ── Generic PDF (specs, summary, form of tender, method statement) ────────

export async function buildGenericPdf(
  data: Record<string, unknown>,
  prefix: string,
  titleText: string
): Promise<BuiltFile> {
  return new Promise<BuiltFile>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () =>
      resolve({
        filename: makeFilename(prefix, titleText, "pdf"),
        buffer: Buffer.concat(chunks),
        contentType: "application/pdf",
      })
    );
    doc.on("error", reject);

    const title = String(data.project_title || data.form_title || data.checklist_title || titleText);
    doc.fontSize(18).text(title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666666").text(`Generated by PERSIS — ${new Date().toLocaleDateString("en-MY")}`, { align: "center" });
    doc.fillColor("#000000").moveDown();

    const renderSection = (heading: string, rows: Array<Record<string, unknown>>, cols: Array<[string, string]>) => {
      doc.moveDown(0.5).fontSize(13).text(heading, { underline: true });
      doc.moveDown(0.3).fontSize(9);
      for (const row of rows) {
        const parts = cols.map(([label, key]) => `${label}: ${row[key] ?? ""}`).filter((s) => !s.endsWith(": ") && !s.endsWith(": null"));
        if (parts.length) doc.text(parts.join("   |   "));
      }
      doc.fontSize(10);
    };

    // Specs-style: sections[].specifications[]
    if (Array.isArray(data.sections)) {
      for (const section of data.sections as Array<Record<string, unknown>>) {
        doc.moveDown(0.4).fontSize(13).text(String(section.section_title ?? ""), { underline: true });
        const specs = Array.isArray(section.specifications) ? (section.specifications as Array<Record<string, unknown>>) : [];
        const items = Array.isArray(section.items) ? (section.items as Array<Record<string, unknown>>) : [];
        const fields = Array.isArray(section.fields) ? (section.fields as Array<Record<string, unknown>>) : [];
        if (specs.length) renderSection("", specs, [["Item", "item"], ["Standard", "standard"], ["Description", "description"]]);
        if (items.length) renderSection("", items, [["Bil", "item_no"], ["Description", "description"], ["Unit", "unit"], ["Qty", "quantity"]]);
        if (fields.length) renderSection("", fields, [["Field", "label"], ["Type", "field_type"], ["Required", "required"]]);
      }
    }

    // Simple key/value body for summary-style docs
    const skip = new Set(["sections", "project_title", "form_title", "checklist_title"]);
    for (const [key, value] of Object.entries(data)) {
      if (skip.has(key)) continue;
      if (Array.isArray(value)) {
        if (!(value as unknown[]).length || typeof (value as unknown[])[0] !== "string") continue;
        doc.moveDown(0.3).fontSize(12).text(key.replace(/_/g, " ").toUpperCase(), { underline: true });
        doc.fontSize(10);
        for (const v of value as string[]) doc.text(`• ${v}`);
      } else if (value != null && typeof value === "object") {
        doc.moveDown(0.3).fontSize(12).text(key.replace(/_/g, " ").toUpperCase(), { underline: true });
        doc.fontSize(10);
        for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
          if (v2 == null) continue;
          doc.text(`${k2.replace(/_/g, " ")}: ${Array.isArray(v2) ? (v2 as string[]).join("; ") : String(v2)}`);
        }
      } else if (value != null) {
        doc.fontSize(10).text(`${key.replace(/_/g, " ")}: ${String(value)}`);
      }
    }

    if (data.declaration_text) {
      doc.moveDown().fontSize(12).text("DECLARATION", { underline: true });
      doc.fontSize(10).text(String(data.declaration_text));
    }

    doc.end();
  });
}
