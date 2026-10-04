"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Send, ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

export interface ChatMessage {
  _id: string;
  senderRole: "user" | "support";
  senderName: string;
  kind: "text" | "image";
  body?: string;
  imageUrl?: string;
  createdAt: string;
}

interface ChatPanelProps {
  /** Base URL for GET/PATCH; sends go to sendUrl (defaults to baseUrl). */
  baseUrl: string;
  sendUrl?: string;
  /** Which side is "me" — my messages render right-aligned. */
  myRole: "user" | "support";
  /** Poll ms while visible. */
  pollMs?: number;
  /** Empty-state / pre-first-reply banner (user side). */
  awaitingReply?: boolean;
  peerTyping?: boolean;
  peerSeen?: boolean;
  onLoaded?: (data: { peerTyping: boolean; peerSeen: boolean; hasSupportReply?: boolean }) => void;
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Shared helpline chat panel: message list, typing indicator, text + image
 * composer with polling. Used by the user-facing modal and the support inbox.
 */
export function ChatPanel({ baseUrl, sendUrl, myRole, pollMs = 4000, awaitingReply, peerTyping, peerSeen, onLoaded }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingSentAt = useRef(0);
  const bottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(baseUrl);
      const json = await res.json();
      if (!json.ok) return;
      setMessages(json.data.messages);
      onLoaded?.({
        peerTyping: Boolean(json.data.supportTyping ?? json.data.userTyping),
        peerSeen: Boolean(json.data.supportSeenUser ?? json.data.userSeenSupport),
        hasSupportReply: json.data.hasSupportReply,
      });
      // Mark read on every load (the viewer is looking at the thread).
      fetch(baseUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) }).catch(() => {});
    } catch { /* transient poll failure — keep last state */ }
  }, [baseUrl, onLoaded]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  useEffect(() => {
    if (bottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    bottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  function signalTyping() {
    const now = Date.now();
    if (now - typingSentAt.current < 10_000) return;
    typingSentAt.current = now;
    fetch(baseUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typing: true }) }).catch(() => {});
  }

  async function send() {
    const text = draft.trim();
    if (!text && !image) return;
    setSending(true);
    setError(null);
    try {
      const url = sendUrl ?? baseUrl;
      let res: Response;
      if (image) {
        const fd = new FormData();
        fd.append("image", image);
        if (text) fd.append("caption", text);
        res = await fetch(url, { method: "POST", body: fd });
      } else {
        res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
      }
      const json = await res.json();
      if (json.ok) {
        setDraft(""); setImage(null);
        if (fileRef.current) fileRef.current.value = "";
        bottomRef.current = true;
        load();
      } else {
        setError(json.error?.message ?? "Could not send.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* messages */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3">
        {awaitingReply && (
          <p className="rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
            A Helpdesk personnel will attend to you shortly.
          </p>
        )}
        {messages === null ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading chat…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === myRole;
            return (
              <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.kind === "image" && m.imageUrl && (
                    <a href={m.imageUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.imageUrl} alt={m.body ?? "attachment"} className="mb-1 max-h-48 rounded-md object-contain" />
                    </a>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <p className={`mt-1 text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {mine ? "You" : m.senderName} · {fmtTime(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {peerTyping && <p className="text-xs italic text-muted-foreground">{myRole === "user" ? "Support is typing…" : "User is typing…"}</p>}
      </div>

      {peerSeen && messages && messages.length > 0 && messages[messages.length - 1].senderRole === myRole && (
        <p className="pb-1 text-right text-[10px] text-muted-foreground">Seen</p>
      )}

      {/* composer */}
      <div className="border-t border-border pt-3">
        {image && (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
            <span className="truncate">{image.name}</span>
            <button onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Remove image"><X size={12} /></button>
          </div>
        )}
        {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Attach image" onClick={() => fileRef.current?.click()}><ImagePlus size={16} /></Button>
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); signalTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type a message… (Enter to send)"
            className="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button type="button" onClick={send} disabled={sending || (!draft.trim() && !image)} aria-label="Send">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
