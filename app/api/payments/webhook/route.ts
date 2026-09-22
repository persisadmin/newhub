import { ok, fail } from "@/lib/api";
import { getPaymentProvider, markPaymentPaid } from "@/lib/services/payment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Payment gateway webhook — signature verified, then server-side verification flow. */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-signature");
  const provider = getPaymentProvider();
  const event = provider.verifyWebhook(raw, signature);
  if (!event) {
    logger.warn("payment.webhook_rejected", { reason: "bad_signature" });
    return fail("Invalid signature.", 401, "BAD_SIGNATURE");
  }
  if (event.status === "paid") {
    await markPaymentPaid(event.providerRef);
  }
  return ok({ received: true });
}
