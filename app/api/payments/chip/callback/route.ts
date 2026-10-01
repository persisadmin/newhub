import { NextRequest } from "next/server";
import { handleChipCallback } from "@/lib/services/payment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function plain(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * CHIP Collect `success_callback` — sent as a POST with the full Purchase
 * object and an `X-Signature` header (base64 RSA-SHA256 over the raw body).
 *
 * We read the body as TEXT because the signature covers the raw bytes — JSON
 * parsing first would destroy byte fidelity. Chip expects a 2xx reply to stop
 * retrying; a non-2xx makes it retry, so we only fail hard when the signature
 * or config is genuinely wrong.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("X-Signature");
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return plain("FAILED", 400);
  }
  try {
    const result = await handleChipCallback(rawBody, signature);
    if (result.outcome === "ok") return plain("OK");
    if (result.outcome === "failed" || result.outcome === "amount_mismatch" || result.outcome === "not_found") {
      logger.warn("chip.callback_negative", { outcome: result.outcome, message: result.message });
      return plain("FAILED");
    }
    // rejected / not_configured → tell Chip this delivery was invalid.
    return plain("FAILED", 401);
  } catch (err) {
    logger.error("chip.callback_error", { error: String(err) });
    return plain("FAILED", 500); // Chip retries
  }
}
