import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Privacy Policy — PERSIS",
  description: "How PERSIS collects, uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="24 September 2026"
      intro="PERSIS (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the PERSIS tender intelligence platform at persis.my. This policy explains what personal data we collect, why we collect it, how we protect it, and the rights you have under the Personal Data Protection Act 2010 (PDPA) of Malaysia."
      sections={[
        {
          heading: "Information we collect",
          body: (
            <>
              <p><strong className="text-foreground">Account information.</strong> When you register or sign in with Google, we receive your name, email address and profile identifier from the identity provider.</p>
              <p><strong className="text-foreground">Tender documents and project data.</strong> Documents you upload (PDF, DOCX, TXT, or camera scans), the bill of quantities, pricing records, overrides and notes you create within the platform.</p>
              <p><strong className="text-foreground">Payment information.</strong> Subscription payments are processed by Touch &rsquo;n Go eWallet. We receive transaction confirmations and references only — we never see or store your eWallet PIN or full payment credentials.</p>
              <p><strong className="text-foreground">Usage and technical data.</strong> Audit events (uploads, extractions, overrides, logins), IP addresses, browser type and timestamps, used for security and service improvement.</p>
            </>
          ),
        },
        {
          heading: "How we use your information",
          body: (
            <>
              <p>We use the information we collect to:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>Provide, operate and improve the PERSIS platform, including document extraction, BOQ generation and pricing analysis;</li>
                <li>Authenticate your account and enforce role-based access;</li>
                <li>Process subscriptions and payments;</li>
                <li>Maintain a complete audit trail of actions taken in your workspace;</li>
                <li>Respond to support requests and communicate service updates;</li>
                <li>Detect, prevent and investigate fraud, abuse or security incidents.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "AI processing of your documents",
          body: (
            <>
              <p>To extract tender information and suggest pricing, uploaded documents may be processed by third-party large language model providers (such as Moonshot AI, DeepSeek, Alibaba or Google) over encrypted connections, strictly for the purpose of delivering the service to you. Documents are not used to train these models where the provider offers such an opt-out, and we select providers whose terms prohibit retaining your content beyond the processing window.</p>
              <p>You can disable AI-powered stages at any time in the application settings; core upload and review features continue to work.</p>
            </>
          ),
        },
        {
          heading: "Data storage and security",
          body: (
            <>
              <p>Your data is stored in encrypted databases hosted on reputable cloud infrastructure. Uploaded files are stored with access controls, and all traffic between your browser and our servers is encrypted with TLS. Access to production data is restricted to authorised personnel on a need-to-know basis.</p>
              <p>We retain your project data for as long as your account is active. You may request deletion of your account and associated data at any time (see Section 7).</p>
            </>
          ),
        },
        {
          heading: "Sharing of information",
          body: (
            <>
              <p>We do not sell your personal data. We share data only with:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li><strong className="text-foreground">Service providers</strong> who help us operate the platform (cloud hosting, database, payment processing, AI inference), each bound by confidentiality obligations;</li>
                <li><strong className="text-foreground">Authorities</strong> where disclosure is required by Malaysian law or a valid legal process.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "Cookies",
          body: (
            <p>We use strictly necessary cookies for authentication sessions and security (CSRF protection). We do not use advertising or third-party tracking cookies.</p>
          ),
        },
        {
          heading: "Your rights under the PDPA",
          body: (
            <>
              <p>Under the Personal Data Protection Act 2010, you have the right to:</p>
              <ul className="list-disc space-y-1 pl-6">
                <li>Request access to the personal data we hold about you;</li>
                <li>Request correction of inaccurate or incomplete data;</li>
                <li>Withdraw consent to processing (which may limit service availability);</li>
                <li>Request deletion of your account and personal data.</li>
              </ul>
              <p>To exercise any of these rights, email <a href="mailto:hub@persis.my" className="text-primary hover:underline">hub@persis.my</a>. We respond within 21 days.</p>
            </>
          ),
        },
        {
          heading: "Changes to this policy",
          body: (
            <p>We may update this policy from time to time. Material changes will be announced in the application or by email, and the &quot;last updated&quot; date above will be revised. Continued use of the platform after changes take effect constitutes acceptance.</p>
          ),
        },
      ]}
    />
  );
}
