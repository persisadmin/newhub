"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { Button, Input, Label, Spinner } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a secure reset link">
      {sent ? (
        <div className="space-y-4">
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            If an account exists for {email}, a reset link is on its way. It expires in 1 hour.
          </p>
          <Link href="/login" className="block text-center text-sm text-primary hover:underline">Back to login</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>{loading && <Spinner />} Send reset link</Button>
          <p className="text-center text-sm text-muted-foreground">
            Remembered it? <Link href="/login" className="text-primary hover:underline">Log in</Link>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
