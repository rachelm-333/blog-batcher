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
import { articles, integrations } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { slugFromHref } from "../shared/slug";
import { decryptCredentials, getWixPostUrlById } from "../server/cmsPublisher";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("✗ No DATABASE_URL here. Run on Manus.");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: articles.id,
      businessId: articles.businessId,
      title: articles.title,
      status: articles.status,
      urlSlug: articles.urlSlug,
      cmsPostId: articles.cmsPostId,
      cmsPostUrl: articles.cmsPostUrl,
      bodyHtml: articles.bodyHtml,
    })
    .from(articles);

  // Load + cache Wix creds per business so we can test the live URL fetch.
  const wixCredsByBiz = new Map<number, { apiKey: string; siteId: string; memberId: string } | null>();
  async function wixCredsFor(businessId: number) {
    if (wixCredsByBiz.has(businessId)) return wixCredsByBiz.get(businessId)!;
    const [integ] = await db!
      .select({ credentialsEncrypted: integrations.credentialsEncrypted })
      .from(integrations)
      .where(and(eq(integrations.businessId, businessId), eq(integrations.platform, "wix")))
      .limit(1);
    const creds = integ?.credentialsEncrypted ? decryptCredentials(integ.credentialsEncrypted) : null;
    const wc = creds ? { apiKey: creds.apiKey ?? "", siteId: creds.siteId ?? "", memberId: creds.memberId ?? "" } : null;
    wixCredsByBiz.set(businessId, wc);
    return wc;
  }

  console.log(`\n=== ${rows.length} article(s) ===\n`);
  for (const r of rows) {
    console.log(`▸ ${r.title ?? `Article ${r.id}`}`);
    console.log(`    status:     ${r.status}`);
    console.log(`    our slug:   ${r.urlSlug ?? "(none)"}`);
    console.log(`    cmsPostId:  ${r.cmsPostId ?? "EMPTY"}`);
    console.log(`    cmsPostUrl: ${r.cmsPostUrl ?? "EMPTY"}`);
    // Live test: can we fetch the real URL from Wix using the stored post ID?
    if (r.status === "published" && r.cmsPostId && !r.cmsPostUrl) {
      const wc = await wixCredsFor(r.businessId);
      if (!wc) {
        console.log(`    Wix fetch:  (no Wix credentials for business ${r.businessId})`);
      } else {
        const fetched = await getWixPostUrlById(wc, r.cmsPostId);
        console.log(`    Wix fetch:  ${fetched ? fetched : "FAILED (empty — ID may be a draft id, not a post id)"}`);
      }
    }
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
