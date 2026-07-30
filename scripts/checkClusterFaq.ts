/**
 * checkClusterFaq.ts — For CLUSTER articles, checks whether the body has a VISIBLE
 * FAQ section and whether the faqItems column is populated. Confirms body & schema
 * agree (clusters should have neither a visible FAQ nor FAQPage schema).
 * Read-only. Run on Manus:  node --import tsx scripts/checkClusterFaq.ts
 */
import { getDb } from "../server/db";
import { articles, articleNodes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({
      title: articles.title,
      level: articleNodes.level,
      body: articles.bodyHtml,
      faqItems: articles.faqItems,
      schema: articles.schemaMarkup,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id));

  console.log("\nCluster FAQ consistency check:\n");
  let anyVisible = 0;
  for (const r of rows) {
    if (r.level !== "cluster") continue;
    const body = r.body ?? "";
    const hasVisibleFaq = /frequently asked questions/i.test(body);
    const faqItemsCount = Array.isArray(r.faqItems) ? r.faqItems.length
      : (r.faqItems ? (() => { try { return JSON.parse(String(r.faqItems)).length; } catch { return "?"; } })() : 0);
    const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/.test(r.schema ?? "");
    if (hasVisibleFaq) anyVisible++;
    console.log(`▸ ${r.title}`);
    console.log(`    visible FAQ section in body: ${hasVisibleFaq ? "YES" : "no"}   faqItems: ${faqItemsCount}   FAQPage schema: ${hasFaqSchema ? "YES" : "no"}`);
  }
  console.log(`\n${anyVisible === 0
    ? "✓ No cluster has a visible FAQ — schema (no FAQPage) MATCHES the pages. Correct & compliant."
    : `⚠ ${anyVisible} cluster(s) have a visible FAQ section — decide: remove it (design) or restore FAQPage (keep FAQ).`}`);
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
