/**
 * backfillLinks.ts — detect which already-published posts need an internal link
 * "switched on" because a post they reference has since gone live.
 *
 * Staggered publishing means a post published early may reference a post that
 * wasn't live yet — so at publish time that link was dropped to plain text
 * (see resolvePublishLinks). Once the referenced post goes live, the earlier
 * post should be re-pushed to the CMS with the link restored.
 *
 * This module is the PURE brain: given the batch's articles (with their source
 * bodyHtml, which always keeps the placeholder <a href="/slug"> links), it works
 * out which published posts now contain a link to a post that went live AFTER
 * them — i.e. whose live CMS version is currently missing that link.
 *
 * No DB, no CMS calls — fully testable. The server consumes the result to
 * re-resolve each target's body and re-push it.
 */

export interface BackfillArticle {
  id: number;
  urlSlug: string | null;
  cmsPostId: string | null;
  cmsPostUrl: string | null;
  status: string | null;
  /** epoch ms, or null if not published */
  publishedAt: number | null;
  /** canonical source body, still holding placeholder /slug links */
  bodyHtml: string | null;
}

export interface BackfillTarget {
  articleId: number;
  cmsPostId: string | null;
  urlSlug: string | null;
  /** links that would be restored (target slug → its live URL) */
  restoredLinks: Array<{ slug: string; url: string }>;
}

import { slugFromHref } from "./slug";

const stripSlug = (s: string): string => s.toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");

/**
 * Extract the set of internal slugs referenced in a body — relative OR absolute
 * (guessed) hrefs. External links are filtered later by matching against the
 * batch's own slugs.
 */
function referencedSlugs(bodyHtml: string): Set<string> {
  const slugs = new Set<string>();
  const re = /<a\b[^>]*?href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    const s = slugFromHref(m[1]);
    if (s) slugs.add(s);
  }
  return slugs;
}

/**
 * Find published posts whose live CMS version is missing a now-available link.
 *
 * A published post A is a backfill target when it references (in its source
 * body) another batch post B that is now live, and B went live AFTER A was
 * published (so A's published version had that link dropped).
 */
export function findBackfillTargets(articles: BackfillArticle[]): BackfillTarget[] {
  const bySlug = new Map<string, BackfillArticle>();
  for (const a of articles) {
    if (a.urlSlug) bySlug.set(stripSlug(a.urlSlug), a);
  }

  const isLive = (a: BackfillArticle) => a.status === "published" && !!a.cmsPostUrl;

  const targets: BackfillTarget[] = [];
  for (const a of articles) {
    if (!isLive(a) || !a.bodyHtml) continue;
    const refs = referencedSlugs(a.bodyHtml);
    const restoredLinks: Array<{ slug: string; url: string }> = [];
    for (const slug of Array.from(refs)) {
      const b = bySlug.get(slug);
      if (!b || b.id === a.id || !isLive(b) || !b.cmsPostUrl) continue;
      // B must have gone live AFTER A (otherwise A already published with the link).
      const aAt = a.publishedAt;
      const bAt = b.publishedAt;
      const bAfterA = aAt == null || (bAt != null && bAt > aAt);
      if (bAfterA) restoredLinks.push({ slug, url: b.cmsPostUrl });
    }
    if (restoredLinks.length > 0) {
      targets.push({ articleId: a.id, cmsPostId: a.cmsPostId, urlSlug: a.urlSlug, restoredLinks });
    }
  }
  return targets;
}
