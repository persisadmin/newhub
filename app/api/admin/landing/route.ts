import { z } from "zod";
import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { DEFAULT_VARIANT_SLUG, LANDING_VARIANTS, VARIANT_MAP } from "@/components/landing/registry";
import { getLandingSettings, saveLandingSettings } from "@/lib/services/landing";

export const dynamic = "force-dynamic";

/** GET /api/admin/landing — available variants + which one is live. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const settings = await getLandingSettings();
    return ok({
      activeVariant: resolveStored(settings.activeVariant),
      storedVariant: settings.activeVariant,
      updatedAt: settings.updatedAt ?? null,
      variants: LANDING_VARIANTS.map((v) => ({
        slug: v.slug,
        name: v.name,
        description: v.description,
        status: v.status,
        url: `/lp/${v.slug}`,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const putSchema = z.object({ activeVariant: z.string().min(1).max(60) });

/** PUT /api/admin/landing — make a variant the live landing page. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const { activeVariant } = putSchema.parse(await req.json());
    if (!VARIANT_MAP[activeVariant]) {
      return fail("Unknown landing variant.", 422, "VALIDATION");
    }
    await saveLandingSettings(activeVariant, new ObjectId(user.id));
    // `/` is force-dynamic so this is belt-and-braces for any cached shell.
    revalidatePath("/");
    return ok({ activeVariant });
  } catch (err) {
    return handleError(err);
  }
}

/** Never report a slug that isn't in the registry as "live". */
function resolveStored(slug: string): string {
  return VARIANT_MAP[slug] ? slug : DEFAULT_VARIANT_SLUG;
}
