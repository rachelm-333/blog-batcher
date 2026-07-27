/**
 * publishLinkResolver.ts — single entry point for resolving an article body's
 * internal links at publish time, with the GUARANTEE that no broken link can go
 * live: only links to published batch posts (rewritten to their real CMS URL) or
 * to the business's known real pages survive; anything else is dropped to text.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { articles, businesses, businessServices } from "../drizzle/schema";
import { buildLinkMap, resolvePublishLinks } from "./articleEngine";

export interface PublishLinkContext {
  ownDomain: string;
  pageAllowlist: string[];
}

/** Build the allowlist of the business's real pages + its own domain. */
export async function loadBusinessLinkContext(businessId: number): Promise<PublishLinkContext> {
  const db = await getDb();
  if (!db) return { ownDomain: "", pageAllowlist: [] };
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) return { ownDomain: "", pageAllowlist: [] };

  const pages = new Set<string>();
  const add = (u?: string | null) => { if (u) pages.add(u); };
  add(biz.websiteUrl);
  add(biz.primaryCtaUrl);
  add(biz.bookingsPageUrl);
  add(biz.contactPageUrl);
  add(biz.testimonialsPageUrl);
  add(biz.shopUrl);
  add(biz.linkedinUrl);
  add(biz.facebookUrl);
  if (biz.otherInternalLinks) {
    try {
      (biz.otherInternalLinks as Array<{ url?: string }>).forEach((l) => add(l?.url));
    } catch { /* ignore malformed */ }
  }
  const svc = await db
    .select({ pageUrl: businessServices.pageUrl })
    .from(businessServices)
    .where(eq(businessServices.businessId, businessId));
  svc.forEach((s) => add(s.pageUrl));

  const ownDomain = biz.websiteUrl ?? biz.primaryCtaUrl ?? "";
  return { ownDomain, pageAllowlist: Array.from(pages) };
}

/**
 * Resolve one article body for publishing: rewrite links to live posts, drop
 * links to unpublished posts and any hallucinated internal link. Returns the
 * safe body plus counts.
 */
export async function resolveBodyForPublish(
  businessId: number,
  batchNumber: number,
  bodyHtml: string,
): Promise<{ bodyHtml: string; warnings: string[]; rewritten: number; dropped: number }> {
  const db = await getDb();
  if (!db) return { bodyHtml, warnings: [], rewritten: 0, dropped: 0 };
  const rows = await db
    .select({ urlSlug: articles.urlSlug, cmsPostUrl: articles.cmsPostUrl, status: articles.status })
    .from(articles)
    .where(and(eq(articles.businessId, businessId), eq(articles.batchNumber, batchNumber)));
  const linkMap = buildLinkMap(rows);
  const ctx = await loadBusinessLinkContext(businessId);
  return resolvePublishLinks(bodyHtml, linkMap, ctx);
}
