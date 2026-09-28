import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Disclaimer — PERSIS",
  description: "Important notices about the nature and limits of PERSIS outputs.",
};

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="Disclaimer"
      updated="25 September 2026"
      intro="PERSIS uses automated extraction, published benchmark data and artificial intelligence to help you prepare tenders faster. This page explains, in plain terms, what that means — and what it does not mean."
      sections={[
        {
          heading: "Not professional advice",
          body: (
            <>
              <p>PERSIS is a decision-support tool. It is not a registered quantity surveyor, engineer, architect, or licensed consultant, and nothing it produces constitutes professional advice under Malaysian law.</p>
              <p>All outputs — extracted BOQ items, suggested prices, generated documents, and strategy briefings — must be reviewed and verified by a qualified person within your organisation before being relied upon or submitted.</p>
            </>
          ),
        },
        {
          heading: "AI-generated content",
          body: (
            <>
              <p>Parts of the service are produced by large language models. AI outputs can be incomplete, outdated, or incorrect — including confident-sounding errors. Specifically:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li><strong className="text-foreground">Extraction</strong> may miss or misread items in poorly scanned or unusually formatted documents;</li>
                <li><strong className="text-foreground">AI-estimated prices</strong> are indicative market estimates, not quotations — always marked for review with an &quot;AI estimate&quot; flag;</li>
                <li><strong className="text-foreground">Strategy briefings</strong> (including audio narration) are generalised professional narratives, not site-specific engineering instructions;</li>
                <li><strong className="text-foreground">Generated documents</strong> (SOW, checklists, schedules) are drafting aids requiring professional completion.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "Pricing and benchmark data",
          body: (
            <>
              <p>Benchmark rates are drawn from published Malaysian sources (such as JKR Jadual Kadar Kerja and related schedules) and your own contractor price library. Published rates carry their own effective dates and regional assumptions; market prices move with material costs, labour availability and monsoon-season logistics.</p>
              <p>Regional uplift percentages are indicative adjustments, not guarantees of current market levels. Verify all rates against fresh supplier quotations before pricing a live tender.</p>
            </>
          ),
        },
        {
          heading: "No guarantee of tender outcomes",
          body: (
            <p>Use of PERSIS does not guarantee tender acceptance, award, or compliance with any tender issuer&rsquo;s requirements. The decision to submit, and responsibility for the submission, rests entirely with you.</p>
          ),
        },
        {
          heading: "Your documents",
          body: (
            <p>You are responsible for ensuring you have the right to upload tender documents to the platform and that doing so does not breach confidentiality obligations to tender issuers or other parties. See our <a href="/terms" className="text-primary hover:underline">Terms of Service</a> and <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a> for details.</p>
          ),
        },
      ]}
    />
  );
}
