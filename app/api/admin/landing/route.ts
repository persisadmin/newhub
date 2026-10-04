import { z } from "zod";
import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { ok, fail, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { DEFAULT_VARIANT_SLUG, LANDING_VARIANTS, VARIANT_MAP } from "@/components/landing/registry";
import { getLandingSettings, saveLandingSettings, saveSocialLinks } from "@/lib/services/landing";

export const dynamic = "force-dynamic";

/** GET /api/admin/landing — available variants, which one is live, and the footer socials. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const settings = await getLandingSettings();
    return ok({
      activeVariant: resolveStored(settings.activeVariant),
      storedVariant: settings.activeVariant,
      socials: settings.socials ?? {},
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

const putSchema = z.object({
  activeVariant: z.string().min(1).max(60).optional(),
  socials: z.object({
    facebook: z.string().max(300).optional(),
    youtube: z.string().max(300).optional(),
    tiktok: z.string().max(300).optional(),
    instagram: z.string().max(300).optional(),
  }).optional(),
});

/** PUT /api/admin/landing — activate a variant and/or update the footer socials. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const body = putSchema.parse(await req.json());
    if (!body.activeVariant && !body.socials) {
      return fail("Nothing to update.", 400, "VALIDATION");
    }
    const result: { activeVariant?: string; socials?: unknown } = {};
    if (body.activeVariant) {
      if (!VARIANT_MAP[body.activeVariant]) {
        return fail("Unknown landing variant.", 422, "VALIDATION");
      }
      await saveLandingSettings(body.activeVariant, new ObjectId(user.id));
      result.activeVariant = body.activeVariant;
    }
    if (body.socials) {
      result.socials = await saveSocialLinks(body.socials, new ObjectId(user.id));
    }
    // `/` is force-dynamic so this is belt-and-braces for any cached shell.
    revalidatePath("/");
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}

/** Never report a slug that isn't in the registry as "live". */
function resolveStored(slug: string): string {
  return VARIANT_MAP[slug] ? slug : DEFAULT_VARIANT_SLUG;
}
