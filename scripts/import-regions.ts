/**
 * PERSIS — regional adjustment importer.
 *
 * Loads the JKR Jadual 1 (Peratusan Mengikut Kawasan) table into the
 * regional_adjustments collection. Idempotent (upsert per state+district).
 *
 * Usage:
 *   npx tsx scripts/import-regions.ts
 *   railway run npx tsx scripts/import-regions.ts   # production
 */
import { MongoClient } from "mongodb";
import table from "./data/jkh-elektrik-2023-regions.json";

async function main() {
  const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB ?? "persis";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection("regional_adjustments");
  await col.createIndex({ state: 1, district: 1 }, { unique: true });

  let n = 0;
  for (const r of table.regions) {
    await col.updateOne(
      { state: r.state, district: r.district },
      {
        $set: {
          state: r.state,
          district: r.district,
          pcts: { A: r.A, B: r.B, C: r.C, D: r.D },
          source: "JKR",
          sourceRef: table.sourceRef,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    n += 1;
  }
  console.log(`Imported ${n} regional adjustment rows (${table.sourceRef})`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
