import Link from "next/link";
import { FileSearch, Table2, LineChart, ShieldCheck, ArrowRight, Upload, Cpu, Flag, FileCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui";

const FEATURES = [
  { icon: FileSearch, title: "Automated Tender Analysis", desc: "Upload tender documents and let PERSIS extract tender numbers, agencies, deadlines and requirements automatically." },
  { icon: Table2, title: "BOQ Generation", desc: "Material, work and labour requirements are structured into a clean Bill of Quantities, preserving original tender wording." },
  { icon: LineChart, title: "Pricing Intelligence", desc: "Contractor pricing, benchmark references and configurable hybrid strategies produce a transparent selected price per item." },
  { icon: Flag, title: "Review Flags", desc: "Missing prices, off-benchmark deviations, low-confidence matches and unit mismatches are flagged for human review." },
  { icon: ShieldCheck, title: "Full Audit Trail", desc: "Every upload, extraction, price override and payment is recorded. You always know where a number came from." },
  { icon: FileCheck, title: "Tender Preparation", desc: "Turn reviewed pricing into a commercially informed starting point for your tender submission." },
];

const PIPELINE = [
  { icon: Upload, label: "Upload Tender" },
  { icon: Cpu, label: "AI Extraction" },
  { icon: Table2, label: "Structured BOQ" },
  { icon: LineChart, label: "Pricing Intelligence" },
  { icon: Flag, label: "Review Flags" },
  { icon: FileCheck, label: "Tender Ready" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            PERSIS<span className="text-primary">.</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Get Started</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-24 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
          Built for Malaysian contractors
        </div>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Tender documents in. <span className="text-primary">Pricing intelligence</span> out.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          PERSIS converts unstructured tender documents into a structured Bill of Quantities with
          transparent, reviewable pricing — so you can prepare commercially informed tenders in a
          fraction of the time.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/register"><Button size="lg">Start analysing tenders <ArrowRight size={16} /></Button></Link>
          <a href="#workflow"><Button size="lg" variant="outline">See how it works</Button></a>
        </div>

        {/* Workflow visual */}
        <div id="workflow" className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map(({ icon: Icon, label }, i) => (
            <div key={label} className="relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4">
              <Icon className="text-primary" size={22} />
              <span className="text-xs font-medium">{label}</span>
              {i < PIPELINE.length - 1 && (
                <ArrowRight size={14} className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-muted-foreground lg:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border bg-muted/40 py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight">Everything a tender team needs</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            From document upload to a commercially reviewed price schedule.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-lg border border-border bg-card p-6">
                <Icon className="text-primary" size={24} />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight">Simple, transparent pricing</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Pay securely with Touch &rsquo;n Go eWallet QR. Upgrade, downgrade or cancel any time.
          </p>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {[
              { name: "Starter", price: "RM 99", period: "/month", features: ["10 tender projects / month", "BOQ extraction & generation", "Benchmark pricing", "Email support"], cta: "Start with Starter" },
              { name: "Professional", price: "RM 249", period: "/month", highlight: true, features: ["Unlimited tender projects", "Everything in Starter", "Hybrid pricing strategies", "Contractor price library", "Priority support"], cta: "Go Professional" },
              { name: "Enterprise", price: "RM 599", period: "/month", features: ["Everything in Professional", "Multi-user workspaces", "Custom benchmark integrations", "Dedicated support & onboarding"], cta: "Contact Sales" },
            ].map((p) => (
              <div key={p.name} className={`rounded-lg border p-8 ${p.highlight ? "border-primary bg-card shadow-md" : "border-border bg-card"}`}>
                {p.highlight && <span className="mb-2 inline-block rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">Most popular</span>}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-2 text-3xl font-bold">{p.price}<span className="text-sm font-normal text-muted-foreground">{p.period}</span></p>
                <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                  {p.features.map((f) => <li key={f} className="flex gap-2"><span className="text-primary">✓</span>{f}</li>)}
                </ul>
                <Link href="/register" className="mt-8 block">
                  <Button className="w-full" variant={p.highlight ? "default" : "outline"}>{p.cta}</Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} PERSIS. Tender intelligence for Malaysian contractors.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-foreground">Terms</a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
