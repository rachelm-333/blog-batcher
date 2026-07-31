/**
 * regenerateMeta.ts — Rewrites weak meta titles/descriptions with proper SEO copy
 * via the LLM. A good meta description is a keyword-rich STATEMENT about the
 * article + brand (not the article's opening question/answer citation block).
 *
 * By default it only touches articles whose meta description is the first-paragraph
 * fallback left by repairSeoMeta (i.e. it starts with the article's opening line).
 * Pass --all to rewrite every article's meta. Pass --confirm to persist.
 *
 * Dry run:   node --import tsx scripts/regenerateMeta.ts
 * All:       node --import tsx scripts/regenerateMeta.ts --all
 * Apply:     node --import tsx scripts/regenerateMeta.ts --confirm   (add --all to do every one)
 */
import { getDb } from "../server/db";
import { articles, articleNodes, keywords, businesses } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeClaudeWithCost } from "../server/claudeLLM";

function firstParagraph(bodyHtml: string): string {
  const m = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const text = (m?.[1] ?? bodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 155);
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }
  const apply = process.argv.includes("--confirm");
  const all = process.argv.includes("--all");

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      bodyHtml: articles.bodyHtml,
      metaTitle: articles.metaTitle,
      metaDescription: articles.metaDescription,
      focusKeyword: articles.focusKeyword,
      nodeKeyword: keywords.primaryKeyword,
      businessName: businesses.name,
      userId: businesses.userId,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .leftJoin(keywords, eq(keywords.articleNodeId, articleNodes.id))
    .leftJoin(businesses, eq(businesses.id, articles.businessId));

  let done = 0;
  for (const r of rows) {
    const keyword = (r.focusKeyword || r.nodeKeyword || "").trim();
    if (!keyword) { continue; }

    // Target: the weak fallback (meta desc == article's opening paragraph), unless --all.
    const fallbackDesc = firstParagraph(r.bodyHtml ?? "");
    const isFallback = (r.metaDescription ?? "").trim().slice(0, 120) === fallbackDesc.slice(0, 120);
    if (!all && !isFallback) continue;

    const bodyText = (r.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
    const prompt = `Write SEO metadata for this blog article.

Business/brand: ${r.businessName ?? "the business"}
Article title: ${r.title}
Primary focus keyword: ${keyword}
Article excerpt: ${bodyText}

Requirements:
- metaTitle: max 60 characters, include the focus keyword naturally, compelling.
- metaDescription: 150-160 characters. It MUST be a STATEMENT (never a question), naturally include the focus keyword "${keyword}", clearly say what the article covers and the value the reader gets, and reflect the brand where natural. Action-oriented, no clickbait.

Output ONLY valid JSON, no code fences:
{"metaTitle": "...", "metaDescription": "..."}`;

    let content = "";
    try {
      const res = await invokeClaudeWithCost(
        { messages: [
          { role: "system", content: "You are an expert SEO copywriter. Output only the requested JSON." },
          { role: "user", content: prompt },
        ], max_tokens: 400 },
        { userId: r.userId ?? undefined, feature: "seo_analysis" }
      );
      content = res.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      console.log(`  ✗ LLM failed for "${r.title}": ${String(e).slice(0, 80)}`);
      continue;
    }

    let parsed: { metaTitle?: string; metaDescription?: string };
    try {
      parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
    } catch {
      console.log(`  ✗ Could not parse LLM output for "${r.title}"`);
      continue;
    }
    const newTitle = (parsed.metaTitle ?? r.metaTitle ?? "").slice(0, 60);
    const newDesc = (parsed.metaDescription ?? "").slice(0, 160);
    if (!newDesc) { console.log(`  ✗ Empty description for "${r.title}"`); continue; }

    done++;
    console.log(`\n  ${apply ? "FIX" : "would fix"} "${r.title}"`);
    console.log(`     metaTitle → ${newTitle}`);
    console.log(`     metaDesc  → ${newDesc}`);

    if (apply) {
      await db.update(articles)
        .set({ metaTitle: newTitle, metaDescription: newDesc })
        .where(eq(articles.id, r.id));
    }
  }

  console.log(`\n${apply ? "Applied" : "Would update"} ${done} article(s).${!apply && done ? "  Re-run with --confirm to apply." : ""}`);
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
