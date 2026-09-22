import { ObjectId } from "mongodb";

export type Role = "contractor" | "admin" | "supplier" | "reviewer";

export interface UserDoc {
  _id: ObjectId;
  email: string;
  name: string;
  image?: string;
  passwordHash?: string; // absent for OAuth-only accounts
  role: Role;
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
  currentStage?: PipelineStage;
  stageUpdatedAt?: Date;
  processingError?: string;
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
  selectedPriceSource: "contractor" | "benchmark" | "hybrid" | "manual" | null;
  matchConfidence: number | null;
  reviewFlag: ReviewFlag;
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

export interface SubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  plan: "starter" | "professional" | "enterprise";
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
  createdAt: Date;
  updatedAt: Date;
  verifiedAt?: Date;
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
