"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

interface PromoInfo { active: boolean; trialDays?: number; credits?: number; endsAt?: string }

/** Landing-page banner shown while a launch promotion is live. */
export function PromoBanner() {
  const [promo, setPromo] = useState<PromoInfo | null>(null);

  useEffect(() => {
    fetch("/api/promo")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setPromo(j.data); })
      .catch(() => {});
  }, []);

  if (!promo?.active) return null;
  const ends = promo.endsAt ? new Date(promo.endsAt).toLocaleDateString("en-MY", { day: "numeric", month: "long" }) : null;

  return (
    <div className="bg-primary px-4 py-2.5 text-center text-sm text-primary-foreground">
      <Sparkles size={14} className="mr-1.5 inline-block -mt-0.5" />
      <strong>Launch offer:</strong> sign up now and get {promo.trialDays} days of free access
      {promo.credits ? ` + ${promo.credits.toLocaleString()} free credits` : ""}
      {ends ? ` — until ${ends}.` : "."}
      <Link href="/register" className="ml-2 font-semibold underline underline-offset-2">Claim it</Link>
    </div>
  );
}
