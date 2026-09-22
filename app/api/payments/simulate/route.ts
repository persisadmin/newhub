import { z } from "zod";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { markPaymentPaid, verifyAndActivate } from "@/lib/services/payment";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.object({ providerRef: z.string().min(4) });

/**
 * Simulates the user scanning the QR and paying with TnG eWallet.
 * Available only while TNG_PROVIDER=mock; real gateways drive status via webhook.
 */
export async function POST(req: Request) {
  try {
    if (getEnv().TNG_PROVIDER !== "mock") {
      return fail("Payment simulation is only available with the mock provider.", 403, "DISABLED");
    }
    const user = await requireUser();
    const { providerRef } = schema.parse(await req.json());
    const db = await getDb();
    const payment = await db.collection("payments").findOne({ providerRef });
    if (!payment || String(payment.userId) !== user.id) return fail("Payment not found.", 404, "NOT_FOUND");
    await markPaymentPaid(providerRef);
    const result = await verifyAndActivate(providerRef);
    // In dev, treat the mock provider as instantly confirmable.
    if (!result.verified) {
      await db.collection("payments").updateOne({ providerRef }, { $set: { status: "paid_pending_verify" } });
      const again = await verifyAndActivate(providerRef);
      return ok(again);
    }
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
