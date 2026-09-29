import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui";
import { PACKAGE_LIST, formatPackagePrice } from "@/lib/packages";

/**
 * Reusable landing sections. Variants compose these with their own copy and
 * ordering, so the design language (spacing, borders, type scale) stays
 * consistent across variants and adding a new one stays cheap.
 */

export interface Cta {
  href: string;
  label: string;
}

type Icon = React.ComponentType<{ size?: number | string; className?: string }>;

/** Renders `#anchor` links as plain anchors (no client navigation needed). */
function CtaButton({ cta, variant, withArrow = true }: { cta: Cta; variant?: "default" | "outline"; withArrow?: boolean }) {
  const inner = (
    <Button size="lg" variant={variant}>
      {cta.label}
      {withArrow && variant !== "outline" && <ArrowRight size={16} />}
    </Button>
  );
  return cta.href.startsWith("#") ? <a href={cta.href}>{inner}</a> : <Link href={cta.href}>{inner}</Link>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h2 className="text-center text-3xl font-bold tracking-tight">{title}</h2>
      {subtitle && <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">{subtitle}</p>}
    </>
  );
}

/* ---------- Hero ---------- */

export function Hero({
  eyebrow,
  title,
  highlight,
  subtitle,
  primary,
  secondary,
  note,
  children,
}: {
  eyebrow?: string;
  title: string;
  highlight?: string;
  subtitle: string;
  primary: Cta;
  secondary?: Cta;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 text-center">
      {eyebrow && (
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          {eyebrow}
        </div>
      )}
      <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
        {title} {highlight && <span className="text-primary">{highlight}</span>}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">{subtitle}</p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <CtaButton cta={primary} />
        {secondary && <CtaButton cta={secondary} variant="outline" />}
      </div>
      {note && <p className="mt-5 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

/* ---------- Stat band ---------- */

export function StatBand({ stats, id }: { stats: { value: string; label: string }[]; id?: string }) {
  return (
    <section id={id} className="border-y border-border bg-muted/40 py-14">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">{s.value}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Pipeline strip ---------- */

export function PipelineStrip({ steps }: { steps: { icon: Icon; label: string }[] }) {
  return (
    <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map(({ icon: StepIcon, label }, i) => (
        <div key={label} className="relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4">
          <StepIcon className="text-primary" size={22} />
          <span className="text-center text-xs font-medium">{label}</span>
          {i < steps.length - 1 && (
            <ArrowRight size={14} className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-muted-foreground lg:block" />
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Feature grid ---------- */

export function FeatureGrid({
  title,
  subtitle,
  items,
  id,
}: {
  title: string;
  subtitle?: string;
  items: { icon: Icon; title: string; desc: string }[];
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-border bg-muted/40 py-24">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: ItemIcon, title: itemTitle, desc }) => (
            <div key={itemTitle} className="rounded-lg border border-border bg-card p-6">
              <ItemIcon className="text-primary" size={24} />
              <h3 className="mt-4 font-semibold">{itemTitle}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Numbered steps ---------- */

export function NumberedSteps({
  title,
  subtitle,
  steps,
  id,
}: {
  title: string;
  subtitle?: string;
  steps: { title: string; desc: string }[];
  id?: string;
}) {
  return (
    <section id={id} className="py-24">
      <div className="mx-auto max-w-4xl px-4">
        <SectionHeading title={title} subtitle={subtitle} />
        <ol className="mt-12 space-y-6">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-5 rounded-lg border border-border bg-card p-6">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Comparison table ---------- */

export function ComparisonTable({
  title,
  subtitle,
  rows,
  footnote,
  cta,
  id,
}: {
  title: string;
  subtitle?: string;
  rows: { work: string; before: string; after: string }[];
  footnote?: string;
  cta?: Cta;
  id?: string;
}) {
  return (
    <section id={id} className="py-24">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="mt-12 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-4 font-medium">The work</th>
                <th className="px-5 py-4 font-medium">The manual way</th>
                <th className="px-5 py-4 font-medium text-primary">With PERSIS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {rows.map((r) => (
                <tr key={r.work}>
                  <td className="px-5 py-4 font-medium align-top">{r.work}</td>
                  <td className="px-5 py-4 align-top text-muted-foreground">{r.before}</td>
                  <td className="px-5 py-4 align-top">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footnote && <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">{footnote}</p>}
        {cta && (
          <div className="mt-6 text-center">
            <CtaButton cta={cta} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- Package cards ---------- */

export function PricingCards({
  title,
  subtitle,
  footnote,
  id,
}: {
  title: string;
  subtitle?: string;
  footnote?: string;
  id?: string;
}) {
  return (
    <section id={id} className="border-t border-border bg-muted/40 py-24">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PACKAGE_LIST.map((p) => {
            const featured = p.key === "professional";
            return (
              <div
                key={p.key}
                className={`flex flex-col rounded-lg border bg-card p-6 ${featured ? "border-primary shadow-sm" : "border-border"}`}
              >
                {featured && <span className="mb-3 self-start rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Most popular</span>}
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-3 text-3xl font-bold tracking-tight">{formatPackagePrice(p.price)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.credits.toLocaleString()} credits · 30-day access</p>
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-primary" /> Analyse tenders immediately</li>
                  <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-primary" /> Credits never expire</li>
                  <li className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-primary" /> Full deliverable pack included</li>
                </ul>
                <div className="mt-6 pt-2">
                  <Link href="/register">
                    <Button className="w-full">Get started</Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        {footnote && <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">{footnote}</p>}
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */

export function Faq({
  title,
  subtitle,
  items,
  id,
}: {
  title: string;
  subtitle?: string;
  items: { q: string; a: string }[];
  id?: string;
}) {
  return (
    <section id={id} className="py-24">
      <div className="mx-auto max-w-3xl px-4">
        <SectionHeading title={title} subtitle={subtitle} />
        <div className="mt-10 divide-y divide-border rounded-lg border border-border bg-card">
          {items.map((it) => (
            <details key={it.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                <span className="mr-2 text-primary transition-transform group-open:rotate-90 inline-block">›</span>
                {it.q}
              </summary>
              <p className="mt-2 pl-5 text-sm text-muted-foreground">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */

export function FinalCta({ title, subtitle, primary, secondary }: { title: string; subtitle: string; primary: Cta; secondary?: Cta }) {
  return (
    <section className="border-t border-border bg-muted/40 py-20">
      <div className="mx-auto max-w-3xl px-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{subtitle}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <CtaButton cta={primary} />
          {secondary && <CtaButton cta={secondary} variant="outline" />}
        </div>
      </div>
    </section>
  );
}
