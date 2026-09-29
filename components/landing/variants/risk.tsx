import { AlertTriangle, ShieldCheck, Ruler, Search, History, TrendingUp } from "lucide-react";
import { LandingShell } from "@/components/landing/shell";
import { Hero, StatBand, FeatureGrid, ComparisonTable, FinalCta } from "@/components/landing/sections";

/**
 * Variant 3 — "Protect Your Margin" (risk / accuracy angle).
 *
 * Leads with the cost of a pricing mistake and the safeguards that catch it:
 * review flags, price provenance and the audit trail.
 */

export default function RiskLanding() {
  return (
    <LandingShell
      variant="risk"
      nav={[
        { href: "#safeguards", label: "Safeguards" },
        { href: "#cost", label: "Cost of error" },
        { href: "#compare", label: "Compare" },
      ]}
    >
      <Hero
        eyebrow="Margin protection for tender pricing"
        title="One wrong rate can"
        highlight="erase the margin on the whole job."
        subtitle="A single mispriced line item on a RM 500,000 tender can wipe out more than the job earns. PERSIS doesn't just price your tender — it tells you where it isn't sure, and where every number came from."
        primary={{ href: "/register", label: "Protect my next tender" }}
        secondary={{ href: "#safeguards", label: "See the safeguards" }}
      />

      <StatBand
        id="cost"
        stats={[
          { value: "5", label: "Flag types that catch weak prices" },
          { value: "±25%", label: "Off-benchmark deviation flagged" },
          { value: "100%", label: "Of overrides written to audit" },
          { value: "Every rate", label: "Carries its source" },
        ]}
      />

      <FeatureGrid
        id="safeguards"
        title="The safeguards that protect the number"
        subtitle="PERSIS never invents a price. When it can't stand behind a figure, it says so and hands the decision back to you."
        items={[
          {
            icon: AlertTriangle,
            title: "Missing prices are flagged",
            desc: "An item with no match in your price library or the benchmarks is reported as missing — never quietly priced at zero.",
          },
          {
            icon: TrendingUp,
            title: "Off-benchmark rates surfaced",
            desc: "Any rate that deviates significantly from the reference price is flagged for a second look before it reaches your submission.",
          },
          {
            icon: Search,
            title: "Weak matches marked",
            desc: "When a description only loosely matches a reference item, PERSIS tells you the confidence is low so you can confirm it is the same thing.",
          },
          {
            icon: Ruler,
            title: "Unit mismatches caught",
            desc: "If units can't be reconciled between the tender and the reference price, you find out while it's still cheap to fix.",
          },
          {
            icon: ShieldCheck,
            title: "Every price has a provenance",
            desc: "Contractor library, government benchmark, hybrid strategy, AI estimate or your own override — the source travels with the number.",
          },
          {
            icon: History,
            title: "Full audit trail",
            desc: "Every upload, extraction, override and payment is recorded. You can always answer 'where did this figure come from?'",
          },
        ]}
      />

      <ComparisonTable
        id="compare"
        title="Where pricing mistakes actually come from"
        subtitle="Most bad rates are not bad judgement — they are transcription errors, stale references and unmatched items nobody noticed."
        rows={[
          {
            work: "An item nobody priced",
            before: "Blank or zero rate slips into the submission unnoticed",
            after: "Flagged as missing and listed for review",
          },
          {
            work: "A rate that drifted from the market",
            before: "Discovered after award, when the margin is already gone",
            after: "Off-benchmark deviation flagged before you submit",
          },
          {
            work: "The wrong item matched",
            before: "A similar-looking description gets a similar-looking price",
            after: "Low-confidence matches marked so you can confirm",
          },
          {
            work: "Quantity or unit confusion",
            before: "Found during execution, after the contract is signed",
            after: "Unit mismatches reported at review time",
          },
          {
            work: "Explaining a number later",
            before: "Nobody remembers which spreadsheet or phone call it came from",
            after: "Every rate and override is recorded with its source",
          },
        ]}
        footnote="PERSIS assists — you decide. Human review is the point, not a failure of the system."
        cta={{ href: "/register", label: "Create an account" }}
      />

      <FinalCta
        title="Price your next tender like your margin depends on it."
        subtitle="Because it does. Review the exceptions instead of re-checking every line by hand."
        primary={{ href: "/register", label: "Get started" }}
        secondary={{ href: "/login", label: "Log in" }}
      />
    </LandingShell>
  );
}
