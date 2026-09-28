import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { CouponDoc } from "@/lib/domain/types";

/**
 * Admin-managed coupons. A coupon overrides the package price at payment
 * initiation (e.g. a RM0.10 test coupon to exercise the real payment bridge
 * end-to-end). Redemption is atomic and counted at initiation time.
 */

export class CouponError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "INACTIVE" | "EXHAUSTED") {
    super(message);
    this.name = "CouponError";
  }
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
}

/**
 * Validate and redeem a coupon in one atomic step.
 * Returns the coupon (with its priceSen) or throws CouponError.
 */
export async function redeemCoupon(code: string): Promise<CouponDoc> {
  const db = await getDb();
  const normalised = normaliseCode(code);
  if (!normalised) throw new CouponError("Invalid coupon code.", "NOT_FOUND");

  const coupon = await db.collection<CouponDoc>("coupons").findOne({ code: normalised });
  if (!coupon) throw new CouponError("Coupon code not recognised.", "NOT_FOUND");
  if (!coupon.active) throw new CouponError("This coupon is no longer active.", "INACTIVE");

  // Atomic use-count guard: only increment while under the cap.
  const res = await db.collection<CouponDoc>("coupons").findOneAndUpdate(
    {
      code: normalised,
      active: true,
      $or: [{ maxUses: null }, { $expr: { $lt: ["$usedCount", "$maxUses"] } }],
    },
    { $inc: { usedCount: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!res) throw new CouponError("This coupon has been fully redeemed.", "EXHAUSTED");
  return res;
}

export async function createCoupon(input: {
  code: string;
  priceSen: number;
  maxUses: number | null;
  note?: string;
  createdBy: ObjectId;
}): Promise<CouponDoc> {
  const db = await getDb();
  const now = new Date();
  const doc: CouponDoc = {
    _id: new ObjectId(),
    code: normaliseCode(input.code),
    priceSen: input.priceSen,
    maxUses: input.maxUses,
    usedCount: 0,
    active: true,
    note: input.note,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<CouponDoc>("coupons").insertOne(doc);
  await audit({
    userId: input.createdBy,
    action: "admin.coupon_created",
    entityType: "coupon",
    entityId: doc._id,
    newValue: { code: doc.code, priceSen: doc.priceSen, maxUses: doc.maxUses },
    source: "admin",
  });
  return doc;
}

export async function listCoupons(limit = 50): Promise<CouponDoc[]> {
  const db = await getDb();
  return db.collection<CouponDoc>("coupons").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function setCouponActive(code: string, active: boolean, adminId: ObjectId): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<CouponDoc>("coupons").updateOne(
    { code: normaliseCode(code) },
    { $set: { active, updatedAt: new Date() } }
  );
  if (res.modifiedCount > 0) {
    await audit({
      userId: adminId,
      action: active ? "admin.coupon_activated" : "admin.coupon_deactivated",
      entityType: "coupon",
      entityId: normaliseCode(code),
      source: "admin",
    });
  }
  return res.modifiedCount > 0;
}
