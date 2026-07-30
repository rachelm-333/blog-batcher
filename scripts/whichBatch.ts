/**
 * whichBatch.ts — Shows, per business: the businesses.activeBatch pointer and the
 * actual article batches present (batchNumber → count + statuses). Resolves any
 * mismatch between "what batch the app shows" and "what batches of data exist".
 * Read-only. Run on Manus:  node --import tsx scripts/whichBatch.ts
 */
import { getDb } from "../server/db";
import { businesses, articles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const bizRows = await db
    .select({ id: businesses.id, name: businesses.name, activeBatch: businesses.activeBatch, currentStage: businesses.currentStage })
    .from(businesses);

  for (const b of bizRows) {
    const arts = await db
      .select({ batchNumber: articles.batchNumber, status: articles.status })
      .from(articles)
      .where(eq(articles.businessId, b.id));

    const byBatch = new Map<number, Record<string, number>>();
    for (const a of arts) {
      const bn = a.batchNumber ?? 1;
      const m = byBatch.get(bn) ?? {};
      m[a.status] = (m[a.status] ?? 0) + 1;
      byBatch.set(bn, m);
    }

    console.log(`\n▸ ${b.name} (id ${b.id})`);
    console.log(`    activeBatch (what the app shows): ${b.activeBatch ?? 1}    currentStage: ${b.currentStage}`);
    if (byBatch.size === 0) {
      console.log(`    article batches: none`);
    } else {
      for (const bn of [...byBatch.keys()].sort((a, z) => a - z)) {
        const counts = byBatch.get(bn)!;
        const summary = Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(", ");
        const total = Object.values(counts).reduce((a, z) => a + z, 0);
        console.log(`    Batch ${bn}: ${total} articles  (${summary})`);
      }
    }
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
