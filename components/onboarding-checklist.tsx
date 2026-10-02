"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X, ChevronRight } from "lucide-react";

interface Step { key: string; label: string; href: string; done: boolean }
interface Status { steps: Step[]; doneCount: number; total: number; dismissed: boolean }

/**
 * Getting-started checklist for new users. Progress is derived from real usage
 * (server-side), so it fills in automatically as the user actually uses PERSIS.
 * Hidden once dismissed or when every step is complete.
 */
export function OnboardingChecklist() {
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status");
      const json = await res.json();
      if (json.ok) setStatus(json.data);
    } catch {
      /* checklist is non-critical; fail silently */
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh when the tab regains focus so progress made in another view shows up.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function dismiss() {
    setDismissing(true);
    setHidden(true); // optimistic
    try {
      await fetch("/api/onboarding/status", { method: "POST" });
    } catch {
      setHidden(false); // revert if it failed
    } finally {
      setDismissing(false);
    }
  }

  if (!status || hidden || status.dismissed) return null;
  if (status.doneCount >= status.total) return null; // nothing left to teach

  const pct = Math.round((status.doneCount / status.total) * 100);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Getting started</h2>
          <span className="text-xs text-muted-foreground">{status.doneCount} of {status.total} done</span>
        </div>
        <button
          onClick={dismiss}
          disabled={dismissing}
          aria-label="Dismiss checklist"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ul className="space-y-1">
        {status.steps.map((step) => (
          <li key={step.key}>
            {step.done ? (
              <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground">
                <CheckCircle2 size={16} className="shrink-0 text-success" />
                <span className="line-through">{step.label}</span>
              </span>
            ) : (
              <Link
                href={step.href}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-primary/10"
              >
                <Circle size={16} className="shrink-0 text-muted-foreground" />
                <span className="font-medium">{step.label}</span>
                <ChevronRight size={14} className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
