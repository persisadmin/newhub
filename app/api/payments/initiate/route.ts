import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, handleError, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { initiatePayment, PLANS } from "@/lib/services/payment";
import { CouponError } from "@/lib/services/coupons";

export const dynamic = "force-dynamic";

const schema = z.object({
  plan: z.enum(["starter", "professional", "enterprise"]),
  interval: z.enum(["monthly", "yearly"]),
  couponCode: z.string().max(40).optional(),
  /** Checkout method. Defaults to the DuitNow QR flow for back-compat. */
  method: z.enum(["duitnow_qr", "payhalal"]).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`pay:${user.id}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many payment attempts. Try again later.", 429, "RATE_LIMITED");
    const body = schema.parse(await req.json());
    const result = await initiatePayment(
      new ObjectId(user.id),
      body.plan as keyof typeof PLANS,
      body.interval,
      body.couponCode,
      body.method ?? "duitnow_qr"
    );
    return ok(result, 201);
  } catch (err) {
    if (err instanceof CouponError) return fail(err.message, 400, err.code);
    return handleError(err);
  }
}
