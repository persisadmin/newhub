import { NextRequest } from "next/server";
import { ok, handleError } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth-helpers";
import { chipSelfTest } from "@/lib/services/chip";

export const dynamic = "force-dynamic";

/**
 * Admin-only Chip In Asia self-test.
 *
 * GET  /api/admin/chip-test              → read-only checks (credentials, method
 *                                          availability on this brand, public key)
 * POST /api/admin/chip-test              → same, plus creates a real RM 10 test
 *                                          purchase to prove checkout works
 *
 * Never returns secret material — only lengths and non-secret identifiers.
 */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    return ok(await chipSelfTest());
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const baseUrl = request.nextUrl.origin; // the URL the admin is browsing
    return ok(await chipSelfTest({ createPurchase: true, baseUrl }));
  } catch (err) {
    return handleError(err);
  }
}
