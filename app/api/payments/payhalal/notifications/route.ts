import { handlePayHalalCallback } from "@/lib/services/payment";
import { logger } from "@/lib/logger";
import type { PayHalalCallback } from "@/lib/services/payhalal";

export const dynamic = "force-dynamic";

/**
 * PayHalal server-to-server notification.
 *
 * Configure this URL in merchant.payhalal.my → Developer Tools → Create App as
 * the Callback URL. PayHalal requires the literal response body "OK" to treat a
 * notification as delivered, so this route returns plain text, never JSON.
 *
 * Trust model: the payload is hash-signed with our app secret, the app_id must
 * match, and the amount is cross-checked against our own record before any
 * credits are granted. Activation is idempotent, so retries are safe.
 */

/** PayHalal posts form-encoded data; accept JSON and query strings too. */
async function readPayload(req: Request): Promise<PayHalalCallback> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      return (await req.json()) as PayHalalCallback;
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      return Object.fromEntries(
        [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""])
      ) as PayHalalCallback;
    }
  } catch {
    // fall through to the text-based parsers below
  }

  const text = await req.text();
  if (text && text.trim().startsWith("{")) {
    try {
      return JSON.parse(text) as PayHalalCallback;
    } catch {
      // not JSON after all — try urlencoded
    }
  }
  const params = text ? new URLSearchParams(text) : new URL(req.url).searchParams;
  return Object.fromEntries(params) as PayHalalCallback;
}

function plain(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

async function handle(req: Request): Promise<Response> {
  let data: PayHalalCallback;
  try {
    data = await readPayload(req);
  } catch (err) {
    logger.warn("payhalal.callback_unreadable", { error: String(err) });
    return plain("FAILED", 400);
  }

  try {
    const { outcome, message } = await handlePayHalalCallback(data);
    switch (outcome) {
      case "ok":
        return plain("OK");
      case "failed":
        // A genuine payment failure: acknowledge so PayHalal stops retrying.
        return plain("FAILED");
      case "amount_mismatch":
        // Logged loudly inside the service; do not grant credits.
        logger.error("payhalal.callback_amount_mismatch", { orderId: data.order_id, reported: data.amount });
        return plain("FAILED");
      case "not_found":
        logger.warn("payhalal.callback_unknown_order", { orderId: data.order_id });
        return plain("FAILED");
      case "rejected":
      default:
        // Invalid signature / wrong app: this is not a legitimate PayHalal call.
        logger.warn("payhalal.callback_rejected", { reason: message, orderId: data.order_id });
        return plain("FAILED", 401);
    }
  } catch (err) {
    // Let PayHalal retry: returning non-OK keeps the notification open.
    logger.error("payhalal.callback_error", { error: String(err), orderId: data.order_id });
    return plain("FAILED", 500);
  }
}

export async function POST(req: Request) {
  return handle(req);
}

/** Some gateways fall back to GET; accept it so notifications are never lost. */
export async function GET(req: Request) {
  return handle(req);
}
