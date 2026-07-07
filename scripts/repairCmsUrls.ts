/**
 * repairCmsUrls.ts — fix published posts whose cmsPostUrl was saved empty.
 *
 * Wix returns a post's URL as an object; older publishes stored it blank, which
 * makes the link resolver treat every post as "not live." This repairs the data
 * by fetching each published post's real URL from Wix — trying by stored post ID
 * first, then by slug — and saving it.
 *
 * Safe: only writes cmsPostUrl (and cmsPostId if found via slug). Bodies/status
 * untouched. Run on Manus:
 *   node --import tsx scripts/repairCmsUrls.ts
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles, integrations } from "../drizzle/schema";
import {
  decryptCredentials,
  resolveWixPublishedUrl,
  type WixCredentials,
} from "../server/cmsPublisher";

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
    })
    .from(articles)
    .where(eq(articles.status, "published"));

  const credsByBiz = new Map<number, WixCredentials | null>();
  async function wixCredsFor(businessId: number): Promise<WixCredentials | null> {
    if (credsByBiz.has(businessId)) return credsByBiz.get(businessId)!;
    const [integ] = await db!
      .select({ credentialsEncrypted: integrations.credentialsEncrypted })
      .from(integrations)
      .where(and(eq(integrations.businessId, businessId), eq(integrations.platform, "wix")))
      .limit(1);
    const creds = integ?.credentialsEncrypted ? decryptCredentials(integ.credentialsEncrypted) : null;
    const wc: WixCredentials | null = creds
      ? { apiKey: creds.apiKey ?? "", siteId: creds.siteId ?? "", memberId: creds.memberId ?? "" }
      : null;
    credsByBiz.set(businessId, wc);
    return wc;
  }

  let fixed = 0;
  let failed = 0;
  console.log(`\nRepairing ${rows.length} published post(s)…\n`);

  for (const r of rows) {
    if (r.cmsPostUrl) {
      console.log(`✓ ${r.title} — already has URL: ${r.cmsPostUrl}`);
      continue;
    }
    const wc = await wixCredsFor(r.businessId);
    if (!wc) {
      console.log(`✗ ${r.title} — no Wix credentials for business ${r.businessId}`);
      failed++;
      continue;
    }

    // Resolve by id → slug → title (title match is the reliable one).
    const resolved = await resolveWixPublishedUrl(wc, {
      postId: r.cmsPostId,
      slug: r.urlSlug,
      title: r.title,
    });
    const url = resolved.url;
    const foundId = resolved.id;

    if (url) {
      const upd: Record<string, string> = { cmsPostUrl: url };
      if (foundId && foundId !== r.cmsPostId) upd.cmsPostId = foundId;
      await db.update(articles).set(upd).where(eq(articles.id, r.id));
      console.log(`✓ ${r.title} — repaired → ${url}`);
      fixed++;
    } else {
      console.log(`✗ ${r.title} — Wix returned no URL (id: ${r.cmsPostId ?? "none"}, slug: ${r.urlSlug ?? "none"})`);
      failed++;
    }
  }

  console.log(`\nDone. Repaired ${fixed}, failed ${failed}.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
