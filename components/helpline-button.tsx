"use client";
import { useEffect, useState, useCallback } from "react";
import { LifeBuoy, X } from "lucide-react";
import { ChatPanel } from "@/components/helpline-chat";

/**
 * Floating "Helpline" button (bottom-right) with an unread badge, opening the
 * support chat in a modal. Polls the badge lightly while closed.
 */
export function HelplineButton() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [awaiting, setAwaiting] = useState(true);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerSeen, setPeerSeen] = useState(false);

  // Light badge poll (works even while the modal is closed).
  const pollBadge = useCallback(async () => {
    try {
      const res = await fetch("/api/helpline?badge=1");
      const json = await res.json();
      if (json.ok) setUnread(json.data.unread ?? 0);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    pollBadge();
    const t = setInterval(pollBadge, 15000);
    return () => clearInterval(t);
  }, [pollBadge]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Helpline chat"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <LifeBuoy size={16} /> Helpline
        {unread > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">{unread}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => { setOpen(false); pollBadge(); }}>
          <div
            className="flex h-[80dvh] w-full max-w-lg flex-col rounded-t-xl bg-card p-4 shadow-xl sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div>
                <h2 className="text-base font-semibold">Helpline</h2>
                <p className="text-xs text-muted-foreground">Chat with PERSIS Support — history kept 14 days.</p>
              </div>
              <button onClick={() => { setOpen(false); pollBadge(); }} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close chat"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 pt-2">
              <ChatPanel
                baseUrl="/api/helpline"
                myRole="user"
                awaitingReply={awaiting}
                peerTyping={peerTyping}
                peerSeen={peerSeen}
                onLoaded={({ peerTyping, peerSeen, hasSupportReply }) => {
                  setPeerTyping(peerTyping);
                  setPeerSeen(peerSeen);
                  setAwaiting(!hasSupportReply);
                  setUnread(0); // viewing marks read
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
