import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata = { title: "Help & FAQ — PERSIS" };

const sections: LegalSection[] = [
  {
    heading: "Getting started",
    body: (
      <>
        <p><strong>What does PERSIS do?</strong> Upload a tender document (PDF, DOCX or TXT) and PERSIS extracts the tender details, builds a Bill of Quantities, matches prices against your contractor pricing and benchmark references, flags anything that needs human review, and generates a complete deliverable pack — plus an audio strategy briefing in Bahasa Melayu.</p>
        <p><strong>How do I process my first tender?</strong> Create a project, upload the tender document, then press <em>Process</em>. You&apos;ll see the credit cost estimate before anything is charged. A typical tender takes a few minutes — the progress bar shows each stage live.</p>
        <p><strong>Can I scan a hard-copy tender?</strong> Yes — on a phone or tablet, use <em>Scan Tender</em>. Photograph the pages in order (up to 30 per scan; longer documents can be scanned in two batches); PERSIS assembles them into a PDF and runs OCR automatically. Good light and a flat, full-frame page give the best results.</p>
      </>
    ),
  },
  {
    heading: "Credits & packages",
    body: (
      <>
        <p><strong>How do credits work?</strong> Processing a tender costs credits based on the estimated AI workload, shown to you for confirmation <em>before</em> anything is deducted. Credits never expire.</p>
        <p><strong>What does PERSIS cost?</strong> Package details are shown once you&apos;re logged in — create a free account to see them in Settings.</p>
        <p><strong>What if I run out of credits mid-way?</strong> Processing never stops halfway. If your balance can&apos;t cover a new tender, you&apos;ll be asked to top up first — every top-up adds credits on top of what you already have.</p>
        <p><strong>My processing failed — do I pay again to retry?</strong> No. Every project gets one free retry after a failed attempt, applied automatically.</p>
      </>
    ),
  },
  {
    heading: "Payments",
    body: (
      <>
        <p><strong>How do I pay?</strong> Choose a package in Settings, then pick <strong>Online banking (FPX)</strong> or <strong>DuitNow QR</strong>. You&apos;ll be taken to our secure payment page (Chip In Asia) to approve the FPX payment in your bank app or scan the QR with any Malaysian banking app or e-wallet. You always pay exactly the listed package price, and your credits activate automatically within seconds of the payment completing.</p>
        <p><strong>I paid but my credits haven&apos;t arrived.</strong> Activation is usually under a minute. If it takes longer, keep your payment confirmation and contact us — we can confirm and activate it manually from the admin panel right away.</p>
      </>
    ),
  },
  {
    heading: "Processing & results",
    body: (
      <>
        <p><strong>Where are my results?</strong> Open the project — the <em>Generated Deliverables</em> card holds every file (BOQ workbook, priced schedule, method statement and more) as downloads. The tabs below show tender info, BOQ, pricing and items flagged for review.</p>
        <p><strong>What are review flags?</strong> PERSIS flags items that need your judgement: missing prices, prices far from benchmark, low-confidence matches and unit mismatches. Nothing is hidden — you can override any price manually, and every override is recorded in the audit trail.</p>
        <p><strong>Can I trust the prices?</strong> PERSIS combines <em>your</em> contractor pricing with benchmark references and shows the source of every number. It is a decision-support tool, not a substitute for a qualified QS — final pricing responsibility stays with you.</p>
        <p><strong>What is the strategy briefing?</strong> A senior-contractor-style audio readout (in Bahasa Melayu) summarising the tender&apos;s risks, requirements and bidding considerations. Press play on the project page.</p>
      </>
    ),
  },
  {
    heading: "Account & data",
    body: (
      <>
        <p><strong>Is my tender data private?</strong> Yes. Documents are stored per-account, access is enforced server-side on every request, and we never use your tender content to train models. See the Privacy Policy for the full PDPA details.</p>
        <p><strong>How do I delete my data?</strong> Email us from your registered address and we&apos;ll remove your account, projects and documents.</p>
      </>
    ),
  },
  {
    heading: "Still stuck?",
    body: (
      <>
        <p>Email <a href="mailto:hub@persis.my" className="text-primary underline">hub@persis.my</a> — include your registered email and, for payment issues, your TNG receipt. We reply within a few hours during business hours (Mon–Sat, 9am–6pm MYT). Payment issues always get same-day attention.</p>
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <LegalPage
      title="Help & FAQ"
      updated="27 September 2026"
      intro="Answers to the questions contractors ask most about PERSIS — credits, payments, processing and results."
      sections={sections}
    />
  );
}
