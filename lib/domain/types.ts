import { ObjectId } from "mongodb";

export type Role = "contractor" | "admin" | "supplier" | "reviewer";

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  image?: string;
  passwordHash?: string; // absent for OAuth-only accounts
  role: Role;
  /** Set by OAuth providers (Google) — used to tell password vs OAuth-only accounts. */
  emailVerified?: Date | null;
  /** Optional profile details the user can fill in from Settings. */
  companyName?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postcode?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectStatus =
  | "draft"
  | "processing"
  | "awaiting_review"
  | "completed"
  | "archived";

export interface ProjectDoc {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  description?: string;
  status: ProjectStatus;
  tenderTitle?: string;
  tenderNumber?: string;
  tenderAgency?: string;
  tenderCategory?: string;
  closingDate?: Date;
  tenderValue?: number;
  regionState?: string;
  regionDistrict?: string;
  regionKumpulan?: "A" | "B" | "C" | "D";
  /** Profit markup (%) applied on top of selected cost prices at read time.
   *  Tender price = selectedPrice × (1 + pct/100). Undefined/null = no uplift. */
  profitMarginPct?: number | null;
  /** Contingency sum (%) applied on top of cost, before the profit margin.
   *  Tender price = selectedPrice × (1 + contingency/100) × (1 + margin/100). */
  contingencyPct?: number | null;
  currentStage?: PipelineStage;
  stageUpdatedAt?: Date;
  processingError?: string;
  strategyNarrative?: string;
  strategyNarrativeAt?: Date;
  strategyAudioParts?: number;
  /** One free retry per project: set after a failed first paid attempt is retried. */
  freeRetryUsed?: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export type PipelineStage =
  | "uploading"
  | "document_processing"
  | "text_extraction"
  | "tender_info_extraction"
  | "material_extraction"
  | "work_extraction"
  | "boq_generation"
  | "price_matching"
  | "pricing_analysis"
  | "strategy_narrative"
  | "document_generation"
  | "completed";

export interface TenderDocumentDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: ObjectId;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: Date;
}

export interface TenderExtractionDoc {
  _id: ObjectId;
  projectId: ObjectId;
  attempt: number;
  title?: string;
  tenderNumber?: string;
  agency?: string;
  category?: string;
  closingDate?: Date;
  rawTextLength: number;
  extractedAt: Date;
}

export interface BoqItemDoc {
  _id: ObjectId;
  projectId: ObjectId;
  itemNo: string;
  description: string;
  normalisedDescription: string;
  category: "material" | "process" | "labour" | "other";
  quantity: number | null;
  unit: string | null;
  normalisedUnit: string | null;
  createdAt: Date;
}

export type ReviewFlag =
  | "missing_price"
  | "off_benchmark"
  | "low_match_confidence"
  | "unit_mismatch"
  | "llm_estimate"
  | null;

