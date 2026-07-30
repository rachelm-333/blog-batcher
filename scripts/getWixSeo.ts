/**
 * getWixSeo.ts — Reads a published/draft post back from Wix and prints its
 * seoData.tags, so we can see EMPIRICALLY whether our JSON-LD (FAQPage) script
 * tag was accepted and stored by Wix. Answers: is schema reaching Wix at all?
 * Read-only. Run on Manus:  node --import tsx scripts/getWixSeo.ts
 */
import { getDb } from "../server/db";
import { articles, articleNodes, integrations } from "../drizzle/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { decryptCredentials } from "../server/cmsPublisher";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  // A published pillar/cornerstone (should carry FAQPage schema) with a Wix post id.
  const rows = await db
    .select({
      businessId: articles.businessId,
      title: articles.title,
      level: articleNodes.level,
      cmsPostId: articles.cmsPostId,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .where(isNotNull(articles.cmsPostId));

  const target = rows.find((r) => (r.level === "pillar" || r.level === "cornerstone") && r.cmsPostId)
    ?? rows.find((r) => r.cmsPostId);
  if (!target?.cmsPostId) { console.error("✗ No published post with a cmsPostId found."); process.exit(1); }

  const [integ] = await db
    .select({ enc: integrations.credentialsEncrypted })
    .from(integrations)
    .where(and(eq(integrations.businessId, target.businessId), eq(integrations.platform, "wix")));
  if (!integ?.enc) { console.error("✗ No Wix integration."); process.exit(1); }
  const creds = decryptCredentials(integ.enc)!;
  const headers = { Authorization: creds.apiKey, "wix-site-id": creds.siteId, "Content-Type": "application/json" };

  console.log(`\nReading Wix SEO for: [${target.level}] ${target.title}\n  postId: ${target.cmsPostId}\n`);

  // Try the published post first (this is what renders), then the draft.
  for (const [label, url] of [
    ["published post", `https://www.wixapis.com/blog/v3/posts/${target.cmsPostId}?fieldsets=SEO`],
    ["draft post", `https://www.wixapis.com/blog/v3/draft-posts/${target.cmsPostId}`],
  ] as const) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    if (!res.ok) { console.log(`  ${label}: HTTP ${res.status} — ${text.slice(0, 160)}`); continue; }
    let seo: any;
    try { const d = JSON.parse(text); seo = (d.post ?? d.draftPost ?? {}).seoData; } catch { /* */ }
    if (!seo?.tags) { console.log(`  ${label}: no seoData.tags returned`); continue; }
    console.log(`  ${label}: ${seo.tags.length} tag(s)`);
    for (const t of seo.tags) {
      const isLd = t.type === "script" || /ld\+json/.test(JSON.stringify(t.props ?? {}));
      const preview = isLd ? String(t.children ?? "").slice(0, 80) : (t.children ?? JSON.stringify(t.props ?? {})).slice(0, 60);
      console.log(`    - type=${t.type}${isLd ? "  ← JSON-LD" : ""}  ${preview}`);
    }
    const hasFaq = JSON.stringify(seo.tags).includes("FAQPage");
    console.log(`  ⇒ FAQPage present in ${label}: ${hasFaq ? "YES ✓" : "NO ✗"}\n`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
