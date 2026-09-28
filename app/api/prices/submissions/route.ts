import { ObjectId } from "mongodb";
import { getEnv } from "@/lib/env";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/auth-helpers";
import { createSubmission, listSubmissions } from "@/lib/services/price-submissions";
import type { PriceSubmissionKind } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
  "text/csv": ".txt",
};

/** GET /api/prices/submissions — own submissions (admins see all). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const kind = new URL(req.url).searchParams.get("kind") as PriceSubmissionKind | null;
    const subs = await listSubmissions(new ObjectId(user.id), user.role === "admin", kind ?? undefined);
    return ok({
      submissions: subs.map((s) => ({
        _id: String(s._id),
        kind: s.kind,
        sourceName: s.sourceName,
        filename: s.filename,
        rowCount: s.rows.length,
        status: s.status,
        userEmail: s.userEmail,
        effectiveDate: s.effectiveDate ?? null,
        committedRows: s.committedRows ?? null,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/prices/submissions — submit a price document.
 * multipart: file, kind ("benchmark" = admin only | "quotation"), sourceName,
 * effectiveDate (optional, benchmark).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`pricesubmit:${user.id}:${getIp(req)}`, 10, 60_000);
    if (!rl.allowed) return fail(`Too many submissions. Retry in ${rl.retryAfterSec}s.`, 429, "RATE_LIMITED");

    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "") as PriceSubmissionKind;
    const sourceName = String(form.get("sourceName") ?? "").trim().slice(0, 120);
    const effectiveRaw = String(form.get("effectiveDate") ?? "").trim();
    const effectiveDate = effectiveRaw ? new Date(effectiveRaw) : undefined;

    if (kind !== "benchmark" && kind !== "quotation") return fail("Invalid submission kind.", 422, "VALIDATION");
    if (kind === "benchmark" && user.role !== "admin") {
      return fail("Only admins can submit agency price lists.", 403, "FORBIDDEN");
    }
    if (sourceName.length < 2) {
      return fail(kind === "benchmark" ? "Agency name is required." : "Supplier name is required.", 422, "VALIDATION");
    }
    if (!(file instanceof File)) return fail("No file uploaded.", 422, "VALIDATION");
    const env = getEnv();
    if (file.size > env.UPLOAD_MAX_BYTES) {
      return fail(`File exceeds the ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)}MB limit.`, 413, "TOO_LARGE");
    }
    const contentType = file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv") ? "text/plain" : file.type;
    if (!ALLOWED_TYPES[contentType] && !ALLOWED_TYPES[file.type]) {
      return fail("Unsupported file type. Upload a PDF, DOCX, TXT or CSV.", 415, "UNSUPPORTED_TYPE");
    }
    if (effectiveDate && isNaN(effectiveDate.getTime())) return fail("Invalid effective date.", 422, "VALIDATION");

    const sub = await createSubmission({
      kind,
      userId: new ObjectId(user.id),
      userEmail: user.email ?? "",
      sourceName,
      effectiveDate,
      filename: file.name,
      buf: Buffer.from(await file.arrayBuffer()),
      contentType: ALLOWED_TYPES[contentType] ? contentType : file.type,
    });
    return ok({ submissionId: String(sub._id), rows: sub.rows.length }, 201);
  } catch (err) {
    if (err instanceof Error && /extract text|priced line items/.test(err.message)) {
      return fail(err.message, 422, "PARSE_FAILED");
    }
    return handleError(err);
  }
}