export interface PricingRecordDoc {
  _id: ObjectId;
  itemId: ObjectId;
  projectId: ObjectId;
  description: string;
  normalisedDescription: string;
  category: string;
  quantity: number | null;
  unit: string | null;
  normalisedUnit: string | null;
  contractorPrice: number | null;
  contractorPriceSource: string | null;
  benchmarkPrice: number | null;
  benchmarkPriceSource: string | null;
  hybridPrice: number | null;
  selectedPrice: number | null;
  selectedPriceSource: "contractor" | "benchmark" | "hybrid" | "manual" | "llm_estimate" | null;
  matchConfidence: number | null;
  regionAdjustmentPct: number | null;
  reviewFlag: ReviewFlag;
  /** LLM pricing assist output (present only when Kimi assisted). */
  llmSuggestedPrice?: number | null;
  llmConfidence?: number | null;
  llmReasoning?: string | null;
  llmMatched?: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BenchmarkPriceDoc {
  _id: ObjectId;
  description: string;
  normalisedDescription: string;
  category: string;
  unit: string;
  normalisedUnit: string;
  price: number;
  currency: "MYR";
  source: string; // e.g. "JKR", "CIDB", "sample-seed"
  sourceRef?: string;
  effectiveDate?: Date;
  isSeedSample: boolean;
  createdAt: Date;
}

export interface ContractorPriceDoc {
  _id: ObjectId;
  userId: ObjectId;
  normalisedDescription: string;
  category: string;
  normalisedUnit: string;
  price: number;
  currency: "MYR";
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "none";

export type PriceSubmissionKind = "benchmark" | "quotation";
export type PriceSubmissionStatus = "pending_review" | "committed" | "discarded";

export interface PriceRow {
  description: string;
  unit: string;
  price: number;
}

/**
 * A submitted price document: admins upload government agency price lists
 * (→ benchmark_prices on commit), users upload supplier quotations
 * (→ their contractor_prices library on commit). Rows are LLM-extracted,
 * reviewed in the UI, then committed.
 */
export interface PriceSubmissionDoc {
  _id: ObjectId;
  kind: PriceSubmissionKind;
  userId: ObjectId;
  userEmail: string;
  /** Agency name (benchmark) or supplier name (quotation). */
  sourceName: string;
  effectiveDate?: Date;
  filename: string;
  rows: PriceRow[];
  status: PriceSubmissionStatus;
  committedRows?: number;
  createdAt: Date;
  committedAt?: Date;
}

export interface SubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  plan: "starter" | "professional" | "enterprise" | "trial";
  interval: "monthly" | "yearly";
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentStatus = "initiated" | "qr_presented" | "paid_pending_verify" | "verified" | "failed" | "expired";

export interface PaymentDoc {
  _id: ObjectId;
  userId: ObjectId;
  plan: string;
  interval: string;
  amount: number; // in sen (MYR cents)
  currency: "MYR";
  status: PaymentStatus;
  provider: string;
  providerRef: string;
  qrPayload?: string;
  /** Checkout method the customer chose (chip_* is the live processor). */
  method?: "chip_fpx" | "chip_duitnow_qr" | "payhalal" | "duitnow_qr";
  /** Gateway transaction/purchase id (Chip purchase id, PayHalal transaction id). */
  providerTransactionId?: string;
  /** PayHalal payment channel, e.g. "FPX" or "CC". */
  channel?: string;
  /** Package price (sen) — same as amount; customers pay the exact listed price. */
  baseAmount?: number;
  /** Legacy: random cents suffix used before tag-62 reference matching. */
  uniqueSen?: number;
  /** Coupon code redeemed for this payment (e.g. test coupon → RM0.10). */
  couponCode?: string;
  createdAt: Date;
  updatedAt: Date;
  verifiedAt?: Date;
}

/** Admin-managed coupon: overrides the package price (e.g. RM0.10 test purchases). */
export type CouponAudience = "all" | "starter" | "professional" | "enterprise" | "user";

export interface CouponDoc {
  _id: ObjectId;
  /** Uppercase coupon name, e.g. "MERDEKA30". Names may be reused, but never
   *  by two coupons whose active windows overlap. */
  code: string;
  /** Percentage discount off the package price (1–99). */
  discountPct: number;
  /** Active window. */
  startsAt: Date;
  endsAt: Date;
  /** Who may redeem: everyone, one package tier, or a specific user. */
  audience: CouponAudience;
  /** Lowercased email — required when audience = "user". */
  userEmail?: string;
  /** Max redemptions; null = unlimited. */
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  note?: string;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  /** Legacy field from the fixed-price coupon design (pre-percentage). */
  priceSen?: number;
}

/** Raw record of a payment notification forwarded from the merchant's phone. */
export interface PaymentNotificationDoc {
  _id: ObjectId;
  text: string;
  packageName?: string;
  postedAt?: Date;
  amountsSen: number[];
  matchedPaymentId?: ObjectId;
  matched: boolean;
  createdAt: Date;
}

export type CreditEntryType = "grant" | "deduction" | "refund" | "adjustment";

/** Immutable credit ledger entry. Balance is derived by summing `amount`. */
export interface CreditLedgerDoc {
  _id: ObjectId;
  userId: ObjectId;
  type: CreditEntryType;
  /** Signed credits: positive = grant/refund, negative = deduction. 1 credit = RM 1. */
  amount: number;
  reason: string;
  projectId?: ObjectId;
  paymentId?: ObjectId;
  attempt?: number;
  meta?: {
    estimatedTokensIn?: number;
    estimatedTokensOut?: number;
    costUsd?: number;
    usdToMyr?: number;
    multiplier?: number;
    provider?: string;
    model?: string;
    documentId?: string;
  };
  createdAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  userId: ObjectId | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  source: string;
  timestamp: Date;
}

export interface PasswordResetDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface ProcessingJobDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: ObjectId;
  documentId: ObjectId;
  attempt: number;
  stage: PipelineStage;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  startedAt: Date;
  finishedAt?: Date;
}
