import { ok, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { payHalalSelfTest } from "@/lib/services/payhalal";

export const dynamic = "force-dynamic";

/**
 * Admin PayHalal self-test.
 *
 * Opens the payment URL we would send a customer to — server-side — and reports
 * PayHalal's actual response for both hash variants, plus a credential probe
 * against the reconciliation API. No payment is created and nothing is charged,
 * so this is safe to run repeatedly while debugging the live integration.
 *
 * GET so an admin can simply open the URL in a browser tab and read the JSON.
 */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    return ok(await payHalalSelfTest());
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  return GET();
}
