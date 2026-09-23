import { z } from "zod";
import { ok, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { getLlmSettings, saveLlmSettings } from "@/lib/services/llm/settings";
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
});

/** GET /api/admin/settings — current LLM chain + feature flags. Keys are masked. */
export async function GET() {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const settings = await getLlmSettings();
    return ok({
      settings: {
        ...settings,
        providers: settings.providers.map((p) => ({
          ...p,
          apiKey: p.apiKey ? "••••••••" + p.apiKey.slice(-4) : "",
        })),
      },
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
    await audit({
      userId: new (await import("mongodb")).ObjectId(user.id),
      action: "admin.llm_settings_updated",
      entityType: "settings",
      entityId: "llm",
      newValue: { providers: providers.map((p) => ({ id: p.id, model: p.model, enabled: p.enabled, hasKey: !!p.apiKey })), features: parsed.data.features },
      source: "admin",
    });
    return ok({ saved: true });
  } catch (err) {
    return handleError(err);
  }
}
