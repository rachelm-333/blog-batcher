/**
 * Remove the AI-disclosure paragraph from article HTML — used by BOTH the
 * review preview and the CMS publisher, so they can never drift apart.
 *
 * IMPORTANT: the patterns are "tempered" with (?:(?!<\/p>)[\s\S])*? so they can
 * NEVER span past the paragraph the disclosure lives in. The previous version
 * used a greedy `[\s\S]*?` that, when the disclosure sat at the end of the
 * article, matched from the FIRST <p> all the way down — silently deleting the
 * entire body (intro, FAQ, CTA). That caused both the empty-FAQ preview and the
 * truncated Wix publish. Do not "simplify" this back to `[\s\S]*?`.
 */
export function stripAiDisclosure(html: string): string {
  return (html ?? "")
    // by explicit class
    .replace(/<p\b[^>]*class=["'][^"']*ai-disclosure[^"']*["'][^>]*>(?:(?!<\/p>)[\s\S])*?<\/p>/gi, "")
    // fallback: by text content, confined to a single paragraph
    .replace(
      /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?This article was researched and drafted with AI assistance(?:(?!<\/p>)[\s\S])*?<\/p>/gi,
      "",
    )
    .trim();
}
