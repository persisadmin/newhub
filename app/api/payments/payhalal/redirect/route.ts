import { verifyAndActivate } from "@/lib/services/payment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * "URL after Purchase" — where PayHalal returns the customer's browser.
 *
 * Configure this in merchant.payhalal.my → Developer Tools → Create App.
 *
 * This request is browser-side and therefore spoofable, so it never grants
 * anything on its own: we only attempt a best-effort server-side verification
 * (which asks PayHalal for the authoritative status) and then hand the customer
 * back to Settings. The signed server callback is what normally activates the
 * payment; this exists so the customer lands somewhere sensible.
 */

async function orderIdFrom(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("order_id");
  if (fromQuery) return fromQuery;
  if (req.method !== "POST") return null;
  try {
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { order_id?: string };
      return body.order_id ?? null;
    }
    const form = await req.formData();
    const value = form.get("order_id");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orderId = await orderIdFrom(req);

  if (orderId) {
    try {
      // Safe: activates only if PayHalal itself confirms the transaction.
      const result = await verifyAndActivate(orderId);
      logger.info("payhalal.return_verified", { orderId, ...result });
    } catch (err) {
      logger.warn("payhalal.return_verify_failed", { orderId, error: String(err) });
    }
  }

  const dest = new URL("/settings", url.origin);
  dest.searchParams.set("payment", "payhalal");
  if (orderId) dest.searchParams.set("order", orderId);
  return Response.redirect(dest.toString(), 303);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
