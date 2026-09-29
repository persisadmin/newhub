import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, ComparisonTable, PricingCards, Faq, FinalCta } from "@/components/landing/sections";

/**
 * Variant 4 — "The Commercial Case" (ROI angle).
 *
 * Leads with money and shows the packages inline — where the other variants
 * funnel to registration before revealing price, this one is price-transparent.
 * Useful as a paid-traffic landing page and as an honest A/B test of whether
 * showing pricing earlier converts better.
 */

export default function RoiLanding() {
  return (
    <LandingShell
      variant="roi"
      nav={[
        { href: "#maths", label: "The maths" },
        { href: "#packages", label: "Packages" },
        { href: "#faq", label: "FAQ" },
      ]}
    >
      <Hero
        eyebrow="The commercial case"
        title="One tender pays for"
        highlight="a year of PERSIS."
        subtitle="Analysing a mid-size tender by hand costs days of skilled time and roughly RM 800–2,000 in labour. PERSIS does it in minutes — and finds the pricing mistakes that quietly cost far more than the subscription."
        primary={{ href: "#packages", label: "See the packages" }}
        secondary={{ href: "#maths", label: "Check the maths" }}
        note="Package prices shown below. Figures for manual effort are illustrative estimates for a typical mid-size tender."
      />

      <StatBand
        stats={[
          { value: "RM 800–2,000", label: "Manual labour per tender" },
          { value: "From RM 299", label: "PERSIS packages" },
          { value: "1 credit = RM 1", label: "Nothing wasted" },
          { value: "Never", label: "Do credits expire" },
        ]}
      />

      <ComparisonTable
        id="maths"
        title="What one tender costs you today"
        subtitle="The manual way feels free because the cost is spread across salaries and evenings. Itemised, it doesn't look free."
        rows={[
          {
            work: "Reading & extracting requirements",
            before: "RM 800–2,000 of QS or senior clerk time per tender",
            after: "Minutes of processing",
          },
          {
            work: "Building the BOQ",
            before: "1–2 days of transcription, with typos to catch later",
            after: "Generated automatically from the document",
          },
          {
            work: "Pricing every item",
            before: "Hours of supplier calls and half-remembered rates",
            after: "Your price library and benchmarks applied in seconds",
          },
          {
            work: "A single mispriced line item",
            before: "Can exceed the profit on the entire job",
            after: "Flagged for review before you submit",
          },
          {
            work: "A tender you never bid",
            before: "Opportunity cost that never appears on any report",
            after: "Analyse it in minutes and decide by choice",
          },
        ]}
        footnote="PERSIS charges per tender processed, not per seat. You confirm the credit estimate before any work begins."
        cta={{ href: "#packages", label: "Choose a package" }}
      />

      <PricingCards
        id="packages"
        title="Straightforward packages"
        subtitle="Buy credits, process tenders. No per-seat licences and no annual lock-in."
        footnote="1 credit = RM 1. Credits never expire and are only spent when you process a tender — you see and confirm the estimated cost first. A 30-day subscription is required to upload and process tenders."
      />

      <Faq
        id="faq"
        title="Questions contractors ask before signing up"
        items={[
          {
            q: "Do credits expire?",
            a: "No. Credits never expire and are only consumed when you process a tender. You are shown the estimated credit cost and must confirm it before anything is deducted.",
          },
          {
            q: "How is the processing cost decided?",
            a: "It is based on the document's size and complexity, and shown to you as a credit estimate before you confirm. The amount is fixed at that point — there are no additional charges afterwards, even if the pipeline uses more AI capacity than estimated.",
          },
          {
            q: "Can I scan a hard-copy tender?",
            a: "Yes. On a phone or tablet, use Scan Tender to photograph the pages in order. PERSIS assembles them into a single PDF and runs OCR automatically, so a printed tender works as well as a digital one.",
          },
          {
            q: "Is my pricing data visible to other contractors?",
            a: "No. Your price library, projects and documents are private to your account. Every project-scoped request is checked against ownership, so another user cannot reach your data by guessing an ID.",
          },
          {
            q: "What if the extraction isn't perfect?",
            a: "Items PERSIS cannot confidently price are flagged for review rather than guessed at. You can override any price yourself, and every override is written to the audit log with its reason.",
          },
          {
            q: "Do I need to commit for a year?",
            a: "No. Each purchase activates a 30-day subscription alongside your credits. Credits remain yours, and you can top up whenever you have tenders to process.",
          },
        ]}
      />

      <FinalCta
        title="Try it on a real tender"
        subtitle="Create an account, process one of your own documents, and judge it against the hours it would have cost you."
        primary={{ href: "/register", label: "Create an account" }}
        secondary={{ href: "/login", label: "Log in" }}
      />
    </LandingShell>
  );
}
