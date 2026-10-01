import { NextRequest, NextResponse } from "next/server";
import { verifyAndActivate } from "@/lib/services/payment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Browser return from Chip's hosted checkout (success_redirect / failure_redirect).
 *
 * This fires on the happy path but must never be trusted on its own — anyone
 * can hit this URL. We do a best-effort server-side verification
 * (GET /purchases/{id}/) so the common case activates instantly, and the
 * signed success_callback is the authoritative fallback. The settings page
 * then polls /api/payments/verify until the payment settles.
 */
export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref") ?? "";
  const outcome = request.nextUrl.searchParams.get("outcome") ?? "success";
  const base = request.nextUrl.origin;

  if (ref) {
    try {
      await verifyAndActivate(ref);
    } catch (err) {
      logger.warn("chip.return_verify_failed", { ref, error: String(err) });
    }
  }

  const target = new URL("/settings", base);
  target.searchParams.set("payment", "chip");
  if (ref) target.searchParams.set("order", ref);
  if (outcome !== "success") target.searchParams.set("result", outcome);
  return NextResponse.redirect(target, { status: 303 });
}
