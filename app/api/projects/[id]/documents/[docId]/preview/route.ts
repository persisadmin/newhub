import fs from "fs/promises";
import path from "path";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; docId: string }> };

/**
 * Preview a generated tender deliverable inline (ownership enforced).
 *
 * Rendering strategy by file type:
 *   - .xlsx  → parsed server-side with exceljs into a JSON grid; the client
 *              renders it as an HTML table. This is the "output spreadsheet"
 *              preview users asked for.
 *   - .pdf   → not parsed here; the client embeds the download URL in an
 *              <iframe> and the browser renders it natively.
 *   - .docx  → converted to HTML with mammoth for an inline document preview.
 */

export interface XlsxPreviewCell { v: string; bold?: boolean; numFmt?: string }
export interface XlsxPreviewRow { cells: XlsxPreviewCell[]; isHeader?: boolean; isSection?: boolean }
export interface XlsxPreview {
  kind: "xlsx";
  sheetName: string;
  columns: number;
  colWidths: number[];
  rows: XlsxPreviewRow[];
  truncated: boolean;
}

const MAX_PREVIEW_ROWS = 300;

/** Extract a readable grid from the first worksheet of an xlsx buffer. */
async function xlsxToPreview(buf: Buffer): Promise<XlsxPreview> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { kind: "xlsx", sheetName: "Sheet1", columns: 0, colWidths: [], rows: [], truncated: false };

  const colWidths = (ws.columns ?? []).map((c) => (typeof c.width === "number" ? c.width : 12));
  const rows: XlsxPreviewRow[] = [];
  let truncated = false;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= MAX_PREVIEW_ROWS) { truncated = true; return; }
    const cells: XlsxPreviewCell[] = [];
    let anyBold = false;
    let textCells = 0;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const raw = cell.value;
      let v = "";
      if (raw != null) {
        if (typeof raw === "object") {
          // Rich text / formula / hyperlink objects — best-effort to string.
          if ("richText" in (raw as object)) v = (raw as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
          else if ("text" in (raw as object)) v = String((raw as { text: unknown }).text ?? "");
          else if ("result" in (raw as object)) v = String((raw as { result: unknown }).result ?? "");
          else if ("formula" in (raw as object)) v = String((raw as { formula: unknown }).formula ?? "");
          else v = String(raw);
        } else {
          v = String(raw);
        }
      }
      const bold = Boolean(cell.font?.bold);
      if (bold) anyBold = true;
      if (v.trim()) textCells++;
      cells[colNumber - 1] = { v, bold, numFmt: cell.numFmt !== "General" ? cell.numFmt : undefined };
    });
    // Trim trailing empty cells.
    while (cells.length && !cells[cells.length - 1]?.v) cells.pop();
    // Heuristics: a bold row with only 1–2 text cells is a section banner; a
    // bold row near the top with several text cells is the column header.
    const isSection = anyBold && textCells <= 2 && rowNumber > 1;
    const isHeader = anyBold && textCells > 2 && rowNumber <= 3;
    rows.push({ cells, isHeader, isSection });
  });

  return {
    kind: "xlsx",
    sheetName: ws.name,
    columns: Math.max(...rows.map((r) => r.cells.length), 0),
    colWidths,
    rows,
    truncated,
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id, docId } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const db = await getDb();
    const doc = await db.collection<{ storagePath: string; filename: string; contentType: string; title: string }>(
      "project_documents"
    ).findOne({ _id: new (await import("mongodb")).ObjectId(docId), projectId: project._id });
    if (!doc) return fail("Document not found.", 404, "NOT_FOUND");

    const buf = await fs.readFile(doc.storagePath);
    const ext = path.extname(doc.filename).toLowerCase();

    if (ext === ".xlsx") {
      const preview = await xlsxToPreview(buf);
      return ok({ ...preview, title: doc.title, filename: doc.filename });
    }
    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const { value: html } = await mammoth.convertToHtml({ buffer: buf });
      return ok({ kind: "docx", title: doc.title, filename: doc.filename, html });
    }
    if (ext === ".pdf") {
      // Client embeds the download URL in an iframe.
      return ok({ kind: "pdf", title: doc.title, filename: doc.filename });
    }
    return fail("Preview is not available for this file type.", 415, "UNSUPPORTED");
  } catch (err) {
    return handleError(err);
  }
}
