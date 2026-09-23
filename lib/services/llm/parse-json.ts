/**
 * Robust JSON extraction from LLM output, ported from the legacy PERSIS
 * system's _parse_json(). Handles markdown fences, trailing commas,
 * unbalanced brackets, and truncated output.
 */
export function parseLlmJson(raw: string): unknown {
  let text = raw.trim();

  // Strip ALL markdown code fences anywhere
  text = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();

  // 1) Direct parse
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }

  // 2) Extract the largest {...} object or [...] array and try, with repair
  const obj = /\{[\s\S]*\}/.exec(text);
  const arr = /\[[\s\S]*\]/.exec(text);
  const candidates = [obj?.[0], arr?.[0]].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try repair */
    }
    try {
      let fixed = candidate.replace(/,\s*([}\]])/g, "$1");
      fixed += "]".repeat(Math.max(0, (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length));
      fixed += "}".repeat(Math.max(0, (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length));
      return JSON.parse(fixed);
    } catch {
      /* continue */
    }
  }

  // 3) Last resort: truncated JSON — close at the last complete element
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace > 0) {
    let truncated = text.slice(0, lastBrace + 1);
    truncated += "}".repeat(
      Math.max(0, (truncated.match(/\{/g) || []).length - (truncated.match(/\}/g) || []).length)
    );
    try {
      return JSON.parse(truncated);
    } catch {
      /* fall through */
    }
  }

  throw new Error(`Cannot parse JSON from LLM output: ${raw.slice(0, 200)}`);
}

export function parseLlmJsonObject(raw: string): Record<string, unknown> {
  const parsed = parseLlmJson(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LLM output is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}
