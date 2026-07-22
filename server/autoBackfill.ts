/**
 * autoBackfill.ts — after any post publishes, automatically update the earlier
 * posts that link to it so their links go live (in place, no duplicate).
 *
 * Flow: repair any missing Wix URLs → find published posts whose links to
 * now-live posts can be switched on → re-resolve each body and re-push to Wix.
 *
 * Fail-safe: never throws (callers fire-and-forget). Wix only for now.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { articles, integrations } from "../drizzle/schema";
import { buildLinkMap, resolvePublishLinks } from "./articleEngine";
import { findBackfillTargets } from "../shared/backfillLinks";
import {
  decryptCredentials,
  updateWixPostBody,
  resolveWixPublishedUrl,
  type WixCredentials,
} from "./cmsPublisher";

export async function autoBackfillLinks(
  businessId: number,
  batchNumber: number,
): Promise<{ resynced: number; errors: number }> {
  try {
    const db = await getDb();
    if (!db) return { resynced: 0, errors: 0 };

    // Wix credentials (this runner supports Wix only for now).
    const [integ] = await db
      .select({ credentialsEncrypted: integrations.credentialsEncrypted })
      .from(integrations)
      .where(and(eq(integrations.businessId, businessId), eq(integrations.platform, "wix")))
      .limit(1);
    const creds = integ?.credentialsEncrypted ? decryptCredentials(integ.credentialsEncrypted) : null;
    if (!creds) return { resynced: 0, errors: 0 };
    const wixCreds: WixCredentials = {
      apiKey: creds.apiKey ?? "",
      siteId: creds.siteId ?? "",
      memberId: creds.memberId ?? "",
    };

    const batchRows = await db
      .select({
        id: articles.id,
        title: articles.title,
        urlSlug: articles.urlSlug,
        cmsPostId: articles.cmsPostId,
        cmsPostUrl: articles.cmsPostUrl,
        status: articles.status,
        publishedAt: articles.publishedAt,
        bodyHtml: articles.bodyHtml,
      })
      .from(articles)
      .where(and(eq(articles.businessId, businessId), eq(articles.batchNumber, batchNumber)));

    // Repair any missing cmsPostUrls so the link map is accurate.
    for (const r of batchRows) {
      if (r.status === "published" && !r.cmsPostUrl) {
        const resolved = await resolveWixPublishedUrl(wixCreds, {
          postId: r.cmsPostId,
          slug: r.urlSlug,
          title: r.title,
        });
        if (resolved.url) {
          r.cmsPostUrl = resolved.url;
          const upd: Record<string, string> = { cmsPostUrl: resolved.url };
          if (resolved.id && resolved.id !== r.cmsPostId) {
            upd.cmsPostId = resolved.id;
            r.cmsPostId = resolved.id;
          }
          await db.update(articles).set(upd).where(eq(articles.id, r.id));
        }
      }
    }

    const targets = findBackfillTargets(
      batchRows.map((r) => ({
        id: r.id,
        urlSlug: r.urlSlug,
        cmsPostId: r.cmsPostId,
        cmsPostUrl: r.cmsPostUrl,
        status: r.status,
        publishedAt: r.publishedAt ? r.publishedAt.getTime() : null,
        bodyHtml: r.bodyHtml,
      })),
    );
    if (targets.length === 0) return { resynced: 0, errors: 0 };

    const linkMap = buildLinkMap(batchRows);
    let resynced = 0;
    let errors = 0;
    for (const t of targets) {
      const row = batchRows.find((r) => r.id === t.articleId);
      if (!row || !row.cmsPostId) { errors++; continue; }
      let body = resolvePublishLinks(row.bodyHtml ?? "", linkMap).bodyHtml;
      body = body
        .replace(/<li>/g, '<li style="margin-bottom:0.75em">')
        .replace(/<li /g, '<li style="margin-bottom:0.75em" ');
      const res = await updateWixPostBody(wixCreds, row.cmsPostId, body);
      if (res.success) resynced++;
      else errors++;
    }
    if (resynced > 0 || errors > 0) {
      console.log(`[autoBackfill] business ${businessId} batch ${batchNumber}: re-synced ${resynced}, errors ${errors}`);
    }
    return { resynced, errors };
  } catch (err) {
    console.warn("[autoBackfill] failed:", err instanceof Error ? err.message : String(err));
    return { resynced: 0, errors: 0 };
  }
}
