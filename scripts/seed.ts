/**
 * Seed script: benchmark price library + a demo contractor price library.
 *
 * IMPORTANT: benchmark entries below are SAMPLE development data (isSeedSample: true)
 * for exercising the pricing engine. Replace with licensed JKR/CIDB data in production.
 *
 * Run: npx tsx scripts/seed.ts
 */
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import { normaliseDescription, normaliseUnit, classify } from "../lib/domain/pricing/normalise";

const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB ?? "persis";

const BENCHMARKS: Array<[string, string, number, string]> = [
  // [description, unit, price MYR, source]
  ["Ordinary Portland Cement 50kg bag", "bag", 21.50, "JKR sample"],
  ["Ready-mix reinforced concrete Grade 30", "m3", 420.00, "JKR sample"],
  ["High tensile steel reinforcement bar 10mm", "kg", 3.60, "JKR sample"],
  ["High tensile steel reinforcement bar 12mm", "kg", 3.55, "JKR sample"],
  ["Mild steel round bar 10mm", "kg", 3.40, "JKR sample"],
  ["BRC welded mesh A6", "m2", 6.80, "CIDB sample"],
  ["Washed river sand", "m3", 65.00, "CIDB sample"],
  ["Crusher run aggregate 50mm", "m3", 58.00, "CIDB sample"],
  ["Concrete common clay bricks", "no", 0.55, "CIDB sample"],
  ["Cement sand brick", "no", 0.48, "CIDB sample"],
  ["uPVC pipe 110mm diameter", "m", 18.50, "JKR sample"],
  ["Galvanised iron pipe 25mm", "m", 22.00, "JKR sample"],
  ["Plywood formwork 12mm", "m2", 14.50, "JKR sample"],
  ["Roofing tiles concrete", "m2", 38.00, "CIDB sample"],
  ["Emulsion paint interior", "litre", 12.00, "CIDB sample"],
  ["Excavation in ordinary soil", "m3", 18.00, "JKR sample"],
  ["Backfilling and compaction", "m3", 15.00, "JKR sample"],
  ["Plastering to walls 12mm thick", "m2", 16.50, "JKR sample"],
  ["Screeding to floors 25mm", "m2", 12.00, "JKR sample"],
  ["Waterproofing membrane torch-on", "m2", 28.00, "JKR sample"],
  ["General construction labourer", "day", 110.00, "CIDB sample"],
  ["Skilled craftsman mason", "day", 180.00, "CIDB sample"],
  ["Site supervisor foreman", "day", 220.00, "CIDB sample"],
  ["Excavator operator", "day", 250.00, "CIDB sample"],
];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  console.log(`Seeding ${dbName}…`);

  // Benchmark prices
  await db.collection("benchmark_prices").deleteMany({ isSeedSample: true });
  await db.collection("benchmark_prices").insertMany(
    BENCHMARKS.map(([description, unit, price, source]) => ({
      description,
      normalisedDescription: normaliseDescription(description),
      category: classify(normaliseDescription(description)),
      unit,
      normalisedUnit: normaliseUnit(unit) ?? unit,
      price,
      currency: "MYR",
      source,
      sourceRef: "sample-seed",
      effectiveDate: new Date(),
      isSeedSample: true,
      createdAt: new Date(),
    }))
  );
  console.log(`  ${BENCHMARKS.length} benchmark prices (sample seed data)`);

  // Demo user (email: demo@persis.my, password: Demo1234)
  const email = "demo@persis.my";
  const existing = await db.collection("users").findOne({ email });
  let userId = existing?._id;
  if (!existing) {
    const res = await db.collection("users").insertOne({
      email,
      name: "Demo Contractor",
      passwordHash: await bcrypt.hash("Demo1234", 12),
      role: "contractor",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userId = res.insertedId;
    console.log("  demo user created (demo@persis.my / Demo1234)");
  }

  // Demo contractor price library
  await db.collection("contractor_prices").deleteMany({ userId, source: "seed-library" });
  await db.collection("contractor_prices").insertMany(
    ([
      ["OPC Cement 50 KG", "bag", 20.80],
      ["Concrete G30 ready mix", "m3", 435.00],
      ["Steel reinforcement bar Y10", "kg", 3.75],
      ["Sand washed", "m3", 62.00],
      ["General labourer", "day", 120.00],
    ] as Array<[string, string, number]>).map(([description, unit, price]) => ({
      userId,
      description,
      normalisedDescription: normaliseDescription(description),
      category: classify(normaliseDescription(description)),
      normalisedUnit: normaliseUnit(unit) ?? unit,
      price,
      currency: "MYR",
      source: "seed-library",
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  console.log("  contractor price library seeded");

  await client.close();
  console.log("Seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
