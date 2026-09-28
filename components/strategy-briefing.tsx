"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Square, Eye, EyeOff, Volume2 } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui";

/** Remove Gemini TTS inline vocal tags (<sigh>, <short pause>, …) for the
 *  on-screen transcript and the browser-speech fallback. */
function stripVocalTags(text: string): string {
  return text.replace(/<[^>]{1,40}>/g, "").replace(/ {2,}/g, " ").trim();
}

/** Split text into speakable chunks (sentences/paragraphs, ~200 chars max each).
 *  Chrome silently fails or stalls on very long utterances — queueing short
 *  chunks is the reliable workaround. */
function chunkText(text: string): string[] {
  const sentences = text
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).trim().length > 200 && current) {
      chunks.push(current);
      current = s;
    } else {
      current = (current + " " + s).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => /^ms([-_]|$)/i.test(v.lang)) ??
    voices.find((v) => /^id([-_]|$)/i.test(v.lang)) ??
    voices.find((v) => /^en[-_]/i.test(v.lang)) ??
    voices[0] ??
    null
  );
}

/**
 * Site Strategy Briefing — plays the AI-generated veteran-contractor narrative
 * aloud using the browser's speech synthesis. The text itself stays hidden
 * unless the user expands the transcript.
 */
export function StrategyBriefing({ narrative, projectId, audioParts = 0 }: { narrative: string; projectId: string; audioParts?: number }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const [showText, setShowText] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const partRef = useRef(0);
  const hasStudioAudio = audioParts > 0;

  useEffect(() => {
    const ok = typeof window !== "undefined" && "speechSynthesis" in window;
    setSupported(ok);
    if (!ok) return;
    // Voices load asynchronously in Chrome — wait for them.
    const onVoices = () => setVoiceReady(true);
    if (window.speechSynthesis.getVoices().length > 0) setVoiceReady(true);
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      cancelledRef.current = true;
      window.speechSynthesis.cancel();
    };
  }, []);

  function speakNext() {
    if (cancelledRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(next);
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.lang = "ms-MY";
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.onend = () => speakNext();
    utter.onerror = (e) => {
      if (cancelledRef.current || e.error === "canceled" || e.error === "interrupted") return;
      setError(`Playback error: ${e.error}. Try the transcript, or a different browser.`);
      setSpeaking(false);
    };
    window.speechSynthesis.speak(utter);
  }

  function playPart() {
    if (cancelledRef.current || !audioRef.current) return;
    if (partRef.current >= audioParts) {
      setSpeaking(false);
      return;
    }
    audioRef.current.src = `/api/projects/${projectId}/briefing-audio?part=${partRef.current}`;
    audioRef.current.play().catch((e) => {
      setError(`Audio playback failed: ${String(e?.message ?? e)}. Try again or use the transcript.`);
      setSpeaking(false);
    });
  }

  function toggle() {
    setError(null);
    // Studio audio path (Gemini TTS)
    if (hasStudioAudio && audioRef.current) {
      if (speaking) {
        cancelledRef.current = true;
        audioRef.current.pause();
        setSpeaking(false);
        return;
      }
      cancelledRef.current = false;
      partRef.current = 0;
      setSpeaking(true);
      playPart();
      return;
    }
    // Browser speech fallback
    if (!supported) return;
    if (speaking) {
      cancelledRef.current = true;
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    cancelledRef.current = false;
    queueRef.current = chunkText(stripVocalTags(narrative));
    window.speechSynthesis.cancel();
    setSpeaking(true);
    speakNext();
  }

  const words = narrative.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 140));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 size={16} className="text-primary" /> Site Strategy Briefing
            </CardTitle>
            <CardDescription>
              A veteran Malaysian contractor&rsquo;s game plan for this tender — in Bahasa Melayu, generated by AI. ~{minutes} min listen.{hasStudioAudio ? " Studio voice." : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={speaking ? "outline" : "default"} onClick={toggle} disabled={!hasStudioAudio && (!supported || !voiceReady)}>
              {speaking ? <Square size={12} /> : <Play size={12} />} {speaking ? "Stop" : (hasStudioAudio || voiceReady) ? "Play briefing" : "Loading voice…"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowText((v) => !v)}>
              {showText ? <EyeOff size={12} /> : <Eye size={12} />} {showText ? "Hide transcript" : "Transcript"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {error && (
        <CardContent>
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        </CardContent>
      )}
      {showText && (
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{stripVocalTags(narrative)}</p>
        </CardContent>
      )}
      {!supported && !hasStudioAudio && (
        <CardContent>
          <p className="text-xs text-muted-foreground">Your browser doesn&rsquo;t support speech playback. Use the transcript instead.</p>
        </CardContent>
      )}
      {hasStudioAudio && (
        <audio
          ref={audioRef}
          preload="none"
          onEnded={() => { partRef.current += 1; playPart(); }}
          onError={() => { if (!cancelledRef.current) { setError("Audio stream failed. Try again in a moment."); setSpeaking(false); } }}
          className="hidden"
        />
      )}
    </Card>
  );
}
