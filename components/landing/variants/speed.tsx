import { Cpu, Table2, LineChart, Flag, FileCheck, Upload, Clock, ShieldCheck } from "lucide-react";
import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, PipelineStrip, NumberedSteps, FeatureGrid, ComparisonTable, FinalCta } from "@/components/landing/sections";

/**
 * Variant 2 — "Bid More Tenders" (speed / throughput angle).
 *
 * Leads with time-to-submission and capacity: the argument is that analysis
 * time, not pricing skill, is what limits how many tenders a contractor bids.
 */

const PIPELINE = [
  { icon: Upload, label: "Upload Tender" },
  { icon: Cpu, label: "AI Extraction" },
  { icon: Table2, label: "Structured BOQ" },
  { icon: LineChart, label: "Pricing Intelligence" },
  { icon: Flag, label: "Review Flags" },
  { icon: FileCheck, label: "Tender Ready" },
];

export default function SpeedLanding() {
  return (
    <LandingShell
      variant="speed"
      nav={[
        { href: "#hows", label: "How it works" },
        { href: "#results", label: "Results" },
        { href: "#compare", label: "Compare" },
      ]}
    >
      <Hero
        eyebrow="For contractors bidding every week"
        title="Analysis in"
        highlight="minutes, not days."
        subtitle="Upload a tender in the morning and have a priced, reviewable Bill of Quantities before lunch. The bottleneck was never your pricing judgement — it was the re-typing, the phone calls and the spreadsheets."
        primary={{ href: "/register", label: "Analyse a tender" }}
        secondary={{ href: "#hows", label: "See how it works" }}
      >
        <PipelineStrip steps={PIPELINE} />
      </Hero>

      <StatBand
        id="results"
        stats={[
          { value: "Minutes", label: "Typical analysis time" },
          { value: "3×", label: "More tenders reviewed" },
          { value: "0", label: "Manual re-typing" },
          { value: "100%", label: "Of rates show their source" },
        ]}
      />

      <NumberedSteps
        id="hows"
        title="Three steps from document to decision"
        subtitle="You stay in control of the commercial call. PERSIS removes the clerical work in front of it."
        steps={[
          {
            title: "Upload the tender",
            desc: "PDF, Word or plain text — or photograph a hard copy with your phone. Scanned pages are OCR'd automatically, so a printed tender works as well as a digital one.",
          },
          {
            title: "Review the extraction",
            desc: "PERSIS structures the Bill of Quantities and prices each line from your own price library and benchmark references. Anything it isn't confident about is flagged rather than guessed at.",
          },
          {
            title: "Submit with confidence",
            desc: "Adjust anything that needs a human eye, then export. The price schedule, method statement, specifications and checklists are generated as a complete submission pack.",
          },
        ]}
      />

      <FeatureGrid
        title="Built to remove the slow parts"
        subtitle="Every step that used to consume a day of skilled time is automated — with the review points kept explicit."
        items={[
          { icon: Cpu, title: "Automatic extraction", desc: "Tender number, agency, closing date, scope and requirements read straight from the document." },
          { icon: Table2, title: "Structured BOQ", desc: "Materials, work and labour organised into a clean Bill of Quantities, preserving the tender's own wording." },
          { icon: LineChart, title: "Instant pricing", desc: "Each item matched against your contractor price library and benchmark references, with hybrid strategies where useful." },
          { icon: Clock, title: "Live progress", desc: "Watch each pipeline stage as it runs. No black box, no waiting for an email." },
          { icon: ShieldCheck, title: "Audit trail", desc: "Every upload, extraction and override recorded, so you can trace any figure back to its source." },
          { icon: FileCheck, title: "Deliverables generated", desc: "Priced BOQ workbook, method statement, specifications and checklists — ready to download and submit." },
        ]}
      />

      <ComparisonTable
        id="compare"
        title="Where the week actually goes"
        subtitle="Illustrative estimates for a typical mid-size tender. The manual figures are the hours your team already spends."
        rows={[
          {
            work: "Reading & extracting requirements",
            before: "2–4 days of a QS or senior clerk reading, highlighting and re-typing",
            after: "Minutes, extracted automatically",
          },
          {
            work: "Building the BOQ",
            before: "Manual transcription into spreadsheets — every line a chance for a typo",
            after: "Structured directly from the document, original wording preserved",
          },
          {
            work: "Pricing every item",
            before: "Phone calls to suppliers, old spreadsheets and gut feel",
            after: "Your price library and benchmarks applied in seconds",
          },
          {
            work: "Preparing the submission pack",
            before: "Rebuilding the same documents from scratch for every tender",
            after: "Generated for you: BOQ, price schedule, method statement, checklists",
          },
          {
            work: "Tenders bid per month",
            before: "Capped by how many documents your team can physically process",
            after: "Capped only by the tenders you choose to pursue",
          },
        ]}
        footnote="When analysis takes days, you skip tenders you could have won. That cost never appears on any invoice — which is exactly why it goes unnoticed."
        cta={{ href: "/register", label: "Create an account" }}
      />

      <FinalCta
        title="Stop choosing between thorough and fast."
        subtitle="Analyse every tender that lands on your desk, and walk away from the bad ones by choice rather than by capacity."
        primary={{ href: "/register", label: "Get started" }}
        secondary={{ href: "/login", label: "Log in" }}
      />
    </LandingShell>
  );
}
