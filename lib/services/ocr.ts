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
 */
export async function ocrPdf(buf: Buffer): Promise<string> {
  if (!(await isLlmConfigured())) return "";
  const maxPages = (await getLlmFeatures()).ocrMaxPages;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "persis-ocr-"));
  const pdfPath = path.join(tmpDir, "doc.pdf");
  const prefix = path.join(tmpDir, "page");
  try {
    await fs.writeFile(pdfPath, buf);

    // pdftoppm writes <prefix>-<n>.png (zero-padded). Render up to maxPages.
    await execFileAsync("pdftoppm", ["-png", "-r", "150", "-l", String(maxPages), pdfPath, prefix], {
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
    logger.info("ocr.complete", { pages: files.length, chars: result.length });
    return result;
  } catch (err) {
    logger.error("ocr.failed", { error: String(err) });
    return "";
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
