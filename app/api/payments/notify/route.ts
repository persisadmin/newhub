import crypto from "node:crypto";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, ensureIndexes } from "@/lib/db";
import { ok, fail, handleError, getIp } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { confirmAndActivate } from "@/lib/services/payment";
import { extractAmountsSen } from "@/lib/services/duitnow";
import { logger } from "@/lib/logger";
import type { PaymentDoc, PaymentNotificationDoc } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/notify — payment-notification bridge.
 *
 * The merchant's phone (MacroDroid) forwards TNG eWallet payment-received
 * notifications here. Matching order: (1) the payment reference embedded in
 * the QR (tag 62) appearing in the notification text, (2) exact-amount match
 * against pending payments. Activates on an unambiguous match only.
 *
 * Auth: shared secret in the x-notify-key header (timing-safe compare).
 * No session is involved — the phone is not a logged-in user.
 */

const schema = z.object({
  text: z.string().min(5).max(2000),
  packageName: z.string().max(200).optional(),
  postedAt: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  try {
    const rl = rateLimit(`notify:${getIp(req)}`, 60, 60_000);
    if (!rl.allowed) return fail("Rate limited.", 429, "RATE_LIMITED");

    const secret = getEnv().PAYMENT_NOTIFY_SECRET;
    if (!secret) return fail("Notification bridge is not configured.", 503, "DISABLED");
    const key = req.headers.get("x-notify-key") ?? "";
    const a = Buffer.from(key);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return fail("Invalid notify key.", 401, "UNAUTHENTICATED");
    }

    const body = schema.parse(await req.json());
    const amountsSen = extractAmountsSen(body.text);
    await ensureIndexes();
    const db = await getDb();

    let matchedPaymentId: ObjectId | undefined;
    let activated = false;
    let note = "no_amount";

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingAll = await db
      .collection<PaymentDoc>("payments")
      .find({ status: { $in: ["qr_presented", "initiated"] }, createdAt: { $gte: since } })
      .toArray();

    // 1) Strongest signal: the payment reference (tag 62 in the QR) appearing
    //    verbatim in the notification text.
    const textUpper = body.text.toUpperCase();
    const byRef = pendingAll.filter((p) => p.providerRef && textUpper.includes(p.providerRef.toUpperCase()));
    if (byRef.length === 1) {
      matchedPaymentId = byRef[0]._id;
      const res = await confirmAndActivate(byRef[0].providerRef);
      activated = res.ok;
      note = res.ok ? "matched_by_reference" : `matched_but_${res.reason}`;
    } else if (byRef.length > 1) {
      note = "ambiguous_reference";
      logger.warn("payment.notify_ambiguous_ref", { candidates: byRef.length });
    } else if (amountsSen.length > 0) {
      // 2) Fallback: exact-amount match (customers pay the exact listed price).
      const pending = pendingAll.filter((p) => amountsSen.includes(p.amount));
      if (pending.length === 1) {
        matchedPaymentId = pending[0]._id;
        const res = await confirmAndActivate(pending[0].providerRef);
        activated = res.ok;
        note = res.ok ? "matched_by_amount" : `matched_but_${res.reason}`;
      } else {
        note = pending.length === 0 ? "no_pending_match" : "ambiguous_match";
        logger.warn("payment.notify_unmatched", { amountsSen, candidates: pending.length });
      }
    }

    await db.collection<PaymentNotificationDoc>("payment_notifications").insertOne({
      _id: new ObjectId(),
      text: body.text.slice(0, 2000),
      packageName: body.packageName,
      postedAt: body.postedAt ? new Date(body.postedAt) : undefined,
      amountsSen,
      matchedPaymentId,
      matched: activated,
      createdAt: new Date(),
    });

    return ok({ matched: activated, note }, activated ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
