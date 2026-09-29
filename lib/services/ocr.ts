import { chat, isLlmConfigured, getLlmFeatures } from "@/lib/services/llm/kimi";
import { OCR_TRANSCRIBE_PROMPT } from "@/lib/services/llm/prompts";
import { logger } from "@/lib/logger";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Detect scanned/image-only PDFs: little extractable text per page.
 * Mirrors the legacy system's avg < 100 chars/page heuristic.
 */
export function looksScanned(text: string, pageCount: number): boolean {
  const pages = Math.max(pageCount, 1);
  return text.trim().length / pages < 100;
}

/**
 * OCR a scanned PDF using Kimi K3 vision. Pages are rendered to PNG with
 * poppler's pdftoppm (no native Node dependencies) and transcribed by the
 * model. Ported from the legacy _ocr_pdf(). Limited to KIMI_OCR_MAX_PAGES
 * pages to control cost.
 *
 * Render DPI is adaptive: pdftoppm renders at (pageInches × DPI), so a fixed
 * DPI produces wildly oversized images for large-format pages (the old scan
 * flow built ~27"×15" pages → ~9MP PNGs that choked the vision endpoint). We
 * read the page size with pdfinfo and pick a DPI targeting ~1.5 MP, the
 * vision models' accuracy/latency sweet spot.
 */

/** Long-edge pixel target for OCR renders. ~1568px keeps vision OCR sharp. */
const TARGET_LONG_EDGE_PX = 1568;
const MIN_DPI = 72;
const MAX_DPI = 200;

/** First-page dimensions in inches, via poppler's pdfinfo. Falls back to A4. */
async function pageSizeInches(pdfPath: string): Promise<{ wIn: number; hIn: number }> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { maxBuffer: 1024 * 1024 });
    // "Page size:      595.28 x 841.89 pts (A4)"
    const m = stdout.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
    if (m) return { wIn: parseFloat(m[1]) / 72, hIn: parseFloat(m[2]) / 72 };
  } catch (err) {
    logger.warn("ocr.pdfinfo_failed", { error: String(err) });
  }
  return { wIn: 8.27, hIn: 11.69 };
}

function dpiFor({ wIn, hIn }: { wIn: number; hIn: number }): number {
  const longIn = Math.max(wIn, hIn);
  if (longIn <= 0) return 150;
  const dpi = Math.round(TARGET_LONG_EDGE_PX / longIn);
  return Math.min(MAX_DPI, Math.max(MIN_DPI, dpi));
}

export async function ocrPdf(buf: Buffer): Promise<string> {
  if (!(await isLlmConfigured())) return "";
  const maxPages = (await getLlmFeatures()).ocrMaxPages;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "persis-ocr-"));
  const pdfPath = path.join(tmpDir, "doc.pdf");
  const prefix = path.join(tmpDir, "page");
  try {
    await fs.writeFile(pdfPath, buf);

    const dpi = dpiFor(await pageSizeInches(pdfPath));
    // pdftoppm writes <prefix>-<n>.png (zero-padded). Render up to maxPages.
    await execFileAsync("pdftoppm", ["-png", "-r", String(dpi), "-l", String(maxPages), pdfPath, prefix], {
      maxBuffer: 16 * 1024 * 1024,
    });

    const files = (await fs.readdir(tmpDir))
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();

    const allText: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const img = await fs.readFile(path.join(tmpDir, files[i]));
      const b64 = img.toString("base64");
      try {
        const text = await chat(
          [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
                { type: "text", text: OCR_TRANSCRIBE_PROMPT },
              ],
            },
          ],
          4000,
          `ocr-page${i + 1}`,
          { vision: true }
        );
        if (text) allText.push(`[PAGE ${i + 1}]\n${text}`);
      } catch (err) {
        logger.warn("ocr.page_failed", { page: i + 1, error: String(err) });
      }
    }

    const result = allText.join("\n\n");
    logger.info("ocr.complete", { pages: files.length, chars: result.length, dpi });
    return result;
  } catch (err) {
    logger.error("ocr.failed", { error: String(err) });
    return "";
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
