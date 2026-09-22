import { MongoClient, Db, Document } from "mongodb";
import { getEnv } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __persisMongo: Promise<MongoClient> | undefined;
}

function clientPromise(): Promise<MongoClient> {
  if (global.__persisMongo) return global.__persisMongo;
  const uri = getEnv().MONGODB_URI;
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  global.__persisMongo = client.connect();
  return global.__persisMongo;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise();
  return client.db(getEnv().MONGODB_DB);
}

export async function col<T extends Document>(name: string) {
  const db = await getDb();
  return db.collection<T>(name);
}

let indexesEnsured = false;

/** Idempotent index bootstrap, called lazily on first DB use in the server process. */
export async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;
  indexesEnsured = true;
  const db = await getDb();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("projects").createIndex({ userId: 1, status: 1 }),
    db.collection("projects").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("tender_documents").createIndex({ projectId: 1 }),
    db.collection("tender_extractions").createIndex({ projectId: 1, attempt: -1 }),
    db.collection("boq_items").createIndex({ projectId: 1 }),
    db.collection("pricing_records").createIndex({ projectId: 1 }),
    db.collection("pricing_records").createIndex({ itemId: 1 }, { unique: true }),
    db.collection("pricing_records").createIndex({ projectId: 1, reviewFlag: 1 }),
    db.collection("benchmark_prices").createIndex({ normalisedDescription: 1 }),
    db.collection("benchmark_prices").createIndex({ normalisedUnit: 1 }),
    db.collection("contractor_prices").createIndex({ userId: 1, normalisedDescription: 1 }),
    db.collection("subscriptions").createIndex({ userId: 1 }, { unique: true }),
    db.collection("payments").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("payments").createIndex({ providerRef: 1 }, { unique: true }),
    db.collection("audit_logs").createIndex({ entityType: 1, entityId: 1, timestamp: -1 }),
    db.collection("audit_logs").createIndex({ userId: 1, timestamp: -1 }),
    db.collection("password_resets").createIndex({ tokenHash: 1 }),
    db.collection("password_resets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("processing_jobs").createIndex({ projectId: 1, attempt: -1 }),
  ]);
}
