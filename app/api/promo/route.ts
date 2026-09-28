import { ok, handleError } from "@/lib/api";
import { getPromo, isPromoActive } from "@/lib/services/promo";

export const dynamic = "force-dynamic";

/** GET /api/promo — public: current launch promo (for the landing banner). */
export async function GET() {
  try {
    const promo = await getPromo();
    if (!isPromoActive(promo)) return ok({ active: false });
    return ok({
      active: true,
      trialDays: promo!.trialDays,
      credits: promo!.credits,
      endsAt: promo!.endsAt,
    });
  } catch (err) {
    return handleError(err);
  }
}
