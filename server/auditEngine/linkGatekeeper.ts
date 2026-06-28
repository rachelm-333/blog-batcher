/**
 * linkGatekeeper.ts — Module 8: Link Validator & Anti-Sabotage Engine.
 *
 * Pre-publish hard gatekeeper. Parses all <a> tags and returns blocking ERRORS
 * for fatal linking flaws, plus an auto-fixed HTML payload (target/rel injected
 * on external links). If `errors` is non-empty, the publish/export action must
 * be blocked and the errors shown to the user.
 *
 * Standalone + synchronous (cheerio only) so it is fully unit-testable.
 */
import * as cheerio from "cheerio";

const GENERIC_ANCHORS = /^(click here|read more|learn more|link|here|this)$/i;
const SPAM_TLDS = new Set(["info", "biz", "tk", "xyz", "top", "click", "gq", "ml", "cf", "ga"]);
const NAKED_URL = /^(https?:\/\/|www\.)/i;

export interface LinkGateInput {
  html: string;
  primaryKeyword: string;
  /** The user's own domain(s) — links to these are "internal". */
  ownDomains: string[];
  /** Known competitor domains the user must never link to. */
  competitorDomains?: string[];
}

export interface LinkGateError {
  rule: string;
  message: string;
  detail: string;
}

export interface LinkGateResult {
  errors: LinkGateError[];
  html: string;       // auto-fixed (target/rel injected on external links)
  fixesApplied: number;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
function tldOf(host: string): string {
  const parts = host.split(".");
  return parts[parts.length - 1] ?? "";
}

export function runLinkGatekeeper(input: LinkGateInput): LinkGateResult {
  const $ = cheerio.load(input.html);
  const errors: LinkGateError[] = [];
  const kw = (input.primaryKeyword || "").trim().toLowerCase();
  const own = new Set(input.ownDomains.map(d => (hostOf(d) ?? d.toLowerCase()).replace(/^www\./, "")));
  const competitors = new Set((input.competitorDomains ?? []).map(d => (hostOf(d) ?? d.toLowerCase()).replace(/^www\./, "")));

  // Word index of the first external link (for the 100-word rule).
  const bodyText = $("body").length ? $("body").text() : $.root().text();
  let firstExternalWordIndex = -1;

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const anchor = $(el).text().trim();
    const anchorLower = anchor.toLowerCase();
    const isExternal = /^https?:\/\//i.test(href);
    const host = isExternal ? hostOf(href) : null;
    const isOwn = host ? own.has(host) : true; // relative = own
    const trulyExternal = isExternal && !isOwn;

    // Generic anchor (applies to all links)
    if (GENERIC_ANCHORS.test(anchorLower) || /\b(click here|read more|learn more)\b/i.test(anchorLower)) {
      errors.push({ rule: "GENERIC_ANCHOR", message: "Generic anchor text detected. Replace with descriptive keywords.", detail: `"${anchor}"` });
    }

    if (!trulyExternal) {
      // INTERNAL link checks
      if (kw && anchorLower === kw) {
        errors.push({ rule: "ANCHOR_CANNIBALIZATION", message: "You are cannibalizing your own keyword. Use different anchor text for this internal link.", detail: `internal anchor "${anchor}"` });
      }
    } else {
      // EXTERNAL link checks
      if (kw && anchorLower === kw) {
        errors.push({ rule: "KEYWORD_BLEED", message: "Do not give away your primary keyword to an external site. Change the anchor text.", detail: `external anchor "${anchor}" -> ${host}` });
      }
      if (NAKED_URL.test(anchor)) {
        errors.push({ rule: "NAKED_URL", message: "Naked URL detected. Wrap the link in descriptive text.", detail: anchor });
      }
      if (host && competitors.has(host)) {
        errors.push({ rule: "COMPETITOR_LINK", message: `You are linking to a known competitor (${host}). This passes SEO equity to a rival. Remove or replace this link.`, detail: host });
      }
      if (host && SPAM_TLDS.has(tldOf(host))) {
        errors.push({ rule: "LOW_TRUST_TLD", message: "Low-trust domain extension detected. Outbound links must point to authoritative sites to protect your E-E-A-T score.", detail: host });
      }
      // Track first external link position for the 100-word rule.
      if (firstExternalWordIndex === -1) {
        const idx = bodyText.indexOf(anchor);
        if (idx >= 0) firstExternalWordIndex = bodyText.slice(0, idx).split(/\s+/).filter(Boolean).length;
      }
    }
  });

  // Early Exit Block — first external link must be after the first 100 words.
  if (firstExternalWordIndex >= 0 && firstExternalWordIndex < 100) {
    errors.push({ rule: "EARLY_EXIT", message: "External link detected in the introduction. Move it further down the page to protect Dwell Time.", detail: `first external link at word ${firstExternalWordIndex}` });
  }

  // Target Blank Enforcer (AUTO-FIX, not an error) — inject target/rel on external links.
  let fixesApplied = 0;
  const html = input.html.replace(/<a\b([^>]*?)>/gi, (full, attrs: string) => {
    const hrefM = attrs.match(/href=["']([^"']*)["']/i);
    if (!hrefM) return full;
    const href = hrefM[1];
    const host = hostOf(href);
    const trulyExternal = /^https?:\/\//i.test(href) && host !== null && !own.has(host);
    if (!trulyExternal) return full;
    let a = attrs;
    if (!/\btarget=/i.test(a)) { a += ' target="_blank"'; fixesApplied++; }
    if (!/\brel=/i.test(a)) { a += ' rel="noopener noreferrer"'; fixesApplied++; }
    return `<a${a}>`;
  });

  return { errors, html, fixesApplied };
}
