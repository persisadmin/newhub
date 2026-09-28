import Link from "next/link";
import { Building2, MapPin, Phone, Mail } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, Card, CardContent } from "@/components/ui";

export const metadata = {
  title: "About Us — PERSIS",
  description: "PERSIS is built by PERSIS NEXUS SERVICES, a Malaysian company helping contractors win tenders with AI-powered document intelligence.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            PERSIS<span className="text-primary">.</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Get Started</Button></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">About PERSIS</h1>
        <p className="mt-6 leading-7 text-muted-foreground">
          PERSIS is tender intelligence for Malaysian contractors. We turn dense government tender
          documents into clear, actionable answers — extracting the BOQ, flagging pricing risks,
          and mapping every figure back to its source page — so contractors can price faster,
          bid more accurately, and protect their margins.
        </p>
        <p className="mt-4 leading-7 text-muted-foreground">
          We started PERSIS because we saw how much time and money contractors lose to manual
          extraction, transcription errors, and tenders they never had time to bid. What used to
          take days of skilled labour now takes minutes — with a full audit trail from every
          number back to the original document.
        </p>

        <h2 className="mt-12 text-xl font-semibold tracking-tight">The company behind PERSIS</h2>
        <Card className="mt-4">
          <CardContent className="space-y-4 pt-6 text-sm">
            <div className="flex items-start gap-3">
              <Building2 size={18} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-base font-semibold">PERSIS NEXUS SERVICES</p>
                <p className="text-muted-foreground">Registration No. 202603129636 (IP0625554-D)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={18} className="mt-0.5 shrink-0 text-primary" />
              <p className="text-muted-foreground">
                No 21, 02, Jalan Dato Jaafar 1,<br />
                Taman Dato Onn,<br />
                80350 Johor Bahru,<br />
                Johor Darul Ta&apos;zim, Malaysia
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Phone size={18} className="mt-0.5 shrink-0 text-primary" />
              <a href="tel:+60192966299" className="text-muted-foreground hover:text-foreground">019-296 6299</a>
            </div>
            <div className="flex items-start gap-3">
              <Mail size={18} className="mt-0.5 shrink-0 text-primary" />
              <a href="mailto:hub@persis.my" className="text-muted-foreground hover:text-foreground">hub@persis.my</a>
            </div>
          </CardContent>
        </Card>

        <p className="mt-10 text-sm text-muted-foreground">
          Have a question about PERSIS? Visit our <Link href="/help" className="text-primary hover:underline">Help Centre</Link> or
          email us — we reply within one business day.
        </p>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} PERSIS NEXUS SERVICES (202603129636). Tender intelligence for Malaysian contractors.</span>
          <div className="flex gap-6">
            <Link href="/about" className="hover:text-foreground">About</Link>
            <Link href="/help" className="hover:text-foreground">Help</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <a href="mailto:hub@persis.my" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
