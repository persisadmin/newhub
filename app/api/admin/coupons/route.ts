import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { createCoupon, listCoupons, setCouponActive, normaliseCode } from "@/lib/services/coupons";

export const dynamic = "force-dynamic";

/** GET /api/admin/coupons — list all coupons. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const coupons = await listCoupons();
    return ok({
      coupons: coupons.map((c) => ({
        _id: String(c._id), code: c.code, priceSen: c.priceSen, maxUses: c.maxUses,
        usedCount: c.usedCount, active: c.active, note: c.note ?? null, createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  code: z.string().min(3).max(40),
  priceSen: z.coerce.number().int().min(1).max(100000),
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
    if (code.length < 3) return fail("Coupon code must be at least 3 letters/digits.", 422, "VALIDATION");
    const coupon = await createCoupon({
      code,
      priceSen: body.priceSen,
      maxUses: body.maxUses ?? null,
      note: body.note,
      createdBy: new ObjectId(user.id),
    });
    return ok({ coupon: { _id: String(coupon._id), code: coupon.code, priceSen: coupon.priceSen } }, 201);
  } catch (err) {
    if ((err as { code?: unknown })?.code === 11000) return fail("That coupon code already exists.", 409, "DUPLICATE");
    return handleError(err);
  }
}

const patchSchema = z.object({ code: z.string().min(3).max(40), active: z.boolean() });

/** PATCH /api/admin/coupons — activate/deactivate a coupon. */
export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { code, active } = patchSchema.parse(await req.json());
    const updated = await setCouponActive(code, active, new ObjectId(user.id));
    if (!updated) return fail("Coupon not found.", 404, "NOT_FOUND");
    return ok({ saved: true });
  } catch (err) {
    return handleError(err);
  }
}
