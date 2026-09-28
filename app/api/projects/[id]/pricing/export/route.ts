import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { buildPricedBoqXlsx, type PricedRow } from "@/lib/services/documents/builders";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Download the priced BOQ as an Excel workbook (built from live pricing records). */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const project = await requireOwnedProject(id, user);
    const db = await getDb();

    const items = await db
      .collection("boq_items")
      .find({ projectId: project._id })
      .project({ _id: 1, itemNo: 1, section: 1 })
      .toArray();
    const itemMap = new Map(items.map((i) => [String(i._id), { itemNo: String(i.itemNo ?? ""), section: i.section as string | undefined }]));

    const records = await db
      .collection("pricing_records")
      .find({ projectId: project._id })
      .sort({ category: 1, description: 1 })
      .toArray();

    const rows: PricedRow[] = records.map((r) => {
      const item = itemMap.get(String(r.itemId));
      return {
        itemNo: item?.itemNo ?? "",
        section: item?.section,
        description: String(r.description ?? ""),
        quantity: (r.quantity as number | null) ?? null,
        unit: (r.unit as string | null) ?? null,
        selectedPrice: (r.selectedPrice as number | null) ?? null,
        selectedPriceSource: (r.selectedPriceSource as string | null) ?? null,
        reviewFlag: (r.reviewFlag as string | null) ?? null,
      };
    });

    const built = await buildPricedBoqXlsx(rows, project.tenderTitle || project.name);
    await audit({
      userId: new ObjectId(user.id),
      action: "pricing.exported",
      entityType: "project",
      entityId: project._id,
      newValue: { rows: rows.length, filename: built.filename },
      source: "api",
    });

    return new Response(new Uint8Array(built.buffer), {
      headers: {
        "Content-Type": built.contentType,
        "Content-Disposition": `attachment; filename="${built.filename}"`,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
