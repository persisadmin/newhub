import { Resend } from "resend";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Transactional email via Resend.
 *
 * When RESEND_API_KEY is not configured (local dev), emails are logged to the
 * server console instead of being sent — the app keeps working without a mail
 * provider. In production, set RESEND_API_KEY and EMAIL_FROM (a verified
 * domain sender, e.g. "PERSIS <noreply@persis.my>").
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Pre-rendered HTML body. Keep templates simple (table layout, inline CSS)
   *  for maximum client compatibility. */
  html: string;
  /** Plain-text fallback. */
  text: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<{ sent: boolean }> {
  const from = process.env.EMAIL_FROM || "PERSIS <onboarding@resend.dev>";
  const resend = getClient();
  if (!resend) {
    logger.warn("email.skipped (no RESEND_API_KEY)", { to, subject });
    console.log(`[persis] Email to ${to} — ${subject}\n${text}\n`);
    return { sent: false };
  }
  const { error } = await resend.emails.send({ from, to, subject, html, text });
  if (error) {
    // Never throw on email failure — a lost email must not break the request
    // (e.g. payment activation). Log and let the caller continue.
    logger.error("email.failed", { to, subject, error: error.message });
    return { sent: false };
  }
  logger.info("email.sent", { to, subject });
  return { sent: true };
}

/* ---------- templates ---------- */

const BRAND = "#0f766e"; // teal-700

function layout(title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
    <div style="background:${BRAND};padding:20px 28px">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px">PERSIS</span>
    </div>
    <div style="padding:28px;color:#18181b;font-size:14px;line-height:1.6">
      <h1 style="margin:0 0 16px;font-size:18px;font-weight:600">${title}</h1>
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px">
      PERSIS — Tender Analysis &amp; Pricing Intelligence · Malaysia
    </div>
  </div>
</body></html>`;
}

const BTN = `display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600`;

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = layout(
    "Reset your password",
    `<p>We received a request to reset the password for your PERSIS account.</p>
     <p style="margin:24px 0"><a href="${resetUrl}" style="${BTN}">Reset Password</a></p>
     <p style="color:#52525b;font-size:13px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email — your password won't change.</p>
     <p style="color:#a1a1aa;font-size:12px;word-break:break-all">Link not working? Paste this into your browser:<br>${resetUrl}</p>`
  );
  const text = `Reset your PERSIS password\n\nOpen this link within 1 hour:\n${resetUrl}\n\nIf you didn't request a reset, ignore this email.`;
  await sendEmail({ to, subject: "Reset your PERSIS password", html, text });
}

export async function sendPaymentReceiptEmail(
  to: string,
  opts: { planName: string; amountMyr: string; credits: number; providerRef: string }
): Promise<void> {
  const html = layout(
    "Payment confirmed",
    `<p>Thank you — your payment has been verified and your subscription is now active.</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
       <tr><td style="padding:8px 0;color:#71717a">Package</td><td style="padding:8px 0;text-align:right;font-weight:600">${opts.planName}</td></tr>
       <tr><td style="padding:8px 0;color:#71717a">Amount paid</td><td style="padding:8px 0;text-align:right;font-weight:600">RM ${opts.amountMyr}</td></tr>
       <tr><td style="padding:8px 0;color:#71717a">Credits granted</td><td style="padding:8px 0;text-align:right;font-weight:600">${opts.credits.toLocaleString()}</td></tr>
       <tr><td style="padding:8px 0;color:#71717a">Reference</td><td style="padding:8px 0;text-align:right;font-family:monospace;font-size:12px">${opts.providerRef}</td></tr>
     </table>
     <p>Your credits never expire and your subscription is active for the next 30 days. You can start processing tenders right away.</p>`
  );
  const text = `PERSIS payment confirmed\n\nPackage: ${opts.planName}\nAmount: RM ${opts.amountMyr}\nCredits: ${opts.credits}\nReference: ${opts.providerRef}\n\nYour subscription is active. Log in to start processing tenders.`;
  await sendEmail({ to, subject: `PERSIS — ${opts.planName} package activated`, html, text });
}

export async function sendTrialEndingEmail(
  to: string,
  opts: { name: string; couponCode: string; discountPct: number; couponHours: number; trialEndsAt: Date; couponExpiresAt: Date; subscribeUrl: string }
): Promise<void> {
  const fmt = (d: Date) => d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
  const html = layout(
    "Your free trial ends tomorrow",
    `<p>Hi ${opts.name},</p>
     <p>Your PERSIS free trial ends on <strong>${fmt(opts.trialEndsAt)}</strong>. After that, processing will pause until you subscribe to a credit package.</p>
     <p>To say thanks for trying PERSIS, here's <strong>${opts.discountPct}% off</strong> any credit package — valid for the next <strong>${opts.couponHours} hours</strong>:</p>
     <p style="margin:20px 0;text-align:center"><span style="display:inline-block;border:1px dashed ${BRAND};border-radius:8px;padding:10px 24px;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:${BRAND}">${opts.couponCode}</span></p>
     <p style="margin:24px 0;text-align:center"><a href="${opts.subscribeUrl}" style="${BTN}">Subscribe with ${opts.discountPct}% off</a></p>
     <p style="color:#52525b;font-size:13px">Enter the code at checkout. The offer expires ${fmt(opts.couponExpiresAt)} — after that, packages are full price.</p>`
  );
  const text = `Hi ${opts.name},\n\nYour PERSIS free trial ends ${fmt(opts.trialEndsAt)}. Processing will pause at expiry until you subscribe.\n\nGet ${opts.discountPct}% off any credit package (valid ${opts.couponHours} hours) with code:\n${opts.couponCode}\n\nSubscribe here: ${opts.subscribeUrl}\n`;
  await sendEmail({ to, subject: `Your PERSIS trial ends tomorrow — ${opts.discountPct}% off inside`, html, text });
}

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const base = getEnv().NEXTAUTH_URL;
  const html = layout(
    `Welcome to PERSIS, ${name}`,
    `<p>Your account is ready. PERSIS turns tender documents into priced Bills of Quantities — upload a tender, review the AI-matched prices, and export your submission pack.</p>
     <p style="margin:24px 0"><a href="${base}/login" style="${BTN}">Sign in to PERSIS</a></p>
     <p style="color:#52525b;font-size:13px">Need help? Reply to this email or contact hub@persis.my.</p>`
  );
  const text = `Welcome to PERSIS, ${name}!\n\nYour account is ready. Sign in: ${base}/login\n\nNeed help? hub@persis.my`;
  await sendEmail({ to, subject: "Welcome to PERSIS", html, text });
}
