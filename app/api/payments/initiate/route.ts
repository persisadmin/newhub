import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, handleError, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { initiatePayment, PLANS } from "@/lib/services/payment";

export const dynamic = "force-dynamic";

const schema = z.object({
  plan: z.enum(["starter", "professional", "enterprise"]),
  interval: z.enum(["monthly", "yearly"]),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`pay:${user.id}`, 10, 60_000);
    if (!rl.allowed) return fail("Too many payment attempts. Try again later.", 429, "RATE_LIMITED");
    const body = schema.parse(await req.json());
    const result = await initiatePayment(new ObjectId(user.id), body.plan as keyof typeof PLANS, body.interval);
    return ok(result, 201);
  } catch (err) {
    return handleError(err);
  }
}
