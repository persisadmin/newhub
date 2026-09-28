import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Terms of Service — PERSIS",
  description: "The terms governing your use of the PERSIS platform.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="24 September 2026"
      intro="These Terms of Service (&quot;Terms&quot;) govern your access to and use of the PERSIS platform at persis.my, operated by PERSIS (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;). By creating an account or using the platform, you agree to these Terms. If you use the platform on behalf of a company, you represent that you are authorised to bind that company."
      sections={[
        {
          heading: "The service",
          body: (
            <>
              <p>PERSIS is a tender intelligence tool for Malaysian contractors. It converts uploaded tender documents into a structured Bill of Quantities, suggests prices using contractor data, published benchmark schedules and AI-assisted estimation, and flags items for human review.</p>
              <p><strong className="text-foreground">PERSIS is a decision-support tool, not a quantity surveyor.</strong> All extracted data, generated documents and suggested prices — including AI-assisted estimates — are starting points for your own professional review. You remain solely responsible for the accuracy and commercial soundness of any tender you submit.</p>
            </>
          ),
        },
        {
          heading: "Accounts and access",
          body: (
            <>
              <ul className="list-disc space-y-1 pl-6">
                <li>You must provide accurate registration information and keep your credentials confidential.</li>
                <li>You are responsible for all activity under your account.</li>
                <li>Access is granted per subscription plan; sharing accounts between organisations is not permitted.</li>
                <li>We may suspend accounts that breach these Terms or abuse the service.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "Subscriptions, billing and refunds",
          body: (
            <>
              <p>Paid plans are billed monthly in Malaysian Ringgit (RM) via Touch &rsquo;n Go eWallet. Subscriptions renew automatically until cancelled. You may upgrade, downgrade or cancel at any time; changes take effect at the next billing cycle, and we do not provide pro-rated refunds for partial months except where required by law.</p>
              <p>Prices shown on the platform are exclusive of any applicable taxes unless stated otherwise.</p>
            </>
          ),
        },
        {
          heading: "Your content",
          body: (
            <>
              <p>You retain all rights to the tender documents and data you upload. You grant us a limited licence to process that content solely to provide the service to you — including extraction, pricing analysis and document generation, which may involve transmission to third-party AI providers as described in our <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.</p>
              <p>You confirm that you have the right to upload the documents you submit and that doing so does not breach any confidentiality obligation owed to the tender issuer or any third party.</p>
            </>
          ),
        },
        {
          heading: "Acceptable use",
          body: (
            <>
              <p>You agree not to:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>Upload unlawful, defamatory or malicious content, or content you have no right to possess;</li>
                <li>Attempt to reverse-engineer, scrape or overload the platform;</li>
                <li>Circumvent usage limits, access controls or payment requirements;</li>
                <li>Use the platform to prepare submissions for unlawful purposes.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "Intellectual property",
          body: (
            <p>The platform, its design, software, and the PERSIS name and branding are our property. Benchmark schedules incorporated into the service (such as CIDB or JKR publications) remain the property of their respective publishers and are used for reference purposes.</p>
          ),
        },
        {
          heading: "Disclaimers and limitation of liability",
          body: (
            <>
              <p>The service is provided &quot;as is&quot; and &quot;as available&quot;. We do not warrant that extraction results, benchmark data or suggested prices are complete, current or error-free, nor that the service will be uninterrupted.</p>
              <p>To the maximum extent permitted by Malaysian law, our aggregate liability arising from or related to the service is limited to the fees you paid us in the three months preceding the claim. We are not liable for indirect or consequential losses, including lost profits, lost tenders or business interruption.</p>
            </>
          ),
        },
        {
          heading: "Termination",
          body: (
            <p>You may close your account at any time. We may terminate or suspend access for breach of these Terms, with notice where practicable. On termination, your right to use the service ends and we will delete or anonymise your data within a reasonable period, subject to legal retention requirements.</p>
          ),
        },
        {
          heading: "Governing law",
          body: (
            <p>These Terms are governed by the laws of Malaysia, and the courts of Malaysia have exclusive jurisdiction over any dispute arising from them.</p>
          ),
        },
      ]}
    />
  );
}
