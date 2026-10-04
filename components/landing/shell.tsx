import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { PromoBanner } from "@/components/promo-banner";
import { SocialLinks } from "@/components/landing/social-links";
import { Button } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Shared chrome for every landing variant: promo banner, sticky header and
 * footer. Variants supply only their body content plus their own nav anchors.
 *
 * The footer (legal links, company registration number) is owned here on
 * purpose — if each variant carried its own copy, they would drift and the
 * compliance details would eventually be missing from one of them.
 *
 * `data-landing-variant` is set so analytics can attribute conversions to the
 * variant that was live when the visitor arrived.
 */
export function LandingShell({
  variant,
  nav,
  children,
}: {
  variant: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background" data-landing-variant={variant}>
      <PromoBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            PERSIS<span className="text-primary">.</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} PERSIS NEXUS SERVICES (202603129636). Tender intelligence for Malaysian contractors.</span>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
            <SocialLinks />
            <div className="flex gap-6">
              <Link href="/about" className="hover:text-foreground">About</Link>
              <Link href="/help" className="hover:text-foreground">Help</Link>
              <Link href="/terms" className="hover:text-foreground">Terms</Link>
              <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
              <Link href="/disclaimer" className="hover:text-foreground">Disclaimer</Link>
              <a href="mailto:hub@persis.my" className="hover:text-foreground">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
