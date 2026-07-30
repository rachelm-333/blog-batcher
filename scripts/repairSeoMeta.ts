/**
 * repairSeoMeta.ts — Fixes articles whose SEO metadata (slug / focus keyword) got
 * duplicated across posts. The NODE keeps the correct slug + keyword; only the
 * article-level copies were corrupted. For each article we resync:
 *   - urlSlug      ← node.urlSlug (or generateSlug(primaryKeyword))
 *   - focusKeyword ← node.primaryKeyword
 * and, for any article that was wrong, rebuild:
 *   - metaTitle       ← the article title (≤60 chars, word boundary)
 *   - metaDescription ← the article's opening paragraph (≤155 chars)
 *
 * Dry run (default):   node --import tsx scripts/repairSeoMeta.ts
 * Apply changes:       node --import tsx scripts/repairSeoMeta.ts --confirm
 */
import { getDb } from "../server/db";
import { articles, articleNodes, keywords } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { generateSlug } from "../server/articleEngine";

function truncateAtBoundary(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "");
}

function firstParagraph(bodyHtml: string): string {
  const m = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const text = (m?.[1] ?? bodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return truncateAtBoundary(text, 155);
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }
  const apply = process.argv.includes("--confirm");

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      bodyHtml: articles.bodyHtml,
      slug: articles.urlSlug,
      metaTitle: articles.metaTitle,
      focusKeyword: articles.focusKeyword,
      nodeSlug: articleNodes.urlSlug,
      nodeKeyword: keywords.primaryKeyword,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .leftJoin(keywords, eq(keywords.articleNodeId, articleNodes.id));

  let fixed = 0;
  for (const r of rows) {
    const correctKeyword = (r.nodeKeyword ?? "").trim();
    if (!correctKeyword) { console.log(`  skip "${r.title}" — node has no keyword`); continue; }
    const correctSlug = (r.nodeSlug && r.nodeSlug.trim()) || generateSlug(correctKeyword);

    const slugWrong = (r.slug ?? "") !== correctSlug;
    const kwWrong = (r.focusKeyword ?? "").toLowerCase() !== correctKeyword.toLowerCase();
    if (!slugWrong && !kwWrong) continue; // already correct — leave meta untouched

    fixed++;
    const newMetaTitle = truncateAtBoundary(r.title ?? correctKeyword, 60);
    const newMetaDescription = firstParagraph(r.bodyHtml ?? "");

    console.log(`\n  FIX "${r.title}"`);
    console.log(`     slug:    ${r.slug}  →  ${correctSlug}`);
    console.log(`     focusKw: ${r.focusKeyword}  →  ${correctKeyword}`);
    console.log(`     metaTitle → ${newMetaTitle}`);
    console.log(`     metaDesc  → ${newMetaDescription.slice(0, 80)}…`);

    if (apply) {
      await db.update(articles).set({
        urlSlug: correctSlug,
        focusKeyword: correctKeyword,
        metaTitle: newMetaTitle,
        metaDescription: newMetaDescription,
      }).where(eq(articles.id, r.id));
    }
  }

  console.log(`\n${apply ? "Applied" : "Would fix"} ${fixed} article(s).`);
  if (!apply && fixed > 0) console.log("Re-run with --confirm to apply, then dumpSeo.ts to verify.");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
