import { z } from "zod";
import { getDb } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { verifyAndActivate } from "@/lib/services/payment";

export const dynamic = "force-dynamic";

const schema = z.object({ providerRef: z.string().min(4) });

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { providerRef } = schema.parse(await req.json());
    const db = await getDb();
    const payment = await db.collection("payments").findOne({ providerRef });
    // Ownership check: users can only verify their own payments.
    if (!payment || String(payment.userId) !== user.id) return fail("Payment not found.", 404, "NOT_FOUND");
    const result = await verifyAndActivate(providerRef);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
