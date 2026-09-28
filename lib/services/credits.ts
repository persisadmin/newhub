import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getProviderChain } from "@/lib/services/llm/settings";
import type { CreditLedgerDoc, SubscriptionDoc } from "@/lib/domain/types";

/**
 * Credit system.
 *
 * 1 credit = RM 1. Users buy credit packages (Starter / Professional /
 * Enterprise); each purchase also activates a 30-day subscription.
 * Only users with an ACTIVE subscription may upload or scan documents —
 * banked credits never expire but are unusable while the subscription lapses.
 *
 * Processing is charged on an ESTIMATE (computed before the pipeline runs,
 * since actual token spend is unknowable up front):
 *
 *   credits = ceil10( estTokens × providerPrice × usdToMyr × creditMultiplier )
 *
 * where creditMultiplier is the admin-editable "magic number" (default 6.7
 * during testing) covering infrastructure, margin and estimation error.
 * Every movement is an immutable entry in the `credit_ledger` collection.
 */

export interface ProviderPrice {
  /** Matches ProviderConfig.id in LLM settings ("kimi", "deepseek", "custom-…" or "default"). */
  providerId: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
}

export interface BillingSettings {
  /** The "magic number" — markup over raw AI cost. Default 6.7 (testing). */
  creditMultiplier: number;
  usdToMyr: number;
  prices: ProviderPrice[];
}

const BILLING_SETTINGS_ID = "billing";

export const DEFAULT_BILLING: BillingSettings = {
  creditMultiplier: 6.7,
  usdToMyr: 4.7,
  prices: [{ providerId: "default", inputUsdPerM: 0.5, outputUsdPerM: 2.5 }],
};

let billingCache: { value: BillingSettings; loadedAt: number } | null = null;

export async function getBillingSettings(): Promise<BillingSettings> {
  if (billingCache && Date.now() - billingCache.loadedAt < 30_000) return billingCache.value;
  const db = await getDb();
  const doc = await db.collection("settings").findOne({ _id: BILLING_SETTINGS_ID as never });
  const value: BillingSettings = doc
    ? {
        creditMultiplier: (doc as unknown as { creditMultiplier?: number }).creditMultiplier ?? DEFAULT_BILLING.creditMultiplier,
        usdToMyr: (doc as unknown as { usdToMyr?: number }).usdToMyr ?? DEFAULT_BILLING.usdToMyr,
        prices: ((doc as unknown as { prices?: ProviderPrice[] }).prices?.length
          ? (doc as unknown as { prices: ProviderPrice[] }).prices
          : DEFAULT_BILLING.prices),
      }
    : DEFAULT_BILLING;
  billingCache = { value, loadedAt: Date.now() };
  return value;
}

