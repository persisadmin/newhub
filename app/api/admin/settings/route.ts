import { z } from "zod";
import { ok, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { getLlmSettings, saveLlmSettings } from "@/lib/services/llm/settings";
import { getBillingSettings, saveBillingSettings } from "@/lib/services/credits";
import { isMaintenanceMode, setMaintenanceMode } from "@/lib/services/maintenance";
import { getPromo, savePromo } from "@/lib/services/promo";
import { getDuitNowPreview } from "@/lib/services/duitnow";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const providerSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(120),
  apiKey: z.string().max(500),
  enabled: z.boolean(),
  vision: z.boolean(),
});

const featuresSchema = z.object({
  generateDocs: z.boolean(),
  pricingAssist: z.boolean(),
  ocrMaxPages: z.coerce.number().int().min(1).max(200),
  pricingBatchSize: z.coerce.number().int().min(1).max(100),
});

const settingsSchema = z.object({
  providers: z.array(providerSchema).max(10),
  features: featuresSchema,
  billing: z
    .object({
      creditMultiplier: z.coerce.number().min(0.1).max(1000),
      usdToMyr: z.coerce.number().min(0.1).max(100),
      prices: z
        .array(
          z.object({
            providerId: z.string().min(1).max(60),
            inputUsdPerM: z.coerce.number().min(0).max(10000),
            outputUsdPerM: z.coerce.number().min(0).max(10000),
          })
        )
        .max(20),
    })
    .optional(),
  maintenance: z.boolean().optional(),
  promo: z
    .object({
      enabled: z.boolean(),
      startsAt: z.coerce.date(),
      endsAt: z.coerce.date(),
      trialDays: z.coerce.number().int().min(1).max(365),
      credits: z.coerce.number().min(0).max(1000000),
    })
    .optional(),
});

/** GET /api/admin/settings — current LLM chain + feature flags. Keys are masked. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const settings = await getLlmSettings();
    const billing = await getBillingSettings();
    const maintenance = await isMaintenanceMode();
    const promo = await getPromo();
    return ok({
      maintenance,
      promo,
      duitnow: getDuitNowPreview(),
      settings: {
        ...settings,
        providers: settings.providers.map((p) => ({
          ...p,
          apiKey: p.apiKey ? "••••••••" + p.apiKey.slice(-4) : "",
        })),
      },
      billing,
    });
  } catch (err) {
    return handleError(err);
  }
}

/** PUT /api/admin/settings — replace LLM chain + feature flags. */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const body = await req.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: parsed.error.issues.map((i) => i.message).join("; ") } },
        { status: 400 }
      );
    }
    // Never overwrite a real key with the mask placeholder.
    const existing = await getLlmSettings();
    const providers = parsed.data.providers.map((p) => {
      const prev = existing.providers.find((e) => e.id === p.id);
      if (p.apiKey.startsWith("••••••••") && prev) return { ...p, apiKey: prev.apiKey };
      return p;
    });
    await saveLlmSettings({ providers, features: parsed.data.features });
    if (parsed.data.billing) await saveBillingSettings(parsed.data.billing);
    if (parsed.data.maintenance !== undefined) {
      await setMaintenanceMode(parsed.data.maintenance, new (await import("mongodb")).ObjectId(user.id));
    }
    if (parsed.data.promo) {
      await savePromo(parsed.data.promo, new (await import("mongodb")).ObjectId(user.id));
    }
    await audit({
      userId: new (await import("mongodb")).ObjectId(user.id),
      action: "admin.llm_settings_updated",
      entityType: "settings",
      entityId: "llm",
      newValue: { providers: providers.map((p) => ({ id: p.id, model: p.model, enabled: p.enabled, hasKey: !!p.apiKey })), features: parsed.data.features, billing: parsed.data.billing },
      source: "admin",
    });
    return ok({ saved: true });
  } catch (err) {
    return handleError(err);
  }
}
