"use client";
import { useEffect, useState, useCallback } from "react";
import { LifeBuoy } from "lucide-react";
import { Card, CardContent, Skeleton, EmptyState } from "@/components/ui";
import { ChatPanel } from "@/components/helpline-chat";
import { cn } from "@/lib/utils";

interface ThreadItem {
  _id: string;
  userName: string;
  userEmail: string;
  lastMessageAt: string;
  unread: number;
  preview: string;
}

function fmtTime(d: string): string {
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function AdminHelplinePage() {
  const [threads, setThreads] = useState<ThreadItem[] | null>(null);
  const [active, setActive] = useState<ThreadItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerSeen, setPeerSeen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/helpline");
    const json = await res.json();
    if (json.ok) setThreads(json.data.threads);
    else setError(json.error?.message ?? "Could not load the inbox.");
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh the list after viewing a thread (its unread count clears).
  function openThread(t: ThreadItem) {
    setActive(t);
    setThreads((ts) => ts?.map((x) => (x._id === t._id ? { ...x, unread: 0 } : x)) ?? ts);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><LifeBuoy size={22} /> Helpline inbox</h1>
        <p className="text-sm text-muted-foreground">User chats with Support. Conversations are kept for 14 days.</p>
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {threads === null ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : threads.length === 0 ? (
        <EmptyState title="No conversations yet" description="When a user opens the Helpline and writes, their chat appears here." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* thread list */}
          <Card className="h-fit lg:sticky lg:top-20">
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {threads.map((t) => (
                  <li key={t._id}>
                    <button
                      onClick={() => openThread(t)}
                      className={cn("w-full px-4 py-3 text-left hover:bg-muted/50", active?._id === t._id && "bg-muted/60")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.userName}</span>
                        {t.unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">{t.unread}</span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.preview || "—"}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtTime(t.lastMessageAt)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* chat view */}
          <Card className="min-h-[60dvh]">
            <CardContent className="flex h-full min-h-[60dvh] flex-col p-4">
              {active ? (
                <>
                  <div className="border-b border-border pb-2">
                    <p className="text-sm font-semibold">{active.userName}</p>
                    <p className="text-xs text-muted-foreground">{active.userEmail}</p>
                  </div>
                  <div className="min-h-0 flex-1 pt-2">
                    <ChatPanel
                      key={active._id}
                      baseUrl={`/api/admin/helpline/${active._id}`}
                      myRole="support"
                      peerTyping={peerTyping}
                      peerSeen={peerSeen}
                      onLoaded={({ peerTyping, peerSeen }) => { setPeerTyping(peerTyping); setPeerSeen(peerSeen); }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a conversation to view and reply.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
