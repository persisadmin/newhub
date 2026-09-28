import fs from "fs/promises";
import path from "path";
import { logger } from "@/lib/logger";

/**
 * Gemini TTS (Google AI Gemini Interactions API).
 * Synthesizes long text by chunking at sentence boundaries and saving one
 * WAV file per chunk. The client plays the parts sequentially.
 *
 * Model: gemini-3.8-flash-lite-tts (override with GEMINI_TTS_MODEL).
 * Unary requests return a complete WAV (audio/wav, 24 kHz mono) — no header
 * wrapping needed. Language is auto-detected (Standard Malay supported).
 */

const MAX_CHUNK_CHARS = 900;
const REQUEST_TIMEOUT_MS = 120_000;

export function splitForTts(text: string): string[] {
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    // Hard-split sentences that alone exceed the cap
    let piece = s;
    while (piece.length > MAX_CHUNK_CHARS) {
      const cut = piece.lastIndexOf(" ", MAX_CHUNK_CHARS);
      chunks.push(piece.slice(0, cut > 0 ? cut : MAX_CHUNK_CHARS));
      piece = piece.slice(cut > 0 ? cut : MAX_CHUNK_CHARS).trim();
    }
    if ((current + " " + piece).trim().length > MAX_CHUNK_CHARS && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = (current + " " + piece).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

interface InteractionsResponse {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; data?: string }>;
  }>;
  error?: { message?: string };
}

async function synthesizeChunk(text: string, apiKey: string, model: string, voice: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model,
        input: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                text,
                annotations: [{ type: "speech_metadata", style: "warm, seasoned Malaysian contractor telling a story from experience — conversational, natural pacing, expressive" }],
              },
            ],
          },
        ],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini TTS request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as InteractionsResponse;
    const audio = [...(data.steps ?? [])]
      .reverse()
      .flatMap((s) => s.content ?? [])
      .find((c) => c.type === "audio" && c.data);
    if (!audio?.data) {
      throw new Error(`Gemini TTS returned no audio: ${data.error?.message ?? "empty response"}`);
    }
    // Unary responses are a complete WAV file (audio/wav) — write as-is.
    return Buffer.from(audio.data, "base64");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize `text` to per-chunk audio files under data/audio/<projectId>/.
 * Returns the number of parts written. Throws on failure (caller catches).
 */
export async function synthesizeToFiles(projectId: string, text: string): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts";
  const voice = process.env.GEMINI_TTS_VOICE || "Kore";
  const chunks = splitForTts(text);
  const dir = path.join("data", "audio", projectId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  let written = 0;
  for (let i = 0; i < chunks.length; i++) {
    const buf = await synthesizeChunk(chunks[i], apiKey, model, voice);
    await fs.writeFile(path.join(dir, `part-${i}.wav`), buf);
    written++;
    logger.info("tts.chunk", { projectId, part: i, of: chunks.length, bytes: buf.length });
  }
  return written;
}
