/**
 * Extract the bare slug (last path segment, lowercased) from an href — whether
 * relative ("/brand-positioning") or an absolute guessed URL
 * ("https://www.skrt.com.au/brand-positioning" or ".../post/brand-positioning").
 * Returns null for anchors, mailto/tel, or a bare domain / homepage link.
 *
 * Shared by the publish-time resolver and the backfill detector so both match
 * internal links the same way regardless of how the href was written.
 */
export function slugFromHref(href: string): string | null {
  let h = (href ?? "").trim();
  if (!h || h.startsWith("#") || /^(mailto:|tel:)/i.test(h)) return null;
  h = h.replace(/^https?:\/\/[^/]+/i, ""); // strip protocol + domain if absolute
  h = h.split(/[?#]/)[0].replace(/\/+$/, ""); // drop query/hash + trailing slash
  if (!h) return null; // homepage / bare domain — not an article link
  const seg = h.split("/").filter(Boolean).pop() ?? "";
  return seg ? seg.toLowerCase() : null;
}
