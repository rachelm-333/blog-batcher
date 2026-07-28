/**
 * Platform-aware URL helpers.
 *
 * Each CMS has its own blog-post URL structure. This module converts a bare
 * URL slug (e.g. "branding-strategies") into the full absolute URL that will
 * be live on the user's site after publishing.
 *
 * Used in:
 *  - ZIP export (rewrite relative hrefs before packaging)
 *  - Article engine internal-link context (so generated articles link correctly)
 *  - buildLinkMap (pending articles get a platform-prefixed placeholder URL)
 */

export type CmsPlatform =
  | "wordpress"
  | "wix"
  | "shopify"
  | "webflow"
  | "squarespace"
  | "ghost"
  | "zapier"
  | "download"
  | null
  | undefined;

/**
 * Return the path prefix that the given CMS uses for blog posts.
 *
 * WordPress is special: the prefix depends on the site's permalink settings,
 * which we don't know in advance. We default to "" (root) because most WP
 * installs with a custom permalink use /<slug>/ directly. Users who have
 * /blog/<slug> can override via the `wordpressPathPrefix` option.
 */
export function cmsBlogPathPrefix(
  platform: CmsPlatform,
  opts?: { wordpressPathPrefix?: string },
): string {
  switch (platform) {
    case "wix":
      return "/post";
    case "squarespace":
      return "/blog";
    case "shopify":
      return "/blogs/news";
    case "webflow":
      return "/blog";
    case "ghost":
      return ""; // Ghost uses /<slug>/ at root by default
    case "wordpress":
      return opts?.wordpressPathPrefix ?? ""; // configurable; default root
    case "zapier":
    case "download":
    default:
      return ""; // unknown / download-only — leave relative
  }
}

/**
 * Convert a bare slug into the full absolute post URL for the given platform.
 *
 * @param slug      Bare slug, e.g. "branding-strategies" or "/branding-strategies"
 * @param platform  CMS platform from the businesses.cmsPlatform enum
 * @param siteUrl   The business's website URL, e.g. "https://www.example.com"
 * @param opts      Optional overrides (e.g. custom WordPress path prefix)
 * @returns         Full absolute URL, e.g. "https://www.example.com/post/branding-strategies"
 *                  Falls back to "/<prefix>/<slug>" (relative) if siteUrl is missing.
 */
export function slugToPostUrl(
  slug: string,
  platform: CmsPlatform,
  siteUrl: string | null | undefined,
  opts?: { wordpressPathPrefix?: string },
): string {
  const cleanSlug = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const prefix = cmsBlogPathPrefix(platform, opts);
  const path = prefix ? `${prefix}/${cleanSlug}` : `/${cleanSlug}`;

  if (!siteUrl) return path; // relative fallback

  const base = siteUrl.replace(/\/+$/, ""); // strip trailing slash
  return `${base}${path}`;
}

/**
 * Rewrite all relative internal hrefs in an HTML string to full absolute URLs.
 *
 * Matches href="/slug" and href="slug" patterns that correspond to known batch
 * slugs, and replaces them with the full platform-prefixed absolute URL.
 *
 * External links (http/https) and anchor links (#) are left untouched.
 *
 * @param html      Article body HTML
 * @param slugMap   Map of bare slug → full absolute URL for all batch articles
 * @returns         HTML with rewritten hrefs
 */
export function rewriteInternalLinks(
  html: string,
  slugMap: Record<string, string>,
): string {
  if (!html || Object.keys(slugMap).length === 0) return html;

  // Replace href="/slug" and href="slug" (not http/https/# links)
  return html.replace(
    /href="([^"#][^"]*)"/gi,
    (match, href: string) => {
      // Skip external links
      if (/^https?:\/\//i.test(href)) return match;
      // Normalise: strip leading slash for lookup
      const bare = href.replace(/^\/+/, "").replace(/\/+$/, "");
      if (slugMap[bare]) return `href="${slugMap[bare]}"`;
      if (slugMap[`/${bare}`]) return `href="${slugMap[`/${bare}`]}"`;
      return match;
    },
  );
}
