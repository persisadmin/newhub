import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ recordId: string }> };

const patchSchema = z.object({
  manualPrice: z.number().positive().max(1e9),
  note: z.string().max(500).optional(),
});

/** Manual price override — human-in-the-loop, fully audited. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { recordId } = await ctx.params;
    if (!ObjectId.isValid(recordId)) return fail("Invalid record.", 422, "VALIDATION");
    const body = patchSchema.parse(await req.json());
    await ensureIndexes();
    const db = await getDb();
    const record = await db.collection("pricing_records").findOne({ _id: new ObjectId(recordId) });
    if (!record) return fail("Pricing record not found.", 404, "NOT_FOUND");
    await requireOwnedProject(String(record.projectId), user);

    const prev = { selectedPrice: record.selectedPrice, selectedPriceSource: record.selectedPriceSource, reviewFlag: record.reviewFlag };
    const res = await db.collection("pricing_records").updateOne(
      { _id: record._id, version: record.version },
      {
        $set: {
          selectedPrice: Math.round(body.manualPrice * 100) / 100,
          selectedPriceSource: "manual",
          reviewFlag: null,
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      }
    );
    if (res.modifiedCount === 0) return fail("This record was updated concurrently. Refresh and try again.", 409, "CONFLICT");
    await audit({
      userId: user.id,
      action: "pricing.manual_override",
      entityType: "pricing_record",
      entityId: recordId,
      previousValue: prev,
      newValue: { selectedPrice: body.manualPrice, note: body.note },
      source: "api",
    });
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