export async function saveBillingSettings(settings: BillingSettings): Promise<void> {
  const db = await getDb();
  await db.collection("settings").updateOne(
    { _id: BILLING_SETTINGS_ID as never },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
  billingCache = null;
}

/* ---------------- subscription gate ---------------- */

export async function getActiveSubscription(userId: ObjectId): Promise<SubscriptionDoc | null> {
  const db = await getDb();
  const sub = await db.collection<SubscriptionDoc>("subscriptions").findOne({ userId });
  if (!sub) return null;
  if (sub.status !== "active") return null;
  if (new Date(sub.currentPeriodEnd).getTime() <= Date.now()) return null;
  return sub;
}

export async function hasActiveSubscription(userId: ObjectId): Promise<boolean> {
  return (await getActiveSubscription(userId)) !== null;
}

/* ---------------- balance + ledger ---------------- */

export async function getCreditBalance(userId: ObjectId): Promise<number> {
  const db = await getDb();
  const agg = await db
    .collection<CreditLedgerDoc>("credit_ledger")
    .aggregate<{ total: number }>([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  return Math.round((agg[0]?.total ?? 0) * 10) / 10;
}

async function appendEntry(entry: Omit<CreditLedgerDoc, "_id" | "createdAt">): Promise<void> {
  const db = await getDb();
  const id = new ObjectId();
  await db.collection<CreditLedgerDoc>("credit_ledger").insertOne({ ...entry, _id: id, createdAt: new Date() });
  await audit({
    userId: entry.userId,
    action: `credits.${entry.type}`,
    entityType: "credit_ledger",
    entityId: id,
    newValue: { amount: entry.amount, reason: entry.reason, projectId: entry.projectId?.toString(), meta: entry.meta },
    source: "credits",
  });
}

export async function grantCredits(userId: ObjectId, amount: number, reason: string, paymentId?: ObjectId): Promise<void> {
  await appendEntry({ userId, type: "grant", amount, reason, paymentId });
}

export class InsufficientCreditsError extends Error {
  constructor(public balance: number, public needed: number) {
    super(`Insufficient credits: need ${needed}, have ${balance}.`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Deduct credits, throwing InsufficientCreditsError when the balance can't
 * cover it. The balance is re-checked inside the write so concurrent
 * deductions can't both succeed against the same credits.
 */
export async function deductCredits(
  userId: ObjectId,
  amount: number,
  reason: string,
  opts: { projectId?: ObjectId; attempt?: number; meta?: CreditLedgerDoc["meta"] } = {}
): Promise<number> {
  const balance = await getCreditBalance(userId);
  if (balance + 1e-9 < amount) throw new InsufficientCreditsError(balance, amount);
  await appendEntry({ userId, type: "deduction", amount: -amount, reason, ...opts });
  return Math.round((balance - amount) * 10) / 10;
}

export async function listCreditHistory(userId: ObjectId, limit = 50): Promise<CreditLedgerDoc[]> {
  const db = await getDb();
  return db
    .collection<CreditLedgerDoc>("credit_ledger")
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/* ---------------- cost estimation ---------------- */

export interface CostEstimate {
  credits: number;
  costUsd: number;
  usdToMyr: number;
  multiplier: number;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  provider: string;
  model: string;
  estimatedChars: number;
}

/**
 * Estimate the credit cost of processing a document, from its file size.
 * Text density of PDF/DOCX ≈ 8% of file bytes (text + zip compression);
 * plain text is ~1 char per byte. The pipeline re-reads the text in several
 * stages, so input tokens are multiplied by 3 passes.
 */
export async function estimateProcessingCost(input: {
  sizeBytes: number;
  contentType: string;
  filename: string;
}): Promise<CostEstimate> {
  const isPlain = input.contentType === "text/plain" || input.filename.toLowerCase().endsWith(".txt");
  const rawChars = isPlain ? input.sizeBytes : input.sizeBytes * 0.08;
  const estimatedChars = Math.min(600_000, Math.max(5_000, Math.round(rawChars)));

  const tokensIn = Math.round((estimatedChars / 4) * 3); // 3 pipeline passes
  const tokensOut = Math.round((estimatedChars / 4) * 1.2); // extraction + BOQ + narrative output

  const chain = await getProviderChain();
  const primary = chain[0];
  const billing = await getBillingSettings();
  const price =
    billing.prices.find((p) => primary && p.providerId === primary.id) ??
    billing.prices.find((p) => p.providerId === "default") ??
    DEFAULT_BILLING.prices[0];

  const costUsd = (tokensIn / 1e6) * price.inputUsdPerM + (tokensOut / 1e6) * price.outputUsdPerM;
  const rm = costUsd * billing.usdToMyr * billing.creditMultiplier;
  const credits = Math.max(1, Math.ceil(rm * 10) / 10); // 1 credit = RM 1, fractional allowed, min 1

  const estimate: CostEstimate = {
    credits,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    usdToMyr: billing.usdToMyr,
    multiplier: billing.creditMultiplier,
    estimatedTokensIn: tokensIn,
    estimatedTokensOut: tokensOut,
    provider: primary?.name ?? "unconfigured",
    model: primary?.model ?? "-",
    estimatedChars,
  };
  logger.info("credits.estimate", { ...estimate, sizeBytes: input.sizeBytes, filename: input.filename });
  return estimate;
}
