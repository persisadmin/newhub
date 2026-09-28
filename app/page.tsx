import Link from "next/link";
import { FileSearch, Table2, LineChart, ShieldCheck, ArrowRight, Upload, Cpu, Flag, FileCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { PromoBanner } from "@/components/promo-banner";
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
      <PromoBanner />
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            PERSIS<span className="text-primary">.</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
            <a href="#comparison" className="hover:text-foreground">Why PERSIS</a>
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
          <Link href="/register"><Button size="lg">Analyze Tenders <ArrowRight size={16} /></Button></Link>
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

      {/* Before / after comparison */}
      <section id="comparison" className="py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight">What one tender really costs you today</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            The manual way feels free — until you count the hours, the errors and the missed tenders.
            Figures below are illustrative estimates for a typical mid-size tender.
          </p>
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
                {[
                  {
                    work: "Reading & extracting tender requirements",
                    before: "2–4 days of a QS or senior clerk reading, highlighting and re-typing — roughly RM 800–2,000 in labour per tender",
                    after: "Minutes. Tender number, agency, deadlines and requirements extracted automatically",
                  },
                  {
                    work: "Building the BOQ",
                    before: "Manual transcription into spreadsheets — every copied line is a chance for a typo in quantity or unit",
                    after: "Structured BOQ generated from the document itself, original wording preserved",
                  },
                  {
                    work: "Pricing every item",
                    before: "Phone calls to suppliers, old spreadsheets, gut feel — and nobody remembers where a rate came from",
                    after: "Your own price library + benchmark references, with the source shown for every number",
                  },
                  {
                    work: "Human error",
                    before: "One wrong rate on one line item can erase the margin on the whole job — discover it after award, and you pay for it",
                    after: "Missing prices, off-benchmark rates and unit mismatches are flagged for review before you submit",
                  },
                  {
                    work: "Tenders you never bid",
                    before: "When analysis takes days, you skip tenders you could have won — the most expensive cost is invisible",
                    after: "Analyse every tender that lands on your desk. Walk away from the bad ones by choice, not by capacity",
                  },
                ].map((r) => (
                  <tr key={r.work}>
                    <td className="px-5 py-4 font-medium align-top">{r.work}</td>
                    <td className="px-5 py-4 align-top text-muted-foreground">{r.before}</td>
                    <td className="px-5 py-4 align-top">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
            A single pricing mistake on a RM 500,000 tender can cost more than years of PERSIS.
            Create an account to see the packages.
          </p>
          <div className="mt-6 text-center">
            <Link href="/register"><Button size="lg">Create free account <ArrowRight size={16} /></Button></Link>
          </div>
        </div>
      </section>

      {/* Footer */}
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
