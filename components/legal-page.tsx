import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui";

export interface LegalSection {
  heading: string;
  body: React.ReactNode;
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
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
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <p className="mt-6 leading-7 text-muted-foreground">{intro}</p>

        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.heading}>
              <h2 className="text-xl font-semibold tracking-tight">
                {i + 1}. {s.heading}
              </h2>
              <div className="mt-3 space-y-3 leading-7 text-muted-foreground">{s.body}</div>
            </section>
          ))}
        </div>

        <p className="mt-14 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Questions about this {title.toLowerCase()}? Contact us at{" "}
          <a href="mailto:hub@persis.my" className="text-primary hover:underline">hub@persis.my</a>.
        </p>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} PERSIS. Tender intelligence for Malaysian contractors.</span>
          <div className="flex gap-6">
            <Link href="/help" className="hover:text-foreground">Help</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/disclaimer" className="hover:text-foreground">Disclaimer</Link>
            <a href="mailto:hub@persis.my" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
