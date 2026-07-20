/**
 * repairFaqBodies.ts — fill the FAQ section of existing articles from their saved
 * faqItems column (the Q&A exists in faqItems but the body has empty faq shells).
 * Updates the stored bodyHtml so a re-sync/re-publish pushes the real FAQ to Wix.
 *
 * Dry run by default; --confirm to write. Run on Manus:
 *   node --import tsx scripts/repairFaqBodies.ts            # dry run
 *   node --import tsx scripts/repairFaqBodies.ts --confirm
 */
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { renderFaqIntoBody } from "../server/articleEngine";

const CONFIRMED = process.argv.includes("--confirm");

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({ id: articles.id, title: articles.title, bodyHtml: articles.bodyHtml, faqItems: articles.faqItems })
    .from(articles);

  let changed = 0;
  for (const r of rows) {
    const faqItems = r.faqItems as Array<{ question: string; answer: string }> | null;
    if (!faqItems || faqItems.length === 0) continue;
    const before = r.bodyHtml ?? "";
    const after = renderFaqIntoBody(before, faqItems);
    if (after !== before) {
      console.log(`${CONFIRMED ? "✓" : "would fix"}: ${r.title} (${faqItems.length} FAQ items)`);
      if (CONFIRMED) {
        await db.update(articles).set({ bodyHtml: after }).where(eq(articles.id, r.id));
      }
      changed++;
    }
  }

  console.log(`\n${CONFIRMED ? "Fixed" : "Would fix"} ${changed} article(s).`);
  if (!CONFIRMED) console.log("Dry run — re-run with --confirm to apply.\n");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
