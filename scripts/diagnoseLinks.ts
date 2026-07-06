/**
 * diagnoseLinks.ts — print the exact internal-link state for every article, so
 * we can see why backfill does/doesn't fire, with no UI or cache in the way.
 *
 * For each article it shows: status, our internal slug, the REAL CMS URL we
 * captured (or EMPTY), and every internal <a href> found in its body with the
 * slug we extract from it.
 *
 * Read-only. Run on the deployment (Manus) where DATABASE_URL is set:
 *   node --import tsx scripts/diagnoseLinks.ts
 */
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { slugFromHref } from "../shared/slug";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("✗ No DATABASE_URL here. Run on Manus.");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      status: articles.status,
      urlSlug: articles.urlSlug,
      cmsPostId: articles.cmsPostId,
      cmsPostUrl: articles.cmsPostUrl,
      bodyHtml: articles.bodyHtml,
    })
    .from(articles);

  console.log(`\n=== ${rows.length} article(s) ===\n`);
  for (const r of rows) {
    console.log(`▸ ${r.title ?? `Article ${r.id}`}`);
    console.log(`    status:     ${r.status}`);
    console.log(`    our slug:   ${r.urlSlug ?? "(none)"}`);
    console.log(`    cmsPostId:  ${r.cmsPostId ?? "EMPTY"}`);
    console.log(`    cmsPostUrl: ${r.cmsPostUrl ?? "EMPTY"}`);
    const body = r.bodyHtml ?? "";
    const hrefs: string[] = [];
    const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      hrefs.push(`${m[1]}   →slug: ${slugFromHref(m[1]) ?? "—"}`);
    }
    if (hrefs.length) {
      console.log(`    links in body:`);
      for (const h of hrefs) console.log(`      ${h}`);
    } else {
      console.log(`    links in body: (none)`);
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
