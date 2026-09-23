/**
 * PERSIS — benchmark price importer.
 *
 * Loads a parsed JKH JSON file (from scripts/parse_jkh_pdf.py) into the
 * benchmark_prices collection, applying the same normalisation layer the
 * pricing engine uses at match time.
 *
 * Usage:
 *   npx tsx scripts/import-benchmarks.ts <file.json> --source JKR --ref "JKK Elektrik 2023" --date 2023-01-01
 *
 * Options:
 *   --source   Source agency label (default: "JKR")
 *   --ref      Source reference / book edition (default: JSON's sourceRef)
 *   --date     Effective date YYYY-MM-DD (default: today)
 *   --replace  Delete existing records with the same source+sourceRef first
 *
 * Run against production via: railway run npx tsx scripts/import-benchmarks.ts ...
 */
import fs from "node:fs";
import { MongoClient } from "mongodb";
import { normaliseDescription, normaliseUnit, classify } from "../lib/domain/pricing/normalise";

interface ParsedItem {
  itemNo: string;
  description: string;
  unit: string;
  price: number;
  section: string | null;
  group: string | null;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("Usage: npx tsx scripts/import-benchmarks.ts <file.json> --source JKR --ref <ref> --date <YYYY-MM-DD> [--replace]");
    process.exit(1);
  }
  const source = arg("--source") ?? "JKR";
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { sourceRef: string; items: ParsedItem[] };
  const sourceRef = arg("--ref") ?? parsed.sourceRef;
  const effectiveDate = new Date(arg("--date") ?? Date.now());
  const replace = process.argv.includes("--replace");

  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB ?? "persis";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection("benchmark_prices");

  if (replace) {
    const del = await col.deleteMany({ source, sourceRef });
    console.log(`Removed ${del.deletedCount} existing records for ${source} / ${sourceRef}`);
  }

  const now = new Date();
  const docs = parsed.items.map((it) => {
    // Compose a self-contained description: group context + item text.
    const description = it.group
      ? `${it.group} — ${it.description}`
      : it.description;
    const nd = normaliseDescription(description);
    const cat = classify(nd);
    return {
      description,
      normalisedDescription: nd,
      category: cat === "other" ? "process" : cat, // JKH rows are work rates (supply + install)
      unit: it.unit,
      normalisedUnit: normaliseUnit(it.unit) ?? it.unit,
      price: it.price,
      currency: "MYR",
      source,
      sourceRef,
      sourceItemNo: it.itemNo,
      section: it.section,
      effectiveDate,
      isSeedSample: false,
      createdAt: now,
    };
  });

  // Upsert on (source, sourceRef, section, sourceItemNo) so re-runs are idempotent.
  let upserted = 0;
  for (const doc of docs) {
    await col.updateOne(
      { source: doc.source, sourceRef: doc.sourceRef, section: doc.section, sourceItemNo: doc.sourceItemNo },
      { $set: doc },
      { upsert: true }
    );
    upserted += 1;
  }
  console.log(`Imported ${upserted} benchmark records from ${source} / ${sourceRef}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
