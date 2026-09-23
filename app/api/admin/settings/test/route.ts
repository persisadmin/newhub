import { z } from "zod";
import { ok, handleError } from "@/lib/api";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { testProvider } from "@/lib/services/llm/providers";
import type { ProviderConfig } from "@/lib/services/llm/settings";

export const dynamic = "force-dynamic";

const testSchema = z.object({
  provider: z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string().url(),
    model: z.string(),
    apiKey: z.string(),
    enabled: z.boolean(),
    vision: z.boolean(),
  }),
});

/**
 * POST /api/admin/settings/test — send a ping through one provider using the
 * key in the request body, so unsaved keys can be tested before saving.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user, "admin");
    const body = await req.json();
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: "Invalid provider payload." } },
        { status: 400 }
      );
    }
    if (!parsed.data.provider.apiKey) {
      return Response.json(
        { ok: false, error: { code: "VALIDATION", message: "Enter an API key before testing." } },
        { status: 400 }
      );
    }
    const provider = parsed.data.provider as ProviderConfig;
    try {
      const result = await testProvider(provider);
      return ok({ ok: true, latencyMs: result.latencyMs, reply: result.reply.slice(0, 100), returnedModel: result.returnedModel });
    } catch (err) {
      return ok({ ok: false, error: String(err).slice(0, 300) });
    }
  } catch (err) {
    return handleError(err);
  }
}
