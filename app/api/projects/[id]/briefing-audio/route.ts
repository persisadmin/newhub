import { handleError } from "@/lib/api";
import { requireUser, requireOwnedProject } from "@/lib/auth-helpers";
import { getFile, storageRefFor } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stream one part of the AI-narrated strategy briefing audio. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireOwnedProject(id, user);
    const partParam = new URL(req.url).searchParams.get("part") ?? "0";
    const part = Number.parseInt(partParam, 10);
    if (!Number.isInteger(part) || part < 0 || part > 50) {
      return Response.json({ ok: false, error: { code: "VALIDATION", message: "Invalid part." } }, { status: 400 });
    }
    // Audio is stored under the same key the TTS writer used.
    const buf = await getFile(storageRefFor(`audio/${id}/part-${part}.wav`));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "Audio part not found." } }, { status: 404 });
    }
    return handleError(err);
  }
}
