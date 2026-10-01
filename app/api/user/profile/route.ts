import { z } from "zod";
import { ObjectId } from "mongodb";
import { ok, handleError } from "@/lib/api";
import { requireUser } from "@/lib/auth-helpers";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { UserDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
});

const putSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  companyName: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  address: addressSchema.optional(),
});

/** Return the signed-in user's profile. Email is immutable and excluded from updates. */
export async function GET() {
  try {
    const user = await requireUser();
    const db = await getDb();
    const doc = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(user.id) });
    if (!doc) return handleError(new Error("User not found"));
    return ok({
      email: doc.email,
      name: doc.name,
      companyName: doc.companyName ?? "",
      phone: doc.phone ?? "",
      address: {
        line1: doc.address?.line1 ?? "",
        line2: doc.address?.line2 ?? "",
        city: doc.address?.city ?? "",
        state: doc.address?.state ?? "",
        postcode: doc.address?.postcode ?? "",
      },
      hasPassword: Boolean(doc.passwordHash),
      createdAt: doc.createdAt,
    });
  } catch (err) {
    return handleError(err);
  }
}

/** Update the signed-in user's profile. All fields optional; empty string clears. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = putSchema.parse(await req.json());
    const db = await getDb();

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, string> = {};
    const applyOptional = (key: "name" | "companyName" | "phone", value: string | undefined) => {
      if (value === undefined) return;
      const v = value.trim();
      if (v === "") unset[key] = "";
      else set[key] = v;
    };
    applyOptional("name", body.name);
    applyOptional("companyName", body.companyName);
    applyOptional("phone", body.phone);

    if (body.address !== undefined) {
      const cleaned: Record<string, string> = {};
      for (const k of ["line1", "line2", "city", "state", "postcode"] as const) {
        const v = body.address[k]?.trim();
        if (v) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) set.address = cleaned;
      else unset.address = "";
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const res = await db.collection<UserDoc>("users").updateOne(
      { _id: new ObjectId(user.id) },
      update as never
    );
    if (res.matchedCount === 0) return handleError(new Error("User not found"));
    await audit({
      userId: new ObjectId(user.id),
      action: "user.profile_updated",
      entityType: "user",
      entityId: new ObjectId(user.id),
      newValue: { fields: Object.keys(body) },
      source: "settings",
    });
    return ok({ updated: true });
  } catch (err) {
    return handleError(err);
  }
}
