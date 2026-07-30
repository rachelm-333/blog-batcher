/**
 * dumpSeo.ts — lists every article's SEO fields (slug, metaTitle, metaDescription,
 * focusKeyword) alongside its title + node keyword, and flags DUPLICATE slugs /
 * focus keywords across articles. Confirms whether SEO metadata is corrupted
 * (shared across posts) and how widely.
 * Read-only. Run on Manus:  node --import tsx scripts/dumpSeo.ts
 */
import { getDb } from "../server/db";
import { articles, articleNodes, keywords } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      level: articleNodes.level,
      slug: articles.urlSlug,
      metaTitle: articles.metaTitle,
      metaDescription: articles.metaDescription,
      focusKeyword: articles.focusKeyword,
      nodeKeyword: keywords.primaryKeyword,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .leftJoin(keywords, eq(keywords.articleNodeId, articleNodes.id));

  const slugCount = new Map<string, number>();
  const fkCount = new Map<string, number>();
  for (const r of rows) {
    if (r.slug) slugCount.set(r.slug, (slugCount.get(r.slug) ?? 0) + 1);
    if (r.focusKeyword) fkCount.set(r.focusKeyword, (fkCount.get(r.focusKeyword) ?? 0) + 1);
  }

  console.log("\nSEO fields per article (⚠ = duplicated across posts):\n");
  for (const r of rows) {
    const dupSlug = (slugCount.get(r.slug ?? "") ?? 0) > 1;
    const dupFk = (fkCount.get(r.focusKeyword ?? "") ?? 0) > 1;
    const mismatch = r.nodeKeyword && r.focusKeyword && r.nodeKeyword.toLowerCase() !== r.focusKeyword.toLowerCase();
    console.log(`▸ [${r.level}] ${r.title}`);
    console.log(`    slug:        ${r.slug}${dupSlug ? "   ⚠ DUP" : ""}`);
    console.log(`    focusKw:     ${r.focusKeyword}${dupFk ? "   ⚠ DUP" : ""}${mismatch ? `   (node keyword is: ${r.nodeKeyword})` : ""}`);
    console.log(`    metaTitle:   ${(r.metaTitle ?? "").slice(0, 70)}`);
    console.log(`    metaDesc:    ${(r.metaDescription ?? "").slice(0, 70)}`);
  }

  const dupSlugs = [...slugCount.entries()].filter(([, n]) => n > 1);
  const dupFks = [...fkCount.entries()].filter(([, n]) => n > 1);
  console.log(`\nDuplicate slugs: ${dupSlugs.map(([s, n]) => `${s}×${n}`).join(", ") || "none"}`);
  console.log(`Duplicate focus keywords: ${dupFks.map(([s, n]) => `${s}×${n}`).join(", ") || "none"}`);
  console.log(dupSlugs.length || dupFks.length
    ? "\n⚠ SEO metadata is shared across posts — needs repair (regenerate affected, or rebuild meta from each node's keyword)."
    : "\n✓ Every article has unique SEO metadata.");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
