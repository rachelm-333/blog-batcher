/**
 * dumpFaq.ts — show whether each published post's saved body actually contains
 * the FAQ Q&A, and print the FAQ section so we can see its exact structure.
 * Read-only. Run on Manus:  node --import tsx scripts/dumpFaq.ts
 */
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({ id: articles.id, title: articles.title, bodyHtml: articles.bodyHtml, faqItems: articles.faqItems })
    .from(articles)
    .where(eq(articles.status, "published"));

  for (const r of rows) {
    const body = r.bodyHtml ?? "";
    const faqItemCount = (body.match(/faq-item/gi) || []).length;
    const hasHeading = /frequently asked questions/i.test(body);
    console.log(`\n▸ ${r.title}`);
    console.log(`    has "Frequently Asked Questions" heading: ${hasHeading}`);
    console.log(`    faq-item div count: ${faqItemCount}`);
    console.log(`    faqItems column: ${r.faqItems ? JSON.stringify(r.faqItems).slice(0, 200) : "null"}`);
    const idx = body.toLowerCase().indexOf("frequently asked questions");
    if (idx >= 0) {
      console.log(`    FAQ section HTML (from heading, 800 chars):`);
      console.log("    " + body.slice(idx, idx + 800).replace(/\n/g, " "));
    }
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
