/**
 * dumpGenErrors.ts — print the status + errorMessage for each article, to see
 * why generation failed. Read-only. Run on Manus:
 *   node --import tsx scripts/dumpGenErrors.ts
 */
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      status: articles.status,
      wordCount: articles.wordCount,
      generationAttempts: articles.generationAttempts,
      errorMessage: articles.errorMessage,
    })
    .from(articles);

  console.log(`\n${rows.length} articles:\n`);
  const byError = new Map<string, number>();
  for (const r of rows) {
    console.log(`[${r.status}] attempts=${r.generationAttempts ?? 0} — ${r.title ?? `Article ${r.id}`}`);
    if (r.errorMessage) {
      console.log(`    ERROR: ${r.errorMessage}`);
      const key = r.errorMessage.slice(0, 120);
      byError.set(key, (byError.get(key) ?? 0) + 1);
    }
  }
  console.log(`\n=== error summary ===`);
  if (byError.size === 0) console.log("(no error messages stored)");
  for (const [msg, count] of Array.from(byError.entries())) {
    console.log(`  ${count}× ${msg}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
