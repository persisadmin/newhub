import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { CouponDoc, CouponAudience } from "@/lib/domain/types";

/**
 * Admin-managed exclusive coupons. A coupon grants a percentage discount
 * (1–99%) off the package price at payment initiation, within a defined
 * start/end window, and restricted to an audience (everyone, one package
 * tier, or a specific user email). A coupon name may be reused over time,
 * but never by two coupons whose active windows overlap. Redemption is
 * atomic and counted at initiation time.
 */

export class CouponError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "EXHAUSTED" | "NOT_ELIGIBLE" | "CONFLICT"
  ) {
    super(message);
    this.name = "CouponError";
  }
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
}

export interface RedeemContext {
  plan: string;
  email?: string | null;
}

/**
 * Validate and redeem a coupon in one atomic step.
 * Returns the coupon or throws CouponError with a precise reason.
 */
export async function redeemCoupon(code: string, ctx: RedeemContext): Promise<CouponDoc> {
  const db = await getDb();
  const normalised = normaliseCode(code);
  if (!normalised) throw new CouponError("Invalid coupon code.", "NOT_FOUND");

  // Latest coupon under this name (names can be reused across windows).
  const coupon = await db
    .collection<CouponDoc>("coupons")
    .find({ code: normalised })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();
  if (!coupon) throw new CouponError("Coupon code not recognised.", "NOT_FOUND");
  if (!coupon.active) throw new CouponError("This coupon is no longer active.", "INACTIVE");

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) {
    throw new CouponError(`This coupon starts on ${coupon.startsAt.toLocaleString("en-MY")}.`, "NOT_STARTED");
  }
  if (coupon.endsAt && now >= coupon.endsAt) throw new CouponError("This coupon has expired.", "EXPIRED");

  // Audience gate
  const aud: CouponAudience = coupon.audience ?? "all";
  if (aud === "user") {
    if (!ctx.email || ctx.email.toLowerCase() !== (coupon.userEmail ?? "").toLowerCase()) {
      throw new CouponError("This coupon is reserved for a specific account.", "NOT_ELIGIBLE");
    }
  } else if (aud !== "all" && aud !== ctx.plan) {
    throw new CouponError(`This coupon is only valid for the ${aud} package.`, "NOT_ELIGIBLE");
  }

  // Atomic use-count guard: only increment while under the cap.
  const res = await db.collection<CouponDoc>("coupons").findOneAndUpdate(
    {
      _id: coupon._id,
      active: true,
      $or: [{ maxUses: null }, { $expr: { $lt: ["$usedCount", "$maxUses"] } }],
    },
    { $inc: { usedCount: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!res) throw new CouponError("This coupon has been fully redeemed.", "EXHAUSTED");
  return res;
}

/** Compute the discounted price (sen) for a package. Never below 1 sen. */
export function discountedPriceSen(baseSen: number, coupon: CouponDoc): number {
  if (coupon.discountPct != null) {
    return Math.max(1, Math.round((baseSen * (100 - coupon.discountPct)) / 100));
  }
  // Legacy fixed-price coupons
  return coupon.priceSen ?? baseSen;
}

export async function createCoupon(input: {
  code: string;
  discountPct: number;
  startsAt: Date;
  endsAt: Date;
  audience: CouponAudience;
  userEmail?: string;
  maxUses: number | null;
  note?: string;
  createdBy: ObjectId;
}): Promise<CouponDoc> {
  const db = await getDb();
  const code = normaliseCode(input.code);
  const now = new Date();

  // Exclusivity: no other coupon with the same name may be active during
  // any part of this coupon's window.
  const conflict = await db.collection<CouponDoc>("coupons").findOne({
    code,
    active: true,
    startsAt: { $lt: input.endsAt },
    endsAt: { $gt: input.startsAt },
  });
  if (conflict) {
    throw new CouponError(
      `Another coupon named ${code} is active between ${conflict.startsAt.toLocaleString("en-MY")} and ${conflict.endsAt.toLocaleString("en-MY")}. Deactivate it or pick a different window.`,
      "CONFLICT"
    );
  }

  const doc: CouponDoc = {
    _id: new ObjectId(),
    code,
    discountPct: input.discountPct,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    audience: input.audience,
    userEmail: input.audience === "user" ? input.userEmail?.toLowerCase() : undefined,
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
    newValue: {
      code: doc.code, discountPct: doc.discountPct, startsAt: doc.startsAt, endsAt: doc.endsAt,
      audience: doc.audience, userEmail: doc.userEmail, maxUses: doc.maxUses,
    },
    source: "admin",
  });
  return doc;
}

export async function listCoupons(limit = 50): Promise<CouponDoc[]> {
  const db = await getDb();
  return db.collection<CouponDoc>("coupons").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

/** Toggle by _id (names are reusable, so toggling must target one coupon). */
export async function setCouponActive(id: string, active: boolean, adminId: ObjectId): Promise<boolean> {
  const db = await getDb();
  const res = await db.collection<CouponDoc>("coupons").updateOne(
    { _id: new ObjectId(id) },
    { $set: { active, updatedAt: new Date() } }
  );
  if (res.modifiedCount > 0) {
    await audit({
      userId: adminId,
      action: active ? "admin.coupon_activated" : "admin.coupon_deactivated",
      entityType: "coupon",
      entityId: id,
      source: "admin",
    });
  }
  return res.modifiedCount > 0;
}
