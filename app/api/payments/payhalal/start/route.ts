import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { buildPaymentRequest, getPayHalalConfig } from "@/lib/services/payhalal";
import type { PaymentDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/**
 * PayHalal checkout hand-off.
 *
 * PayHalal's V1 `…/pay` endpoint only accepts POST — a GET (e.g. setting
 * window.location to a signed URL) is answered with HTTP 405 "Method not
 * allowed", which is what customers were seeing. So we serve a tiny page that
 * POSTs the signed form on load, with a visible button as a no-JS fallback.
 *
 * The signed params are rebuilt here from the stored payment rather than
 * accepted from the client, so nothing about the charge is client-controlled.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payment</title><meta name="robots" content="noindex"></head>` +
      `<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:36rem;margin:0 auto">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function errorPage(message: string, status = 400): Response {
  return page(
    `<h1 style="font-size:1.1rem">Payment could not be started</h1><p>${escapeHtml(message)}</p>` +
      `<p><a href="/settings">Back to settings</a></p>`,
    status
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");

  try {
    const user = await requireUser();
    const cfg = getPayHalalConfig();
    if (!cfg) return errorPage("PayHalal is not configured on this server.");
    if (!ref) return errorPage("Missing payment reference.");

    const db = await getDb();
    const payment = await db.collection<PaymentDoc>("payments").findOne({ providerRef: ref });
    if (!payment) return errorPage("Payment not found.", 404);
    if (String(payment.userId) !== user.id && user.role !== "admin") {
      return errorPage("This payment belongs to a different account.", 403);
    }
    if (payment.status === "verified") {
      return Response.redirect(new URL("/settings", url.origin).toString(), 303);
    }
    if (payment.status === "expired" || payment.status === "failed") {
      return errorPage("This payment attempt is no longer valid. Please start a new one.");
    }

    const userDoc = await db
      .collection("users")
      .findOne({ _id: payment.userId }, { projection: { email: 1, name: 1 } });

    const { payUrl, params } = buildPaymentRequest(cfg, {
      amountSen: payment.amount,
      productDescription: `PERSIS ${payment.plan} package`,
      orderId: payment.providerRef,
      customerName: (userDoc?.name as string) || "PERSIS Customer",
      customerEmail: (userDoc?.email as string) || "",
      customerPhone: "",
    });

    const inputs = Object.entries(params as unknown as Record<string, string>)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`)
      .join("");

    return page(
      `<p style="text-align:center">Redirecting you to PayHalal&rsquo;s secure payment page…</p>` +
        `<form method="post" action="${escapeHtml(payUrl)}" style="text-align:center">${inputs}` +
        `<button type="submit" style="margin-top:1rem;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">` +
        `Continue to payment</button></form>` +
        `<script>document.forms[0].submit();</script>`
    );
  } catch (err) {
    return errorPage(`Could not start the payment: ${String(err)}`);
  }
}
