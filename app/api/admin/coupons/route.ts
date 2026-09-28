import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { createCoupon, listCoupons, setCouponActive, normaliseCode, CouponError } from "@/lib/services/coupons";

export const dynamic = "force-dynamic";

/** GET /api/admin/coupons — list all coupons. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const coupons = await listCoupons();
    return ok({
      coupons: coupons.map((c) => ({
        _id: String(c._id), code: c.code, discountPct: c.discountPct ?? null, priceSen: c.priceSen ?? null,
        startsAt: c.startsAt ?? null, endsAt: c.endsAt ?? null,
        audience: c.audience ?? "all", userEmail: c.userEmail ?? null,
        maxUses: c.maxUses, usedCount: c.usedCount, active: c.active, note: c.note ?? null, createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  code: z.string().min(3).max(40),
  discountPct: z.coerce.number().int().min(1).max(99),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  audience: z.enum(["all", "starter", "professional", "enterprise", "user"]),
  userEmail: z.string().email().max(200).optional(),
  maxUses: z.coerce.number().int().min(1).max(10000).nullable().optional(),
  note: z.string().max(200).optional(),
});

/** POST /api/admin/coupons — create a coupon. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const body = createSchema.parse(await req.json());
    const code = normaliseCode(body.code);
    if (code.length < 3) return fail("Coupon name must be at least 3 letters/digits.", 422, "VALIDATION");
    if (body.endsAt <= body.startsAt) return fail("End date must be after the start date.", 422, "VALIDATION");
    if (body.audience === "user" && !body.userEmail) return fail("User email is required for a specific-user coupon.", 422, "VALIDATION");
    const coupon = await createCoupon({
      code,
      discountPct: body.discountPct,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      audience: body.audience,
      userEmail: body.userEmail,
      maxUses: body.maxUses ?? null,
      note: body.note,
      createdBy: new ObjectId(user.id),
    });
    return ok({ coupon: { _id: String(coupon._id), code: coupon.code, discountPct: coupon.discountPct } }, 201);
  } catch (err) {
    if (err instanceof CouponError && err.code === "CONFLICT") return fail(err.message, 409, "CONFLICT");
    return handleError(err);
  }
}

const patchSchema = z.object({ id: z.string().min(1), active: z.boolean() });

/** PATCH /api/admin/coupons — activate/deactivate a coupon (by id). */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { id, active } = patchSchema.parse(await req.json());
    const updated = await setCouponActive(id, active, new ObjectId(user.id));
    if (!updated) return fail("Coupon not found.", 404, "NOT_FOUND");
    return ok({ saved: true });
  } catch (err) {
    return handleError(err);
  }
}
