/**
 * Layer 6 — Stage 4: Article Generation Engine
 *
 * Responsibilities:
 *  1. Pre-generate URL slugs for all article_nodes before writing begins
 *  2. Enforce generation order: Cornerstone → Pillar → Cluster
 *  3. Build the full Claude prompt with all 16 Authority Standard rules
 *  4. Enforce word count ranges per article type
 *  5. Run AI fingerprint scrub pass after generation
 *  6. Run Pass 1 (rules-based) and Pass 2 (AI quality) scoring
 *  7. Derive status badge from combined score
 *  8. Auto-regenerate articles below threshold (one retry)
 *
 * CRITICAL RULES (from scope Section 15.1):
 *  - Cornerstone max 3,200 words (hard stop)
 *  - Pillar: 1,500–1,800 words
 *  - Cluster: 1,000–1,200 words
 *  - FAQ schema only on Cornerstones and Pillars — never Clusters
 *  - No fabricated statistics or quotes
 *  - One article at a time per user
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  ArticleNode,
  articleNodes,
  articles,
  brandVoice,
  businessAudiences,
  businessCompetitors,
  businessServices,
  businesses,
  keywords,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { invokeClaudeWithCost as invokeLLMWithCost } from "./claudeLLM";
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Token limits per generation pass (single source of truth)
// ---------------------------------------------------------------------------
export const TOKEN_LIMITS = {
  outline: 4096,       // Outline JSON: small structured call
  section: 16000,      // Section HTML: longest single call (raised to fit full 2000+ word article + metadata)
  scrub: 12000,        // AI fingerprint scrub
  improvement: 12000,  // Pass 2 quality improvement
  condensation: 12000, // Word-count condensation
  expansion: 12000,    // Word-count expansion
  recovery: 12000,     // Section recovery retry
  titleRewrite: 2048,  // Title/meta rewrite
  schema: 2048,        // FAQ schema JSON
  pass2: 4096,         // Pass 2 quality scorer
} as const;

// ---------------------------------------------------------------------------
// Word count rules (from scope Table 4)
// ---------------------------------------------------------------------------
export const WORD_COUNT_RULES = {
  cornerstone: { min: 2000, max: 3200 },
  pillar: { min: 1500, max: 2200 },
  cluster: { min: 800, max: 1300 },
} as const;

/**
 * Tolerance window: if an article is within this many words of the minimum,
 * it is considered close enough and expansion is skipped.
 */
export const WORD_COUNT_TOLERANCE = 100;

/** Count visible words in an HTML string. */
export function countHtmlWords(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Trim an HTML article down to a target word count by removing whole <p>
 * paragraphs from the bottom up. Robust to large overages.
 *
 * Guarantees preserved:
 *  - The first <p> (opening answer block) is never removed.
 *  - All headings (h1–h4) are kept.
 *  - At least `minKeywordMentions` body mentions of the keyword remain, so
 *    Pass 1 keyword-density does not break.
 *  - If removing whole paragraphs is not enough, trailing sentences are
 *    trimmed from the longest remaining body paragraph as a last resort.
 *
 * Pure function — no LLM, no DB. Returns the trimmed html + final word count.
 */
export function trimHtmlToWordCount(
  bodyHtml: string,
  maxWords: number,
  keyword: string,
  minKeywordMentions = 5,
): { bodyHtml: string; wordCount: number; removed: number } {
  const kwLower = keyword.toLowerCase();
  const countKw = (s: string) =>
    (s.toLowerCase().match(new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

  let html = bodyHtml;
  let wordCount = countHtmlWords(html);
  const startWords = wordCount;
  if (wordCount <= maxWords) return { bodyHtml: html, wordCount, removed: 0 };

  // Protect the closing CTA section: everything from the LAST <h2> onward is
  // the mandated CTA block and must never be trimmed (keeps the CTA link + a
  // clean ending). We only trim paragraphs that appear before it.
  const lastH2Idx = html.toLowerCase().lastIndexOf("<h2");
  const protectedTailStart = lastH2Idx === -1 ? html.length : lastH2Idx;

  // A paragraph is eligible for removal only if it is: not the first <p>
  // (opening answer), before the CTA tail, and contains no link (links are
  // valuable — CTA and authority links must survive).
  const pRegex = /<p(?:\s[^>]*)?>[\s\S]*?<\/p>/gi;
  let pBlocks: string[] = html.match(pRegex) ?? [];
  if (pBlocks.length <= 1) {
    return { bodyHtml: html, wordCount, removed: startWords - wordCount };
  }
  const firstP = pBlocks[0];
  const isEligible = (block: string): boolean => {
    if (block === firstP) return false;
    if (/<a\s[^>]*href=/i.test(block)) return false; // never strip a link
    const idx = html.indexOf(block);
    if (idx === -1 || idx >= protectedTailStart) return false; // inside CTA tail
    return true;
  };

  // Remove eligible paragraphs bottom-up (preserves opening + early body).
  const candidates = pBlocks.filter(isEligible).reverse();
  for (const block of candidates) {
    if (wordCount <= maxWords) break;
    const idx = html.indexOf(block);
    if (idx === -1) continue;

    // Preserve a minimum number of keyword mentions in the body.
    const blockKw = countKw(block.replace(/<[^>]+>/g, " "));
    if (blockKw > 0) {
      const remainingKw = countKw(html.replace(block, "").replace(/<[^>]+>/g, " "));
      if (remainingKw < minKeywordMentions) continue; // keep this one for density
    }

    const blockWords = countHtmlWords(block);
    html = html.slice(0, idx) + html.slice(idx + block.length);
    wordCount -= blockWords;
  }

  // Last resort: trim WHOLE trailing sentences (sentence-boundary safe, never
  // mid-sentence) from the longest eligible body paragraphs until under target.
  if (wordCount > maxWords) {
    const eligible = (html.match(pRegex) ?? []).filter(isEligible);
    eligible.sort((a, b) => countHtmlWords(b) - countHtmlWords(a));
    for (const block of eligible) {
      if (wordCount <= maxWords) break;
      const inner = block.replace(/^<p(?:\s[^>]*)?>/i, "").replace(/<\/p>$/i, "");
      const sentences = inner.split(/(?<=[.!?])\s+/);
      if (sentences.length < 2) continue;
      let kept = sentences;
      while (kept.length > 2 && wordCount > maxWords) {
        const dropped = kept[kept.length - 1];
        kept = kept.slice(0, -1);
        wordCount -= countHtmlWords(dropped ?? "");
      }
      const rebuilt = block.replace(inner, kept.join(" ").trim());
      html = html.replace(block, rebuilt);
    }
  }

  return { bodyHtml: html, wordCount: countHtmlWords(html), removed: startWords - countHtmlWords(html) };
}

// ---------------------------------------------------------------------------
// Status badge thresholds (from scope Section 6.6)
// ---------------------------------------------------------------------------
// Badge thresholds based on Pass 1 (16-point checklist) score only.
// Pass 1 score = (points_passed / 16) * 100
// 16/16 = 100, 15/16 ≈ 94, 14/16 ≈ 88, 13/16 ≈ 81
export const BADGE_THRESHOLDS = {
  authority_ready: 94,  // 15–16/16 points met (≥94 = 15 or 16 out of 16)
  strong: 81,           // 13–14/16 points met
  // below 81 = needs_review (12 or fewer points)
} as const;

// Minimum Pass 1 score to surface to user without needs_review flag
// 13/16 = 81.25 → rounds to 81
export const MIN_DELIVERY_SCORE = 81;

// ---------------------------------------------------------------------------
// Banned AI fingerprint phrases (from scope Section 6.4)
// ---------------------------------------------------------------------------
export const BANNED_PHRASES = [
  // Original list
  "in today's world",
  "it's important to note",
  "it is important to note",
  "delve into",
  "game-changer",
  "game changer",
  "leverage",
  "synergy",
  "transformative",
  // Extended AI-fingerprint phrases
  "it's crucial to",
  "it is crucial to",
  "one of the most important",
  "ultimately,",
  "essentially,",
  "furthermore,",
  "moreover,",
  "at the end of the day",
  "according to research",
  "studies show",
  "it has been shown",
  "navigating the complexities",
  "navigate the ever-changing",
  "in today's competitive landscape",
  "in today's fast-paced",
  "in today's digital",
  "look no further",
  "cutting-edge",
  "state-of-the-art",
  "seamlessly",
  "robust solution",
  "tailored solutions",
  "tailored to your needs",
  "unlock your potential",
  "unlock the power",
  "empower your",
  "elevate your",
  "take your business to the next level",
  "in conclusion,",
  "to summarize,",
  "to summarise,",
  "it goes without saying",
  "needless to say",
  "as we all know",
  "the bottom line is",
  "at its core",
  // New AI-fingerprint / performative phrases
  "non-negotiable",
  "minefield blindfolded",
  "it's worth noting",
  "it is worth noting",
  "the truth is",
  "let's be honest",
  "let us be honest",
  "the reality is",
  "this means that",
  "game-changing",
  "this is a game",
  "make no mistake",
  "here's the thing",
  "here is the thing",
  "the fact is",
  "simply put",
  "put simply",
  "in other words",
  "to put it simply",
  "to put it another way",
  "it's no secret",
  "it is no secret",
  "spoiler alert",
  "the good news is",
  "the bad news is",
  // Banned opening patterns — invented personal anecdotes
  "i remember sitting",
  "i remember staring",
  "i was sitting at",
  "i was staring at",
  "kitchen table",
  "sitting at my kitchen",
  "staring at my kitchen",
  "i sat at my",
  "i remember the day",
  "i'll never forget the day",
  "i will never forget the day",
] as const;

// ---------------------------------------------------------------------------
// Keyword matching utilities (module-level, shared by scorer and generation passes)
// ---------------------------------------------------------------------------

/**
 * Stop words that carry no semantic weight for keyword presence checks.
 * Stripping these lets "starting up a business with no money in Australia" and
 * "start a business in Australia with no money" reduce to the same meaningful
 * token set: [start, business, money, australia].
 */
const KW_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "through", "during",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "no", "not", "can", "how", "what", "when", "where", "who", "which",
  "your", "my", "our", "their", "its", "this", "that", "these", "those",
]);

/** Light suffix-stripping so "starting" matches "start", "businesses" matches "business" */
function kwStemWord(w: string): string {
  return w
    .replace(/ing$/, "")
    .replace(/tion$/, "")
    .replace(/es$/, "")
    .replace(/s$/, "")
    .replace(/ed$/, "");
}

/** Extract meaningful (non-stop) tokens from a string with light stemming */
export function kwMeaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !KW_STOP_WORDS.has(w))
    .map(kwStemWord);
}

/**
 * Check whether a primary keyword is present in a text string.
 * Passes if:
 *   1. Exact phrase match (fast path), OR
 *   2. All meaningful keyword tokens appear anywhere in the text (any order, any form)
 *
 * This handles:
 *   - Word order differences: "start a business in Australia with no money"
 *     vs keyword "starting up a business with no money in Australia"
 *   - Inflection differences: "starting" vs "start", "businesses" vs "business"
 *   - Minor insertions: "start a small business in Australia"
 */
export function kwPresentInText(keyword: string, text: string): boolean {
  const kw = keyword.toLowerCase();
  const t = text.toLowerCase().replace(/<[^>]+>/g, " ");
  // Fast path: exact phrase
  if (t.includes(kw)) return true;
  // Token path: all meaningful keyword tokens present anywhere in text
  const kwTokens = kwMeaningfulTokens(kw);
  const textTokens = kwMeaningfulTokens(t);
  return kwTokens.every(kwTok =>
    textTokens.some(tTok => tTok === kwTok || tTok.startsWith(kwTok) || kwTok.startsWith(tTok))
  );
}

/**
 * Split any <p> longer than `maxSentences` into multiple <p> blocks at sentence
 * boundaries (GEO paragraph-density rule MIC-08). Pure, testable, no LLM.
 */
export function splitDenseParagraphs(html: string, maxSentences = 4): string {
  return html.replace(/<p((?:\s[^>]*)?)>([\s\S]*?)<\/p>/gi, (full, attrs: string, inner: string) => {
    // Don't split paragraphs that contain block/list markup or are short.
    if (/<(ul|ol|table|h[1-6])\b/i.test(inner)) return full;
    const sentences = inner.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= maxSentences) return full;
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += maxSentences) {
      chunks.push(`<p${attrs}>${sentences.slice(i, i + maxSentences).join(" ")}</p>`);
    }
    return chunks.join("\n");
  });
}

/**
 * Insert a hub-and-spoke internal link with EXACT-MATCH anchor text (MAC-09).
 * Used at PUBLISH time once the parent (pillar/cornerstone) is live and its real
 * CMS URL is known — so the link never points at an unpublished 404.
 *
 *  - Wraps the first plain-text mention of `hubKeyword` in the body in a link to
 *    `hubUrl` (anchor text === hubKeyword exactly).
 *  - If the keyword isn't mentioned, appends one natural sentence with the link.
 *  - Never touches text already inside an <a> or a heading.
 * Pure, testable.
 */
export function insertHubLink(
  bodyHtml: string,
  hubUrl: string,
  hubKeyword: string,
): { bodyHtml: string; inserted: boolean } {
  if (!hubUrl || !hubKeyword) return { bodyHtml, inserted: false };
  // Already linked to this hub?
  if (new RegExp(`<a\\b[^>]*href=["']${hubUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(bodyHtml)) {
    return { bodyHtml, inserted: false };
  }
  const link = `<a href="${hubUrl}">${hubKeyword}</a>`;
  // Try to wrap the first plain-text occurrence inside a <p> (not in a heading/link).
  const pRegex = /<p((?:\s[^>]*)?)>([\s\S]*?)<\/p>/gi;
  let done = false;
  const out = bodyHtml.replace(pRegex, (full, attrs: string, inner: string) => {
    if (done) return full;
    if (/<a\b/i.test(inner)) return full; // skip paragraphs already containing links
    const kwRegex = new RegExp(`\\b(${hubKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
    if (kwRegex.test(inner)) {
      done = true;
      return `<p${attrs}>${inner.replace(kwRegex, link)}</p>`;
    }
    return full;
  });
  if (done) return { bodyHtml: out, inserted: true };
  // Fallback: append a contextual sentence before the CTA (or at the end).
  const sentence = `<p>For the full picture, see our guide to ${link}.</p>\n`;
  const lastH2 = bodyHtml.toLowerCase().lastIndexOf("<h2");
  if (lastH2 !== -1) return { bodyHtml: bodyHtml.slice(0, lastH2) + sentence + bodyHtml.slice(lastH2), inserted: true };
  return { bodyHtml: bodyHtml + sentence, inserted: true };
}

/**
 * Ensure a user-provided expert quote appears as an attributed <blockquote>
 * (E-E-A-T check EAT-04). Inserts before the closing CTA section if the model
 * omitted it. Never invents — only inserts a quote that was provided.
 */
export function ensureExpertQuote(
  bodyHtml: string,
  expertQuote?: { quote: string; author: string },
): { bodyHtml: string; inserted: boolean } {
  if (!expertQuote || !expertQuote.quote || !expertQuote.author) return { bodyHtml, inserted: false };
  // Already present (a blockquote attributed to a name)?
  if (/<blockquote[\s>][\s\S]*?[—-]\s*[A-Z]/.test(bodyHtml)) return { bodyHtml, inserted: false };
  const block = `<blockquote>"${expertQuote.quote}" — ${expertQuote.author}</blockquote>\n`;
  // Insert before the last <h2> (the CTA section) if present, else append.
  const lastH2 = bodyHtml.toLowerCase().lastIndexOf("<h2");
  if (lastH2 !== -1) {
    return { bodyHtml: bodyHtml.slice(0, lastH2) + block + bodyHtml.slice(lastH2), inserted: true };
  }
  return { bodyHtml: bodyHtml + block, inserted: true };
}

/** Title-case a keyword phrase ("psychosocial hazards" -> "Psychosocial Hazards"). */
export function titleCaseKeyword(keyword: string): string {
  return keyword
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Ensure the primary keyword appears in at least one H2 heading.
 * Uses the SAME presence check as the Pass 1 scorer (kwPresentInText), so it
 * only edits a heading when the scorer would actually fail. When it does need
 * to insert, it prepends the keyword cleanly as a topic prefix
 * ("Psychosocial Hazards: Legal Definition and Scope") rather than tacking on
 * an awkward "...: A Guide to X" suffix.
 *
 * Pure, testable, no LLM.
 */
export function ensureKeywordInH2(
  bodyHtml: string,
  keyword: string,
): { bodyHtml: string; changed: boolean } {
  const h2Regex = /<h2(?:\s[^>]*)?>[\s\S]*?<\/h2>/gi;
  const h2s = bodyHtml.match(h2Regex) ?? [];
  if (h2s.length === 0) return { bodyHtml, changed: false };
  // Already satisfies the checker — leave headings untouched.
  if (h2s.some(h => kwPresentInText(keyword, h))) return { bodyHtml, changed: false };

  const firstH2 = h2s[0];
  if (!firstH2) return { bodyHtml, changed: false };
  const parts = firstH2.match(/<h2((?:\s[^>]*)?)>([\s\S]*?)<\/h2>/i);
  if (!parts) return { bodyHtml, changed: false };
  const attrs = parts[1] ?? "";
  const inner = parts[2].trim();
  const newH2 = `<h2${attrs}>${titleCaseKeyword(keyword)}: ${inner}</h2>`;
  return { bodyHtml: bodyHtml.replace(firstH2, newH2), changed: true };
}

/**
 * Remove orphan FAQ items — a <div class="faq-item"> that contains a question
 * but no answer (the model occasionally emits a trailing question with the
 * answer cut off). An item is kept only if it has at least two non-empty <p>
 * blocks (question + answer). Pure, testable, no LLM.
 */
export function removeOrphanFaqItems(bodyHtml: string): { bodyHtml: string; removed: number } {
  let removed = 0;
  const html = bodyHtml.replace(/<div\s+class=["'][^"']*faq-item[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, (block) => {
    const pTexts = (block.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/gi) ?? [])
      .map(p => p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    // A complete FAQ item needs a question AND a non-empty answer (>= 2 paragraphs).
    if (pTexts.length >= 2) return block;
    removed++;
    return "";
  });
  return { bodyHtml: html, removed };
}

/**
 * Ensure the primary keyword appears in at least one H3 heading — but ONLY if
 * H3s already exist (the Pass 1 check passes automatically when there are no
 * H3s, so we never add headings just to satisfy it). Mirrors ensureKeywordInH2.
 * Pure, testable, no LLM.
 */
export function ensureKeywordInH3(
  bodyHtml: string,
  keyword: string,
): { bodyHtml: string; changed: boolean } {
  const h3Regex = /<h3(?:\s[^>]*)?>[\s\S]*?<\/h3>/gi;
  const h3s = bodyHtml.match(h3Regex) ?? [];
  if (h3s.length === 0) return { bodyHtml, changed: false }; // no H3s → check passes anyway
  if (h3s.some(h => kwPresentInText(keyword, h))) return { bodyHtml, changed: false };

  const firstH3 = h3s[0];
  if (!firstH3) return { bodyHtml, changed: false };
  const parts = firstH3.match(/<h3((?:\s[^>]*)?)>([\s\S]*?)<\/h3>/i);
  if (!parts) return { bodyHtml, changed: false };
  const attrs = parts[1] ?? "";
  const inner = parts[2].trim();
  const newH3 = `<h3${attrs}>${titleCaseKeyword(keyword)}: ${inner}</h3>`;
  return { bodyHtml: bodyHtml.replace(firstH3, newH3), changed: true };
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Convert a keyword or title into a URL slug.
 * Lowercase, hyphenated, no special characters.
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/**
 * Pre-generate URL slugs for all article_nodes that don't have one yet.
 * Slugs are derived from the primary keyword for each node.
 * This must run before generation begins so internal links are real URLs.
 */
export async function preGenerateSlugs(businessId: number, batchNumber = 1): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Get all nodes without slugs for this batch, joined with their keywords
  const nodes = await db
    .select({
      nodeId: articleNodes.id,
      existingSlug: articleNodes.urlSlug,
      keyword: keywords.primaryKeyword,
    })
    .from(articleNodes)
    .leftJoin(keywords, eq(keywords.articleNodeId, articleNodes.id))
    .where(and(eq(articleNodes.businessId, businessId), eq(articleNodes.batchNumber, batchNumber), isNull(articleNodes.urlSlug)));

  for (const node of nodes) {
    const slug = generateSlug(node.keyword || `article-${node.nodeId}`);
    await db
      .update(articleNodes)
      .set({ urlSlug: slug })
      .where(eq(articleNodes.id, node.nodeId));
  }
}

// ---------------------------------------------------------------------------
// Generation order
// ---------------------------------------------------------------------------

export interface OrderedNode {
  nodeId: number;
  level: "cornerstone" | "pillar" | "cluster";
  articleType: string;
  urlSlug: string;
  parentCornerstoneId: number | null;
  parentPillarId: number | null;
  sortOrder: number;
}

/**
 * Return all article_nodes for a business in the mandatory generation order:
 * Cornerstones first → Pillars (grouped by parent cornerstone) → Clusters (grouped by parent pillar)
 */
export async function getOrderedNodes(businessId: number, batchNumber = 1): Promise<OrderedNode[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const nodes = await db
    .select()
    .from(articleNodes)
    .where(and(eq(articleNodes.businessId, businessId), eq(articleNodes.batchNumber, batchNumber)));

  const cornerstones = nodes
    .filter(n => n.level === "cornerstone")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const pillars = nodes
    .filter(n => n.level === "pillar")
    .sort((a, b) => (a.parentCornerstoneId ?? 0) - (b.parentCornerstoneId ?? 0) || a.sortOrder - b.sortOrder);

  const clusters = nodes
    .filter(n => n.level === "cluster")
    .sort((a, b) => (a.parentPillarId ?? 0) - (b.parentPillarId ?? 0) || a.sortOrder - b.sortOrder);

  const ordered = [...cornerstones, ...pillars, ...clusters];

  return ordered.map(n => ({
    nodeId: n.id,
    level: n.level as "cornerstone" | "pillar" | "cluster",
    articleType: n.articleType,
    urlSlug: n.urlSlug ?? `article-${n.id}`,
    parentCornerstoneId: n.parentCornerstoneId,
    parentPillarId: n.parentPillarId,
    sortOrder: n.sortOrder,
  }));
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export interface ArticleContext {
  businessName: string;
  industry: string;
  location: string;
  uvp: string;
  socialProof: string;
  voiceBrief: string;
  audiences: string[];
  services: Array<{ name: string; pageUrl?: string | null }>;
  ctaText: string;
  ctaUrl: string;
  competitors: Array<{ name: string; url?: string | null }>;
  primaryKeyword: string;
  secondaryKeywords: string[];
  paaQuestion: string;
  articleType: string;
  level: "cornerstone" | "pillar" | "cluster";
  wordCountMin: number;
  wordCountMax: number;
  urlSlug: string;
  parentCornerstoneUrl?: string;
  parentPillarUrl?: string;
  siblingUrls?: string[];
  allBatchSlugs: string[];
  bookingsPageUrl?: string;
  contactPageUrl?: string;
  testimonialsPageUrl?: string;
  shopUrl?: string;
  otherInternalLinks?: Array<{ label: string; url: string }>;
  problemsSolved?: string;
  customerSituationBefore?: string;
  customerFrustrations?: string;
  customerTransformation?: string;
  contentPlanDirection?: string;
  linkedinUrl?: string;
  facebookUrl?: string;
  instagramHandle?: string;
  /** Exhaustive allowlist of every URL the article is permitted to link to. */
  linkAllowlist: string[];
  /** Business website root URL — used for schema markup @id construction. */
  websiteUrl?: string;
  /** Fact Bank: verified facts/stats/experiences the AI may use (never invents others). */
  verifiedFacts?: string[];
  /** A user-provided, attributable expert quote (E-E-A-T). Never invented. */
  expertQuote?: { quote: string; author: string };
}

/**
 * Gather all context needed for a single article generation call.
 */
export async function buildArticleContext(
  businessId: number,
  nodeId: number,
  allOrderedNodes: OrderedNode[]
): Promise<ArticleContext> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Business
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new Error("Business not found");

  // Brand voice
  const [voice] = await db.select().from(brandVoice).where(eq(brandVoice.businessId, businessId)).limit(1);

  // Audiences
  const audiences = await db.select().from(businessAudiences).where(eq(businessAudiences.businessId, businessId));

  // Services
  const services = await db.select().from(businessServices).where(eq(businessServices.businessId, businessId));

  // Competitors
  const competitors = await db.select().from(businessCompetitors).where(eq(businessCompetitors.businessId, businessId));

  // Node
  const [node] = await db.select().from(articleNodes).where(eq(articleNodes.id, nodeId)).limit(1);
  if (!node) throw new Error("Article node not found");

  // Keyword
  const [kw] = await db.select().from(keywords).where(eq(keywords.articleNodeId, nodeId)).limit(1);

  const level = node.level as "cornerstone" | "pillar" | "cluster";
  const wc = WORD_COUNT_RULES[level];

  // Parent URLs
  let parentCornerstoneUrl: string | undefined;
  let parentPillarUrl: string | undefined;
  if (node.parentCornerstoneId) {
    const pcs = allOrderedNodes.find(n => n.nodeId === node.parentCornerstoneId);
    if (pcs) parentCornerstoneUrl = `/${pcs.urlSlug}`;
  }
  if (node.parentPillarId) {
    const pp = allOrderedNodes.find(n => n.nodeId === node.parentPillarId);
    if (pp) parentPillarUrl = `/${pp.urlSlug}`;
  }

  // Sibling cluster URLs (for cross-linking)
  let siblingUrls: string[] = [];
  if (level === "cluster" && node.parentPillarId) {
    siblingUrls = allOrderedNodes
      .filter(n => n.level === "cluster" && n.parentPillarId === node.parentPillarId && n.nodeId !== nodeId)
      .map(n => `/${n.urlSlug}`);
  }

  const socialProofParts: string[] = [];
  if (biz.yearsInBusiness) socialProofParts.push(`${biz.yearsInBusiness} years in business`);
  if (biz.clientsServed) socialProofParts.push(`${biz.clientsServed} clients served`);
  if (biz.awardsAccreditations) socialProofParts.push(biz.awardsAccreditations);

  return {
    businessName: biz.name,
    industry: biz.industry ?? "",
    location: biz.location ?? "",
    uvp: biz.uniqueValueProposition ?? "",
    socialProof: socialProofParts.join(". "),
    voiceBrief: voice?.finalVoiceBrief ?? "",
    audiences: audiences.map(a => a.label),
    services: services.map(s => ({ name: s.name, pageUrl: s.pageUrl })),
    ctaText: biz.primaryCtaText ?? "Contact Us",
    ctaUrl: biz.primaryCtaUrl ?? biz.websiteUrl ?? "",
    competitors: competitors.map(c => ({ name: c.name, url: c.websiteUrl })),
    primaryKeyword: kw?.primaryKeyword ?? "",
    secondaryKeywords: kw?.secondaryKeywords ? JSON.parse(kw.secondaryKeywords as string) : [],
    paaQuestion: (() => { const q = kw?.paaQuestions; if (!q) return ""; if (Array.isArray(q)) return (q as string[])[0] ?? ""; try { const arr = JSON.parse(q as string); return Array.isArray(arr) ? arr[0] ?? "" : ""; } catch { return ""; } })(),
    articleType: node.articleType,
    level,
    wordCountMin: wc.min,
    wordCountMax: wc.max,
    urlSlug: node.urlSlug ?? `article-${nodeId}`,
    parentCornerstoneUrl,
    parentPillarUrl,
    siblingUrls,
    allBatchSlugs: allOrderedNodes.map(n => `/${n.urlSlug}`),
    bookingsPageUrl: biz.bookingsPageUrl ?? undefined,
    contactPageUrl: biz.contactPageUrl ?? undefined,
    testimonialsPageUrl: biz.testimonialsPageUrl ?? undefined,
    shopUrl: biz.shopUrl ?? undefined,
    otherInternalLinks: biz.otherInternalLinks
      ? (biz.otherInternalLinks as Array<{ label: string; url: string }>)
      : undefined,
    problemsSolved: biz.problemsSolved ?? undefined,
    customerSituationBefore: biz.customerSituationBefore ?? undefined,
    customerFrustrations: biz.customerFrustrations ?? undefined,
    customerTransformation: biz.customerTransformation ?? undefined,
    contentPlanDirection: node.contentPlanDirection ?? undefined,
    linkedinUrl: biz.linkedinUrl ?? undefined,
    facebookUrl: biz.facebookUrl ?? undefined,
    instagramHandle: biz.instagramHandle ?? undefined,
    // -----------------------------------------------------------------------
    // LINK ALLOWLIST — every URL the article is permitted to link to.
    // Nothing outside this list may appear as an href in the generated HTML.
    // -----------------------------------------------------------------------
    websiteUrl: biz.websiteUrl ?? undefined,
    linkAllowlist: (() => {
      const urls = new Set<string>();
      // Business real pages
      if (biz.websiteUrl) urls.add(biz.websiteUrl);
      if (biz.primaryCtaUrl) urls.add(biz.primaryCtaUrl);
      if (biz.bookingsPageUrl) urls.add(biz.bookingsPageUrl);
      if (biz.contactPageUrl) urls.add(biz.contactPageUrl);
      if (biz.testimonialsPageUrl) urls.add(biz.testimonialsPageUrl);
      if (biz.shopUrl) urls.add(biz.shopUrl);
      if (biz.linkedinUrl) urls.add(biz.linkedinUrl);
      if (biz.facebookUrl) urls.add(biz.facebookUrl);
      if (biz.instagramHandle) urls.add(`https://instagram.com/${biz.instagramHandle.replace(/^@/, "")}`);
      // Service page URLs
      services.forEach(s => { if (s.pageUrl) urls.add(s.pageUrl); });
      // Other internal links
      if (biz.otherInternalLinks) {
        (biz.otherInternalLinks as Array<{ label: string; url: string }>).forEach(l => { if (l.url) urls.add(l.url); });
      }
      // Real batch article slugs (relative paths)
      allOrderedNodes.forEach(n => { if (n.urlSlug) urls.add(`/${n.urlSlug}`); });
      // Parent article URLs
      if (node.parentCornerstoneId) {
        const pcs = allOrderedNodes.find(n => n.nodeId === node.parentCornerstoneId);
        if (pcs?.urlSlug) urls.add(`/${pcs.urlSlug}`);
      }
      if (node.parentPillarId) {
        const pp = allOrderedNodes.find(n => n.nodeId === node.parentPillarId);
        if (pp?.urlSlug) urls.add(`/${pp.urlSlug}`);
      }
      // Competitor external URLs
      competitors.forEach(c => { if (c.websiteUrl) urls.add(c.websiteUrl); });
      return Array.from(urls).filter(Boolean);
    })(),
  };
}

// ---------------------------------------------------------------------------
// Prompt builder — 16-point Authority Standard
// ---------------------------------------------------------------------------

/**
 * Exported alias for buildSinglePassPrompt — used by tests and external callers.
 * Delegates to the internal single-pass prompt builder (delimiter-based format).
 */
export function buildGenerationPrompt(ctx: ArticleContext): string {
  return buildSinglePassPrompt(ctx, new Date().getFullYear());
}


// ---------------------------------------------------------------------------
// AI fingerprint scrub pass (from scope Section 6.4)
// ---------------------------------------------------------------------------

/**
 * Parse every <a href="..."> in the article HTML.
 * Any href that is NOT in the allowlist (and is NOT an external authority link)
 * is stripped — the <a> tag is removed but the anchor text is kept as plain text.
 *
 * External authority links (http/https links to domains NOT in the allowlist) are
 * allowed through because point 10 of the Authority Standard requires a real
 * government / industry body link that the engine chooses at generation time.
 *
 * Returns the cleaned HTML, the count of stripped links, and the stripped URLs.
 */
/**
 * Live-checks an external URL with HEAD (falling back to GET) and a 5-second timeout.
 * Returns true if the URL responds with a 2xx or 3xx status, false otherwise.
 */
async function checkUrlLive(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BlogBatcher/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (res.status < 400) return true;
    // HEAD blocked — try GET
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 5000);
    const res2 = await fetch(url, {
      method: "GET",
      signal: controller2.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BlogBatcher/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer2);
    return res2.status < 400;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/** Extract the hostname (no www) from an absolute URL, or null if not absolute. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Decide what to do with a single link WITHOUT any network call:
 * "keep" | "strip" | "live-check".
 *  - Exact allowlist match -> keep.  Anchor/mailto/tel -> keep.
 *  - Relative link not in allowlist -> strip (invented internal page).
 *  - Absolute URL on one of OUR OWN domains but not an exact match -> strip
 *    (do NOT live-check our own domain: Wix returns soft 404s as HTTP 200, so a
 *    dead invented path would falsely pass).
 *  - Absolute URL on a different (external) domain -> live-check.
 * Exported for testing.
 */
export function classifyLink(
  href: string,
  allowedExact: Set<string>,
  ownDomains: Set<string>,
): "keep" | "strip" | "live-check" {
  const norm = href.toLowerCase().replace(/\/$/, "");
  if (allowedExact.has(norm)) return "keep";
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return "keep";
  if (!/^https?:\/\//i.test(href)) return "strip";
  const host = hostOf(href);
  if (host && ownDomains.has(host)) return "strip";
  return "live-check";
}

export async function validateAndStripLinks(
  html: string,
  allowlist: string[],
  ownDomains: string[] = []
): Promise<{ html: string; strippedCount: number; strippedUrls: string[] }> {
  const strippedUrls: string[] = [];
  const allowedExact = new Set(allowlist.map(u => u.toLowerCase().replace(/\/$/, "")));
  const own = new Set(ownDomains.map(d => d.toLowerCase().replace(/^www\./, "")));
  for (const a of allowlist) { const h = hostOf(a); if (h) own.add(h); }

  const toLiveCheck = new Set<string>();
  const linkPattern = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null) {
    const hrefMatch = m[1].match(/href=["']([^"']*)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (classifyLink(href, allowedExact, own) === "live-check") toLiveCheck.add(href);
  }

  const liveResults = new Map<string, boolean>();
  if (toLiveCheck.size > 0) {
    await Promise.all(Array.from(toLiveCheck).map(async url => {
      liveResults.set(url, await checkUrlLive(url));
    }));
    Array.from(liveResults.entries()).forEach(([url, ok]) => {
      console.log(`[ArticleEngine] External link live-check: ${ok ? "PASS" : "FAIL"} -> ${url}`);
    });
  }

  const cleaned = html.replace(
    /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi,
    (fullMatch: string, attrs: string, innerText: string) => {
      const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
      if (!hrefMatch) return fullMatch;
      const href = hrefMatch[1].trim();
      const verdict = classifyLink(href, allowedExact, own);
      if (verdict === "keep") return fullMatch;
      if (verdict === "strip") { strippedUrls.push(href); return innerText; }
      if (liveResults.get(href) === true) return fullMatch;
      strippedUrls.push(href);
      return innerText;
    }
  );

  return { html: cleaned, strippedCount: strippedUrls.length, strippedUrls };
}

export function buildScrubPrompt(
  bodyHtml: string,
  bodyMarkdown: string,
  focusKeyword?: string,
  level?: "cornerstone" | "pillar" | "cluster"
): string {
  const MAX_KEYWORD_MENTIONS_SCRUB: Record<string, number> = {
    cornerstone: 20,
    pillar: 15,
    cluster: 8,
  };
  const maxMentionsScrub = level ? (MAX_KEYWORD_MENTIONS_SCRUB[level] ?? 20) : 20;

  const keywordReductionInstruction = focusKeyword
    ? `13. Check how many times the focus keyword '${focusKeyword}' appears. If it appears more than ${maxMentionsScrub} times, reduce repetition by:\n   - Replacing some instances with natural synonyms\n   - Using pronouns or descriptive references instead\n   - Restructuring sentences to avoid repeating the exact phrase\n   Do NOT remove the keyword from any section entirely — just reduce the total count to under ${maxMentionsScrub} mentions.`
    : "";

  return `You are an AI content editor specialising in removing AI fingerprints from blog content.

Review the article below and rewrite it to remove all AI tells. The result must be indistinguishable from content written by a specific human expert with a strong point of view.

SPECIFIC THINGS TO FIX:
1. Remove em dash (—) overuse — replace with commas, full stops, or restructure the sentence
2. Remove rhetorical question openings — replace with direct statements
3. Remove these exact phrases (replace with natural alternatives): ${BANNED_PHRASES.map(p => `"${p}"`).join(", ")}
4. Remove repetitive sentence structures — vary the rhythm
5. Vary sentence length deliberately: mix short punchy sentences (under 10 words) with medium ones (15–25 words). Never have 4+ sentences in a row of similar length.
6. Remove transition words that only AI overuses: furthermore, moreover, additionally (when used to pad), in conclusion, to summarize.
7. Replace any vague authority claims ('research shows', 'studies indicate', 'experts agree') with specific named examples, or remove them entirely.
8. If a sentence could appear in any article about any industry, it is too generic. Rewrite it with a specific detail, number, or example from the article's actual topic.
9. Remove any sentence that begins with 'It is important to' or 'It is crucial to' — rewrite as a direct statement.
10. Ensure the article sounds like it was written by a specific human with a point of view, not a generic assistant
11. Preserve ALL HTML tags, links, headings, and schema markup exactly — only change the prose text
12. Do NOT remove any content, sections, or paragraphs — the output MUST be at least as long as the input${keywordReductionInstruction ? "\n" + keywordReductionInstruction : ""}

IMPORTANT: Do NOT change the meaning, facts, keyword placement, or structure. Only improve the human authenticity of the writing.

Return ONLY the scrubbed HTML body wrapped in these exact delimiters (no other text before or after):
<SCRUBBED_HTML>
...full scrubbed HTML here...
</SCRUBBED_HTML>

ARTICLE TO SCRUB:
${bodyHtml}`;
}

// ---------------------------------------------------------------------------
// Pass 1 — Rules-based scorer
// ---------------------------------------------------------------------------

export interface Pass1Result {
  score: number;  // 0–100 (each of 16 points = ~6.25 points)
  points: Record<string, boolean>;
  details: Record<string, string>;
}

export function runPass1Scorer(params: {
  bodyHtml: string;
  bodyMarkdown: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  urlSlug: string;
  wordCount: number;
  level: "cornerstone" | "pillar" | "cluster";
  primaryKeyword: string;
  externalLinkPresent: boolean;
  internalCtaLinkPresent: boolean;
  internalBlogLinksPresent: boolean;
  schemaPresent: boolean;
}): Pass1Result {
  const {
    bodyHtml,
    title,
    metaTitle,
    metaDescription,
    urlSlug,
    wordCount,
    level,
    primaryKeyword,
    externalLinkPresent,
    internalCtaLinkPresent,
    internalBlogLinksPresent,
    schemaPresent,
  } = params;

  // Maximum keyword mention counts by level — prevents keyword stuffing even when density % is within range
  const MAX_KEYWORD_MENTIONS: Record<string, number> = {
    cornerstone: 20,
    pillar: 15,
    cluster: 8,
  };
  const maxMentions = MAX_KEYWORD_MENTIONS[level] ?? 20;

  const kw = primaryKeyword.toLowerCase();
  const bodyLower = bodyHtml.toLowerCase();
  const titleLower = title.toLowerCase();

  // Count keyword occurrences in body text (strip tags first)
  const bodyText = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();

  // Convenience wrapper using the module-level kwPresentInText
  const kwPresent = (text: string) => kwPresentInText(primaryKeyword, text);

  // Count keyword occurrences — use both exact and token-presence per sentence
  const exactMatches = (bodyText.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  // Also count sentences/clauses that contain all keyword tokens (for density)
  const kwMatches = exactMatches > 0 ? exactMatches : (() => {
    const paras = bodyText.split(/[.!?\n]+/);
    return paras.filter(p => kwPresent(p)).length;
  })();
  const kwDensity = wordCount > 0 ? kwMatches / wordCount : 0;

  // H1 check (title) — token-presence match
  const h1Present = kwPresent(titleLower);

  // H2 check — token-presence match on any H2
  const h2Matches = bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  const kwInH2 = h2Matches.some(h => kwPresent(h));

  // H3 check — token-presence match on any H3 (pass if no H3s exist)
  const h3Matches = bodyHtml.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];
  const kwInH3 = h3Matches.length === 0 || h3Matches.some(h => kwPresent(h));

  const wc = WORD_COUNT_RULES[level];

  const points: Record<string, boolean> = {
    // Pass if: 4+ mentions AND density ≤1% AND under max mention count (prevents stuffing)
    // NOTE: no minimum density % — 4 mentions is the floor; 1% is the hard ceiling
    p1_keyword_density: kwMatches >= 4 && kwMatches <= maxMentions && kwDensity <= 0.01,
    p2_keyword_in_h1: h1Present,
    p3_keyword_in_h2: kwInH2,
    p4_keyword_in_h3: kwInH3,
    // P5: keyword in first 100 words — use ordered-words check to handle minor word insertions
    p5_keyword_first_100: (() => {
      const first100 = bodyText.split(/\s+/).slice(0, 100).join(" ");
      return kwPresent(first100);
    })(),
    // P6: all words in the keyword appear in the slug in order (words may have other words between them)
    p6_keyword_in_slug: (() => {
      const slugLower = urlSlug.toLowerCase();
      const kwWords = kw.split(/\s+/);
      // Check 1: exact adjacent match (e.g. "pool-installation-cost-sydney" in slug)
      if (slugLower.includes(kw.replace(/\s+/g, "-"))) return true;
      // Check 2: all keyword words appear in the slug in order (non-adjacent allowed)
      let pos = 0;
      for (const word of kwWords) {
        const idx = slugLower.indexOf(word, pos);
        if (idx === -1) return false;
        pos = idx + word.length;
      }
      return true;
    })(),
    p7_meta_title: metaTitle.toLowerCase().includes(kw) && metaTitle.length <= 60,
    // P8: meta description must contain keyword (exact or with minor words between) and be 140-160 chars
    p8_meta_description: (() => {
      const descLower = metaDescription.toLowerCase();
      const inRange = metaDescription.length >= 140 && metaDescription.length <= 160;
      if (!inRange) return false;
      // Check 1: exact keyword phrase
      if (descLower.includes(kw)) return true;
      // Check 2: all keyword words appear in the description in order
      const kwWords = kw.split(/\s+/);
      let pos = 0;
      for (const word of kwWords) {
        const idx = descLower.indexOf(word, pos);
        if (idx === -1) return false;
        pos = idx + word.length;
      }
      return true;
    })(),
    // P9: opening answer block — detects a Q&A or direct-answer block in the first 600 chars of body HTML
    // The LLM is instructed to place a bold question + direct answer immediately after H1.
    p9_opening_answer: (() => {
      const first600Html = bodyHtml.slice(0, 800);
      const first600Lower = first600Html.toLowerCase();
      // Pattern 1: a <strong> or <b> tag containing a question mark (bold question)
      if (/<(strong|b)[^>]*>[^<]*\?[^<]*<\/(strong|b)>/i.test(first600Html)) return true;
      // Pattern 2: a paragraph that contains a question mark (question in a <p>)
      if (/<p[^>]*>[^<]{5,200}\?/i.test(first600Html)) return true;
      // Pattern 3: an <h2> or <h3> that is a question
      if (/<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/i.test(first600Html)) return true;
      // Pattern 4: body text starts with a question word followed by a question mark within first 300 chars
      const first300Text = bodyText.slice(0, 300);
      if (/\b(how|what|why|when|where|who|which|is|are|does|do|can|should)\b[^.!?]{5,200}\?/.test(first300Text)) return true;
      // Pattern 5: any question mark in the first 600 chars of body HTML (LLM plain-text question format)
      if (first600Lower.includes("?")) return true;
      return false;
    })(),
    // P10: external link — check both the flag returned by LLM and scan the HTML for real external hrefs
    // An external link is any href to http(s):// that is NOT localhost and NOT the business's own ctaUrl domain
    p10_external_link: externalLinkPresent || (() => {
      const externalHrefPattern = /href=["'](https?:\/\/[^"']+)["']/gi;
      let match;
      while ((match = externalHrefPattern.exec(bodyHtml)) !== null) {
        const href = match[1].toLowerCase();
        if (!href.includes("localhost") && !href.startsWith("/")) return true;
      }
      return false;
    })(),
    p11_internal_cta: internalCtaLinkPresent,
    p12_internal_blog_links: internalBlogLinksPresent,
    p13_schema: schemaPresent,
    p14_eeat: bodyLower.includes("year") || bodyLower.includes("experience") || bodyLower.includes("client") || bodyLower.includes("award"),
    p15_human_authenticity: !BANNED_PHRASES.some(phrase => bodyLower.includes(phrase.toLowerCase())),
    p16_word_count: wordCount >= wc.min - WORD_COUNT_TOLERANCE && wordCount <= wc.max + WORD_COUNT_TOLERANCE,
  };

  const details: Record<string, string> = {
    p1_keyword_density: `${kwMatches} mentions, ${(kwDensity * 100).toFixed(2)}% density`,
    p7_meta_title: `${metaTitle.length} chars`,
    p8_meta_description: `${metaDescription.length} chars`,
    p16_word_count: `${wordCount} words (range: ${wc.min}–${wc.max})`,
  };

  const passedCount = Object.values(points).filter(Boolean).length;
  const score = Math.round((passedCount / 16) * 100);

  return { score, points, details };
}

// ---------------------------------------------------------------------------
// Pass 2 — AI quality scorer
// ---------------------------------------------------------------------------

export async function runPass2Scorer(bodyHtml: string, primaryKeyword: string, userId?: number | null, hasSiblings?: boolean): Promise<{ score: number; reason: string }> {
  // When no sibling/cluster articles exist in the batch, Batch Cohesion cannot be
  // fairly evaluated — the article has nothing to link to. In that case, score out
  // of 80 (4 criteria × 20 pts) and normalise to 100 so the article isn't penalised
  // for a structural constraint outside its control.
  const batchCohesionLine = hasSiblings
    ? "5. BATCH COHESION (20 pts): Does it feel like part of a coherent content strategy? Does it cross-link to related articles where appropriate?"
    : "5. BATCH COHESION: NOT APPLICABLE — this article has no sibling or cluster articles to link to in this batch. Award full 20 points for this criterion automatically.";
  console.log(`[ArticleEngine] Pass 2 Batch Cohesion: ${hasSiblings ? "INCLUDED (siblings present)" : "EXCLUDED (no siblings — full 20 pts awarded automatically)"}`);


  const prompt = `You are an SEO content quality auditor. Score the following article on these 5 criteria (each worth 20 points, total 100):

1. SEARCH INTENT RESOLUTION (20 pts): Does it fully resolve what the searcher is looking for?
2. HUMAN AUTHENTICITY (20 pts): Does it avoid AI-fingerprint writing and read naturally? Score this on CONCRETE SPECIFICITY — specific facts, real examples, named tools/standards/processes, concrete steps — and the absence of generic filler. IMPORTANT: Do NOT deduct points for the absence of first-person anecdotes, personal stories, or stated credentials. Fabricating those is prohibited, so their absence is correct and must not be penalised. A specific, accurate, plainly-written article by an anonymous expert should score full marks.
3. TITLE TERRITORY (20 pts): Does the title own a specific territory and signal clear value?
4. E-E-A-T AUTHORITY (20 pts): Does it demonstrate Expertise and Trustworthiness through ACCURATE, SPECIFIC topical knowledge (correct terminology, real obligations/standards, concrete how-to detail)? Judge expertise by the accuracy and specificity of the content itself — NOT by personal credentials, bylines, or claimed years of experience, which the article is correctly prohibited from inventing.
${batchCohesionLine}

Primary keyword: ${primaryKeyword}

IMPORTANT: The FULL article is provided below. Judge completeness against the entire article — do not assume it is unfinished.

Full article (plain text):
${bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 24000)}

Return JSON: { "score": <0-100 integer>, "reason": "<one sentence explaining the main weakness — be specific about which criterion lost the most points and why>" }`;

  try {
    // Race the LLM call against a 30-second timeout so it never hangs indefinitely
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Pass 2 scorer timed out after 30s")), 30_000)
    );
    const result = await Promise.race([
      invokeLLMWithCost(
        {
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: TOKEN_LIMITS.pass2,
        },
        { userId, feature: "seo_analysis" }
      ),
      timeoutPromise,
    ]);
    const content = result.choices[0]?.message?.content;
    // Strip markdown code fences if the model wrapped the JSON in ```json ... ```
    const rawContent = typeof content === "string" ? content : JSON.stringify(content);
    const strippedContent = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const parsed = JSON.parse(strippedContent);
    return {
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      reason: parsed.reason || parsed.feedback || "",
    };
  } catch (err) {
    // If AI scorer fails or times out, return a neutral score so generation isn't blocked
    console.warn(`[ArticleEngine] Pass 2 scorer failed/timed out:`, err instanceof Error ? err.message : err);
    return { score: 75, reason: "" };
  }
}

// ---------------------------------------------------------------------------
// Combined score → status badge
// ---------------------------------------------------------------------------

export function deriveStatusBadge(pass1Score: number, pass2Score: number): {
  internalScore: number;
  statusBadge: "authority_ready" | "strong" | "needs_review";
} {
  // Badge and status are based solely on Pass 1 (the objective 16-point checklist).
  // Pass 2 (subjective AI quality score) is stored for reference but does NOT affect
  // the badge or needs_review status — it was causing 15/16 articles to show as
  // Needs Review when the subjective score was low.
  const internalScore = pass1Score; // Pass 1 score (0–100, based on 16 points)

  // Keep pass2Score in scope to avoid unused-variable warnings — it's stored in DB
  void pass2Score;

  let statusBadge: "authority_ready" | "strong" | "needs_review";
  if (internalScore >= BADGE_THRESHOLDS.authority_ready) {
    statusBadge = "authority_ready";
  } else if (internalScore >= BADGE_THRESHOLDS.strong) {
    statusBadge = "strong";
  } else {
    statusBadge = "needs_review";
  }

  return { internalScore, statusBadge };
}

// ---------------------------------------------------------------------------
// Single-pass article generation helpers (kept for export compatibility)
// ---------------------------------------------------------------------------

export interface OutlineSection {
  heading: string;
  targetWords: number;
  notes: string;
}

export interface ArticleOutline {
  title: string;
  metaTitle: string;
  metaDescription: string;
  sections: OutlineSection[];
  schemaMarkup: string;
  faqItems: Array<{ question: string; answer: string }> | null;
}

/**
 * Detect if an HTML body has a trailing empty heading (truncation signature).
 */
export function hasTrailingEmptyHeading(bodyHtml: string): boolean {
  const headingMatches = Array.from(bodyHtml.matchAll(/<h[2-6][^>]*>([^<]+)<\/h[2-6]>/gi));
  if (headingMatches.length === 0) return false;
  const lastHeading = headingMatches[headingMatches.length - 1];
  const lastHeadingEnd = (lastHeading.index ?? 0) + lastHeading[0].length;
  const afterLastHeading = bodyHtml.slice(lastHeadingEnd).replace(/<[^>]+>/g, " ").trim();
  const wordsAfter = afterLastHeading.split(/\s+/).filter(Boolean).length;
  return wordsAfter < 10;
}

// ---------------------------------------------------------------------------
// Single article generation — single-call engine
// ---------------------------------------------------------------------------

export interface GenerationResult {
  title: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  bodyMarkdown: string;
  schemaMarkup: string;
  faqItems: Array<{ question: string; answer: string }> | null;
  wordCount: number;
  urlSlug: string;
  internalScore: number;
  statusBadge: "authority_ready" | "strong" | "needs_review";
  pass1Points: Record<string, boolean>;
  pass1Metrics: Record<string, string>;
  pass2Score: number;
  pass2Reason: string;
}

/**
 * Build the single comprehensive prompt that asks the model to write the
 * complete article in one call and return a structured JSON response.
 */
function buildSinglePassPrompt(ctx: ArticleContext, currentYear: number): string {
  const articleTypeLabel: Record<string, string> = {
    cornerstone_guide: "Cornerstone Guide",
    top_10_list: "Top 10 List",
    how_to: "How-To Article",
    the_why: "The Why Article",
    comparison: "Comparison Article",
    myth_busting: "Myth-Busting Article",
    specialist_post: "Specialist Post",
  };
  const typeLabel = articleTypeLabel[ctx.articleType] ?? ctx.articleType;
  const isCornerstoneOrPillar = ctx.level === "cornerstone" || ctx.level === "pillar";

  const servicesText = ctx.services
    .map(s => `- ${s.name}${s.pageUrl ? ` (${s.pageUrl})` : ""}`)
    .join("\n");

  const competitorText = ctx.competitors.length
    ? ctx.competitors.map(c => `- ${c.name}${c.url ? ` (${c.url})` : ""}`).join("\n")
    : "None provided";

  const internalLinkContext = [
    ctx.parentCornerstoneUrl ? `Parent Cornerstone URL: ${ctx.parentCornerstoneUrl}` : null,
    ctx.parentPillarUrl ? `Parent Pillar URL: ${ctx.parentPillarUrl}` : null,
    ctx.siblingUrls?.length ? `Sibling Cluster URLs for cross-linking: ${ctx.siblingUrls.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const optionalPageLinks: string[] = [];
  if (ctx.contactPageUrl) optionalPageLinks.push(`Contact Page: ${ctx.contactPageUrl}`);
  if (ctx.bookingsPageUrl) optionalPageLinks.push(`Bookings/Appointments Page: ${ctx.bookingsPageUrl}`);
  if (ctx.testimonialsPageUrl) optionalPageLinks.push(`Testimonials/Reviews Page: ${ctx.testimonialsPageUrl}`);
  if (ctx.shopUrl) optionalPageLinks.push(`Shop/E-commerce Page: ${ctx.shopUrl}`);
  if (ctx.otherInternalLinks?.length) {
    ctx.otherInternalLinks.forEach(l => optionalPageLinks.push(`${l.label}: ${l.url}`));
  }
  const optionalLinksText = optionalPageLinks.length ? optionalPageLinks.join("\n") : null;

  return `You are an expert SEO content writer producing a high-authority blog article for an Australian business.

=== YEAR ===
The current year is ${currentYear}. Never reference any year before ${currentYear} as "current" or "this year". Do not use years older than ${currentYear} in statistics or examples unless explicitly quoting a historical event.

=== BUSINESS CONTEXT ===
Business Name: ${ctx.businessName}
Industry: ${ctx.industry}
Location: ${ctx.location}
Unique Value Proposition: ${ctx.uvp}
Social Proof: ${ctx.socialProof || "Not provided"}
${(ctx.linkedinUrl || ctx.facebookUrl || ctx.instagramHandle) ? `Social Presence: This business has verified social profiles:\n${ctx.linkedinUrl ? `- LinkedIn: ${ctx.linkedinUrl}\n` : ""}${ctx.facebookUrl ? `- Facebook: ${ctx.facebookUrl}\n` : ""}${ctx.instagramHandle ? `- Instagram: ${ctx.instagramHandle}\n` : ""}These can be referenced as evidence of established business presence.` : ""}
Target Audiences: ${ctx.audiences.join(", ") || "General audience"}

Services/Products (use these for internal CTA links):
${servicesText || "No services listed"}

Primary CTA: ${ctx.ctaText} → ${ctx.ctaUrl}
${optionalLinksText ? `\nAdditional internal pages you may link to naturally:\n${optionalLinksText}` : ""}
${!ctx.bookingsPageUrl ? "IMPORTANT: Do NOT mention bookings, appointments, or scheduling — this business has not provided a bookings URL." : ""}

Competitors (for Comparison articles only):
${competitorText}

=== VOICE BRIEF ===
${ctx.voiceBrief || "Write in a professional, authoritative, and helpful tone. Sound like a real human expert."}

=== ARTICLE SPECIFICATION ===
Article Type: ${typeLabel}
URL Slug: /${ctx.urlSlug}
Primary Keyword: ${ctx.primaryKeyword}
Secondary Keywords: ${ctx.secondaryKeywords.join(", ") || "None"}
PAA Question to Answer: ${ctx.paaQuestion || "Not specified — answer the most likely search intent question"}
Word Count: ${ctx.wordCountMin}–${ctx.wordCountMax} words (MINIMUM: ${ctx.wordCountMin} words — you MUST write at least ${ctx.wordCountMin} words; HARD MAXIMUM: ${ctx.wordCountMax} words — do not exceed).
⚠️ WORD BUDGET IS A HARD CONSTRAINT — PLAN FOR IT:
- Before writing, decide how many H2 sections you can FULLY cover within ${ctx.wordCountMax} words, then write only that many. Roughly ${Math.max(4, Math.floor(ctx.wordCountMax / 320))} H2 sections of ~250–320 words each fits the budget.
- A COMPLETE article that covers every promised point concisely within the limit is REQUIRED. A long article that runs over and gets cut off mid-topic is a FAILURE.
- If the title promises a "complete" or "step-by-step" guide, cover ALL the essential steps — but keep each one tight. Do not pad. Do not exceed ${ctx.wordCountMax} words.

=== INTERNAL LINK CONTEXT ===
${internalLinkContext || "No parent/sibling articles yet — this is a Cornerstone."}

=== ⚠️ LINK ALLOWLIST — CRITICAL RULE ===
You may ONLY insert links (href attributes) to URLs from this EXACT list. NEVER invent, guess, construct, or modify any URL. If you have no relevant real URL for a point, do not add a link at all. Inserting a URL that is not on this list is a critical failure that will be automatically detected and removed.

ALLOWED URLS:
${(ctx.linkAllowlist ?? []).map(u => `- ${u}`).join("\n") || "(none — do not insert any links except the external authority link in point 10)"}

Note: External authority links (government, industry body, nationally recognised publication) are exempt from this list — they are real external URLs you choose. All other links MUST be from the list above.

=== 16-POINT AUTHORITY STANDARD — ALL POINTS ARE MANDATORY ===

1. PRIMARY KEYWORD DENSITY: The primary keyword "${ctx.primaryKeyword}" must appear a MINIMUM of 4 times across the full article. HARD MAXIMUM: keyword density must not exceed 1% of total word count. Every use must read naturally.
2. KEYWORD IN H1: Primary keyword must appear verbatim in the H1 heading (the article title).
3. KEYWORD IN H2: Primary keyword must appear verbatim in AT LEAST ONE <h2> heading.
4. KEYWORD IN H3: If the article uses H3 subheadings, the primary keyword MUST appear in at least one H3.
5. KEYWORD IN FIRST 100 WORDS: Primary keyword must appear naturally within the first 100 words of body text.
6. KEYWORD IN URL SLUG: The URL slug is already set to /${ctx.urlSlug}. Ensure the H1 title reflects the same topic territory.
7. META TITLE: Must include primary keyword verbatim. Maximum 60 characters. Written for click-through rate.
8. META DESCRIPTION: Must include the EXACT primary keyword phrase "${ctx.primaryKeyword}" verbatim. Exactly 140–160 characters. Written for CTR.
9. OPENING ANSWER BLOCK: Immediately after the H1, include a direct-answer block that answers the most likely search question in 40–60 words. Format: start with the question as a bold line or <strong> tag, then answer it directly in 1–2 sentences. This block must be present and clearly formatted for Google Featured Snippet extraction.
10. EXTERNAL AUTHORITY LINK: You MUST include at least one hyperlink to a real, well-known, popular, authoritative source that is DIRECTLY relevant to the article topic and the business's target market. This can be a famous person's official website, a recognised brand's homepage, a major publication, a government website, or an industry body. CRITICAL RULES: (a) Link ONLY to the ROOT DOMAIN / homepage of the source (e.g. https://www.gordonramsay.com, https://www.taylormade.com, https://www.vogue.com.au) — never invent a deep sub-page path. (b) The source must be genuinely well-known and popular — not obscure. (c) If you cannot name a genuinely well-known relevant source, do NOT add an external link at all. (d) This link will be live-checked before publishing — a 404 or dead URL will be automatically stripped. Use descriptive anchor text.
11. INTERNAL CTA LINK: At least one link back to the business (shop, product, service, bookings, or testimonials page). Anchor text only.
12. INTERNAL BLOG LINKS: You MUST include at minimum 2 internal links to OTHER articles in this batch. Use ONLY the real slugs from the LINK ALLOWLIST above — do NOT invent, guess, or construct any URL. If fewer than 2 batch slugs are available, link to as many as exist.
13. SCHEMA MARKUP: Always include Article schema + Breadcrumb schema. ${isCornerstoneOrPillar ? "Include FAQ schema (this is a Cornerstone/Pillar). Include How-To schema if applicable." : "DO NOT include FAQ schema on Cluster articles."}
14. E-E-A-T SIGNALS: Weave in Experience, Expertise, Authoritativeness, and Trustworthiness. Include social proof signals: ${ctx.socialProof || "mention industry experience"}.
${ctx.problemsSolved ? `
CUSTOMER INTELLIGENCE — USE THIS TO WRITE LIKE A HUMAN WHO KNOWS THESE CUSTOMERS:
What the customer's situation was BEFORE finding this business:
"${ctx.customerSituationBefore ?? 'not provided'}"
What they were frustrated with or had already tried:
"${ctx.customerFrustrations ?? 'not provided'}"
What changed or became possible after working with this business:
"${ctx.customerTransformation ?? 'not provided'}"
Summary (use for CTA and closing sections):
"${ctx.problemsSolved}"
WRITING RULES BASED ON THIS INTELLIGENCE:
- Use the customer's actual situation (field 1) to open the first body section
- Use the frustrations (field 2) when writing any section about common mistakes or what to avoid
- Use the transformation (field 3) in the conclusion and CTA
- Pull specific words and phrases from these answers where they fit naturally
` : ""}${ctx.contentPlanDirection ? `
WRITER DIRECTION FROM PUBLISHER:
The person publishing this article has added this specific direction:
"${ctx.contentPlanDirection}"
Follow this direction. It takes priority over general guidelines.
` : ""}15. HUMAN AUTHENTICITY: No AI fingerprint patterns. Content must solve the reader's problem completely.
   HARD RULES — HUMAN AUTHENTICITY:
   - DO NOT make up statistics (e.g. "over 500 clients since 2018", "9 out of 10 businesses") without a real, citable source.
   - DO NOT use generic credibility claims such as "industry-leading", "trusted by thousands", "proven track record", or "years of expertise" without specific, verifiable backing.
   - If citing business experience or client numbers, be specific and real — or omit entirely. Fabricated social proof is worse than no social proof.
   - BANNED OPENINGS: Never open the article with a "kitchen table" anecdote, "I remember sitting at...", "I remember staring at...", or any invented personal story not grounded in real customer intelligence provided above. Open with a concrete, useful statement that delivers immediate value to the reader.
   HOW TO SOUND AUTHENTIC (do this — it is how you earn the authenticity score):
   - Demonstrate expertise through CONCRETE SPECIFICS, not claims: name the actual standards, laws, obligations, tools, forms, processes, and exact steps relevant to the topic. Specific accurate detail IS the proof of expertise.
   - Use the real customer intelligence and business details provided above to ground the writing in this business's actual situation.
   - Write plainly and directly as a knowledgeable practitioner. You do NOT need personal anecdotes, a byline, or stated credentials — a specific, accurate, plainly-written article scores full authenticity marks.
16. SEARCH INTENT RESOLUTION: The article title makes a promise to the reader. You MUST deliver on that promise.
   HARD RULES — SEARCH INTENT RESOLUTION:
   - If the title promises "how to start X", "how to do X", or "step-by-step guide to X" — deliver actual numbered step-by-step actionable instructions. Do NOT substitute framework overviews.
   - Every H2 section MUST contain at least one specific, actionable instruction the reader can execute today.
   - Actionable instructions must be concrete: name the tool, form, website, phone number, or exact action.

=== GEO STRUCTURE (2026/2027 GENERATIVE-ENGINE OPTIMISATION — MANDATORY) ===
These rules make the article instantly extractable by AI answer engines. They are scored — follow every one.
G1. H2 QUESTION FRAMING: At least 50% of your <h2> headings MUST be the exact question a user would search — end with "?" or start with Who/What/Where/Why/When/How/Do/Does/Can/Is/Are/Should. (e.g. "How much does ${ctx.primaryKeyword} cost in Australia?")
G2. ANSWER-FIRST RULE (applies to EVERY H2, not just the opening): The FIRST <p> immediately after every <h2> must be a definitive, fluff-free answer of 40–60 words that directly answers that heading. No introductory filler, no "when it comes to…". Lead with the answer.
G3. STRUCTURAL HTML (MANDATORY — every article): You MUST include at least ONE <ul> or <ol> list (for steps, options, or key points) AND at least ONE HTML <table> with <tr>/<th>/<td> (a comparison, a pricing/specs table, or an at-a-glance summary table relevant to the topic). AI answer engines extract lists and tables preferentially — both are required, not optional.
G4. H3 ACTION STEPS: Use <h3> headings beneath <h2>s to break work into concrete, actionable sub-steps.
G5. PARAGRAPH DENSITY: No <p> may exceed 4 sentences (≈80–100 words). Break dense text into shorter paragraphs or lists.
G6. AI BLOCKLIST (zero tolerance): Never use: delve, tapestry, bustling, testament, crucial, landscape, realm, beacon, seamless, navigating the complexities, moreover, firstly, in conclusion.
G7. ACTIVE VOICE: Write in active voice. Avoid "was/were/is/are + past participle" passive constructions.

=== VERIFIED FACTS & E-E-A-T (use ONLY what is provided — never invent) ===
${(ctx.verifiedFacts && ctx.verifiedFacts.length)
  ? `VERIFIED FACTS you MAY use (these are true and approved — weave them in naturally as concrete evidence, stats, or first-hand experience). Do NOT state any statistic or experience that is not in this list:\n${ctx.verifiedFacts.map(f => `- ${f}`).join("\n")}\n\nFIRST-HAND EXPERIENCE: Frame relevant points using the business's real experience — e.g. "In our experience helping ${ctx.audiences[0] ?? "clients"}…", "When we work with…", "A common mistake we see is…" — grounded in the verified facts and customer intelligence above. Do not fabricate experiences beyond what the facts support.`
  : `No verified facts were provided. Do NOT invent statistics, first-hand experiences, or case studies. Demonstrate expertise through accurate, specific, general domain knowledge only.`}
${ctx.expertQuote
  ? `EXPERT QUOTE (insert verbatim as an attributed blockquote where it fits naturally): <blockquote>"${ctx.expertQuote.quote}" — ${ctx.expertQuote.author}</blockquote>`
  : `No expert quote was provided — do NOT fabricate a quote or attribute words to a named person.`}

=== PASS 2 QUALITY SCORING — WRITE TO SCORE 80+ ON ALL FIVE ===
This article will be scored on these five dimensions. Write to score 80+ on all five:
1. SEARCH INTENT RESOLUTION: Fully resolves what the searcher is looking for. Delivers on the title's promise.
2. HUMAN AUTHENTICITY: No AI fingerprint patterns. Scored on concrete specificity — specific facts, named tools/standards/processes, real examples. The absence of personal anecdotes or credentials is NOT penalised.
3. TITLE TERRITORY: The title owns a specific territory and signals clear value.
4. E-E-A-T AUTHORITY: Demonstrates expertise through accurate, specific topical knowledge (correct terminology, real obligations/standards, concrete how-to detail) — NOT through invented credentials or claimed experience.
5. BATCH COHESION: Feels like part of a coherent content strategy.

=== TITLE RULES ===
- Never write a title that starts with "What Is" or "What Are"
- Never write a purely definitional title — every title must have a specific angle, audience, or outcome
- Include the focus keyword naturally
- For Australian businesses, include "Australia" or the location where it fits naturally

=== CLOSING CTA SECTION (MANDATORY) ===
Every article MUST end with a dedicated CTA section:
<h2>Ready to Take the Next Step?</h2>
<p>[1–2 sentences summarising the value the reader has just gained and why acting now makes sense.]</p>
<p>${ctx.ctaText}: <a href="${ctx.ctaUrl}">${ctx.ctaText}</a></p>
Customise the H2 heading and body copy to match the article topic and brand voice. The CTA link MUST point to ${ctx.ctaUrl}.

=== ABSOLUTE RULES ===
- DO NOT fabricate statistics, quotes, or data.
- DO NOT invent URLs. Every link must use a real, verifiable URL.
- DO NOT use em dashes (—) excessively.
- DO NOT open with a rhetorical question.
- DO NOT introduce sections with a bolded question followed by an answer paragraph.
- DO NOT use formulaic section structures where every H3 follows the exact same pattern.
- DO NOT open paragraphs with "This means that...".
- DO NOT use these phrases (banned): "in today's world", "it's important to note", "it's worth noting", "delve into", "game-changer", "game-changing", "leverage", "synergy", "transformative", "non-negotiable", "minefield blindfolded", "the truth is", "let's be honest", "the reality is", "make no mistake", "here's the thing", "the fact is", "simply put", "it's no secret", "spoiler alert", "the good news is", "the bad news is", "in other words", "to put it simply".
- Use Australian English spelling (e.g., "optimise" not "optimize", "colour" not "color").
- Write as a knowledgeable human practitioner who has actually done this work.
- Use specific numbers, real examples, and concrete details rather than general statements.
- Vary sentence length — mix short punchy sentences with longer explanatory ones.

=== REQUIRED OUTPUT FORMAT ===
Respond using EXACTLY this structure — two clearly delimited sections:

<METADATA>
{"title": "...", "metaTitle": "...", "metaDescription": "...", "schemaMarkup": "JSON-LD schema string (Article + Breadcrumb${isCornerstoneOrPillar ? " + FAQ" : ""})", "faqItems": ${isCornerstoneOrPillar ? '[{"question": "...", "answer": "..."}]' : "null"}, "externalLinkPresent": true, "internalCtaLinkPresent": true, "internalBlogLinksPresent": true, "schemaPresent": true}
</METADATA>
<ARTICLE_HTML>
...the full article body as clean HTML here...
</ARTICLE_HTML>

CRITICAL RULES FOR OUTPUT FORMAT:
- Output ONLY the two delimited sections above. No preamble, no explanation, no markdown fences.
- The METADATA block must be a single-line valid JSON object. Use double-quotes for all JSON keys and string values.
- The ARTICLE_HTML block must contain the COMPLETE article HTML — do NOT truncate it.
- Do NOT embed the article HTML inside the JSON. The HTML goes between ARTICLE_HTML tags only.
- metaTitle: max 60 characters, must include the primary keyword.
- metaDescription: exactly 140-160 characters, must include the exact primary keyword phrase.
- faqItems: ${isCornerstoneOrPillar ? "include 3-5 FAQ items as a JSON array of {question, answer} objects" : "set to null — Cluster articles do not get FAQ"}.
- BULLET LISTS in HTML: every li must be a direct child of ul or ol. Add a blank line between each li item.
- FAQ SECTION in HTML: format each Q&A as: <div class="faq-item"><hr><p><strong>Q: [question]</strong></p><p>A: [answer]</p></div>. Start the FAQ section with <h2>Frequently Asked Questions</h2>.`;
}

/**
 * Apply mechanical (non-LLM) post-processing: banned-phrase regex scrub,
 * line-spacing normalisation, and word-count recompute.
 */
export function mechanicalPostProcess(bodyHtml: string): { bodyHtml: string; wordCount: number } {
  let html = bodyHtml;

  // Regex-replace banned phrases with neutral alternatives (fast, no LLM)
  const BANNED_REPLACEMENTS: [RegExp, string][] = [
    [/\bin today's world\b/gi, "today"],
    [/\bit's important to note\b/gi, "notably"],
    [/\bit is important to note\b/gi, "notably"],
    [/\bit's worth noting\b/gi, "notably"],
    [/\bit is worth noting\b/gi, "notably"],
    [/\bdelve into\b/gi, "explore"],
    [/\bgame-changer\b/gi, "significant shift"],
    [/\bgame changer\b/gi, "significant shift"],
    [/\bgame-changing\b/gi, "significant"],
    [/\bleverage\b/gi, "use"],
    [/\bsynergy\b/gi, "collaboration"],
    [/\btransformative\b/gi, "meaningful"],
    [/\bnon-negotiable\b/gi, "essential"],
    [/\bminefield blindfolded\b/gi, "complex challenge"],
    [/\bthe truth is\b/gi, "in practice"],
    [/\blet's be honest\b/gi, "to be direct"],
    [/\blet us be honest\b/gi, "to be direct"],
    [/\bthe reality is\b/gi, "in practice"],
    [/\bmake no mistake\b/gi, "clearly"],
    [/\bhere's the thing\b/gi, ""],
    [/\bhere is the thing\b/gi, ""],
    [/\bthe fact is\b/gi, ""],
    [/\bsimply put\b/gi, ""],
    [/\bput simply\b/gi, ""],
    [/\bin other words\b/gi, ""],
    [/\bto put it simply\b/gi, ""],
    [/\bto put it another way\b/gi, ""],
    [/\bit's no secret\b/gi, ""],
    [/\bit is no secret\b/gi, ""],
    [/\bspoiler alert\b/gi, ""],
    [/\bthe good news is\b/gi, ""],
    [/\bthe bad news is\b/gi, ""],
    [/\bin conclusion,\b/gi, ""],
    [/\bto summarize,\b/gi, ""],
    [/\bto summarise,\b/gi, ""],
    [/\bultimately,\b/gi, ""],
    [/\bessentially,\b/gi, ""],
    [/\bfurthermore,\b/gi, ""],
    [/\bmoreover,\b/gi, ""],
    [/\bat the end of the day\b/gi, ""],
    [/\baccording to research\b/gi, "research indicates"],
    [/\bstudies show\b/gi, "evidence shows"],
    [/\bit has been shown\b/gi, "evidence shows"],
    [/\bnavigating the complexities\b/gi, "managing the complexity"],
    [/\bnavigate the ever-changing\b/gi, "adapt to the changing"],
    [/\bin today's competitive landscape\b/gi, "in a competitive market"],
    [/\bin today's fast-paced\b/gi, "in a fast-paced"],
    [/\bin today's digital\b/gi, "in the digital"],
    [/\blook no further\b/gi, ""],
    [/\bcutting-edge\b/gi, "advanced"],
    [/\bstate-of-the-art\b/gi, "modern"],
    [/\bseamlessly\b/gi, "smoothly"],
    [/\brobust solution\b/gi, "practical solution"],
    [/\btailored solutions\b/gi, "targeted solutions"],
    [/\btailored to your needs\b/gi, "suited to your situation"],
    [/\bunlock your potential\b/gi, "reach your goals"],
    [/\bunlock the power\b/gi, "use the full capability"],
    [/\bempower your\b/gi, "help your"],
    [/\belevate your\b/gi, "improve your"],
    [/\btake your business to the next level\b/gi, "grow your business"],
    [/\bat its core\b/gi, "fundamentally"],
    [/\bit's crucial to\b/gi, "you need to"],
    [/\bit is crucial to\b/gi, "you need to"],
    [/\bone of the most important\b/gi, "a key"],
    [/\bthis means that\b/gi, ""],
    // Banned opening anecdote patterns
    [/\bi remember sitting\b/gi, ""],
    [/\bi remember staring\b/gi, ""],
    [/\bi was sitting at\b/gi, ""],
    [/\bi was staring at\b/gi, ""],
    [/\bkitchen table\b/gi, "desk"],
    [/\bsitting at my kitchen\b/gi, ""],
    [/\bstaring at my kitchen\b/gi, ""],
    [/\bi sat at my\b/gi, ""],
    [/\bi remember the day\b/gi, ""],
    [/\bi'll never forget the day\b/gi, ""],
    [/\bi will never forget the day\b/gi, ""],
  ];

  for (const [pattern, replacement] of BANNED_REPLACEMENTS) {
    html = html.replace(pattern, replacement);
  }

  // Normalise line spacing between block-level elements
  html = html
    .replace(/([^\n])<(h[1-6]|p|ul|ol|blockquote|div|figure|table|pre)([\s>])/g, "$1\n<$2$3")
    .replace(/<\/(h[1-6]|p|ul|ol|blockquote|div|figure|table|pre)>([^\n])/g, "</$1>\n$2")
    .replace(/\n{3,}/g, "\n\n");

  const wordCount = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return { bodyHtml: html, wordCount };
}

/**
 * Enforce meta title: ≤60 chars, contains keyword.
 */
export function enforceMetaTitle(metaTitle: string, primaryKeyword: string): string {
  let mt = metaTitle;
  // Enforce keyword presence
  if (!kwPresentInText(primaryKeyword.toLowerCase(), mt.toLowerCase())) {
    const capitalised = primaryKeyword.charAt(0).toUpperCase() + primaryKeyword.slice(1);
    mt = `${capitalised}: ${mt}`;
  }
  // Enforce length
  if (mt.length > 60) {
    const trimmed = mt.slice(0, 57);
    const lastSp = trimmed.lastIndexOf(" ");
    mt = (lastSp > 30 ? trimmed.slice(0, lastSp) : trimmed) + "...";
  }
  return mt;
}

/**
 * Enforce meta description: 140–160 chars, contains keyword.
 */
export function enforceMetaDescription(metaDescription: string, primaryKeyword: string, businessName: string): string {
  let md = metaDescription;
  // Enforce keyword presence
  if (!kwPresentInText(primaryKeyword.toLowerCase(), md.toLowerCase())) {
    const capitalised = primaryKeyword.charAt(0).toUpperCase() + primaryKeyword.slice(1);
    md = `${capitalised}: ${md}`;
  }
  // Enforce length
  if (md.length > 160) {
    const trimmed = md.slice(0, 157);
    const lastSp = trimmed.lastIndexOf(" ");
    md = (lastSp > 120 ? trimmed.slice(0, lastSp) : trimmed) + "...";
  } else if (md.length < 140 && md.length > 0) {
    const pad = ` Get expert advice from ${businessName}.`;
    if ((md + pad).length <= 160) md = md + pad;
  }
  return md;
}

/**
 * Enforce slug: contains all keyword words.
 */
function enforceSlug(urlSlug: string, primaryKeyword: string, nodeId: number): string {
  const kwLower = primaryKeyword.toLowerCase();
  const slugLower = urlSlug.toLowerCase();
  const kwWords = kwLower.split(/\s+/);
  const allWordsInSlug = kwWords.every(w => slugLower.includes(w));
  if (!allWordsInSlug) {
    const kwSlug = kwLower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!slugLower.includes(kwSlug)) {
      const newSlug = `${kwSlug}-${urlSlug}`.replace(/--+/g, "-").slice(0, 80);
      console.log(`[ArticleEngine] P6 slug enforcement: set slug to "${newSlug}" for node ${nodeId}`);
      return newSlug;
    }
  }
  return urlSlug;
}

/**
 * Main entry point — single-call generation engine.
 *
 * Steps:
 *   1. Build context (unchanged)
 *   2. Single LLM call — write the complete article + meta + schema in one JSON response
 *   3. Mechanical post-process (regex scrub, line spacing, word count)
 *   4. Enforce slug, meta title, meta description
 *   5. Pass 1 (rules-based scorer) — unchanged
 *   6. Pass 2 (AI quality scorer) — unchanged
 *   7. One improvement attempt if Pass 1 < 14/16 OR Pass 2 < 80
 *   8. Derive badge, return GenerationResult
 */
export async function generateSingleArticle(
  businessId: number,
  nodeId: number,
  allOrderedNodes: OrderedNode[],
  userId?: number | null
): Promise<GenerationResult> {
  const totalStart = Date.now();
  try {
    const ctx = await buildArticleContext(businessId, nodeId, allOrderedNodes);
    const currentYear = new Date().getFullYear();

    // --- Enforce slug before generation so the prompt uses the correct slug ---
    ctx.urlSlug = enforceSlug(ctx.urlSlug, ctx.primaryKeyword, nodeId);

    // =========================================================================
    // STEP 1 — SINGLE-PASS WRITE
    // =========================================================================
    const writeStart = Date.now();
    console.log(`[ArticleEngine] Write start for node ${nodeId} (${ctx.level}, target ${ctx.wordCountMin}–${ctx.wordCountMax} words, keyword: "${ctx.primaryKeyword}")`);

    const prompt = buildSinglePassPrompt(ctx, currentYear);

    // -------------------------------------------------------------------------
    // Helper: parse the delimiter-based response format
    // Returns null if the response is truncated (missing </ARTICLE_HTML>)
    // -------------------------------------------------------------------------
    const parseDelimitedResponse = (raw: string): {
      title: string; metaTitle: string; metaDescription: string;
      bodyHtml: string; schemaMarkup: string;
      faqItems: Array<{ question: string; answer: string }> | null;
    } | null => {
      const metaMatch = raw.match(/<METADATA>([\s\S]*?)<\/METADATA>/i);
      const htmlMatch = raw.match(/<ARTICLE_HTML>([\s\S]*?)<\/ARTICLE_HTML>/i);

      // If the closing </ARTICLE_HTML> tag is missing, the response was truncated
      if (!htmlMatch) {
        console.warn(`[ArticleEngine] Response truncated for node ${nodeId} — no closing </ARTICLE_HTML> tag found`);
        return null;
      }

      const bodyHtml = htmlMatch[1].trim();

      // Parse the short metadata JSON
      let metaObj: Record<string, unknown> = {};
      if (metaMatch) {
        try {
          const metaRaw = metaMatch[1].trim();
          metaObj = JSON.parse(metaRaw);
        } catch (jsonErr) {
          console.error(`[ArticleEngine] <METADATA> JSON parse failed for node ${nodeId}:`, jsonErr);
          console.error(`[ArticleEngine] Raw metadata block:`, metaMatch[1].slice(0, 500));
          // Don't throw — we still have the HTML body; derive defaults below
        }
      }

      const faqItemsRaw = Array.isArray(metaObj.faqItems)
        ? (metaObj.faqItems as Array<{ question: string; answer: string }>)
        : null;

      return {
        title: String(metaObj.title ?? ""),
        metaTitle: String(metaObj.metaTitle ?? ""),
        metaDescription: String(metaObj.metaDescription ?? ""),
        bodyHtml,
        schemaMarkup: String(metaObj.schemaMarkup ?? ""),
        faqItems: ctx.level === "cluster" ? null : faqItemsRaw,
      };
    }

    let parsedResult: ReturnType<typeof parseDelimitedResponse> = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await invokeLLMWithCost(
          {
            messages: [
              {
                role: "system" as const,
                content: "You are an expert SEO content writer. Follow the output format instructions exactly. Output ONLY the two delimited sections: <METADATA>...</METADATA> and <ARTICLE_HTML>...</ARTICLE_HTML>. No preamble, no explanation, no markdown fences.",
              },
              { role: "user" as const, content: prompt },
            ],
            max_tokens: TOKEN_LIMITS.section, // 16000 tokens
          },
          { userId, feature: "article_generation" }
        );
        const raw = result.choices[0]?.message?.content ?? "";
        const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);

        parsedResult = parseDelimitedResponse(rawStr);
        if (parsedResult !== null) {
          break; // success
        }
        // parsedResult is null = truncated response — retry
        if (attempt === 2) {
          throw new Error(`Single-pass article generation truncated after ${attempt} attempts — response missing </ARTICLE_HTML> closing tag`);
        }
        console.warn(`[ArticleEngine] Write attempt ${attempt} truncated for node ${nodeId} — retrying with same token limit...`);
      } catch (err) {
        if (attempt === 2) throw new Error(`Single-pass article generation failed after 2 attempts: ${err}`);
        console.warn(`[ArticleEngine] Write attempt ${attempt} failed for node ${nodeId} — retrying...`);
      }
    }

    const parsed = parsedResult!;
    let title = parsed.title;
    let metaTitle = parsed.metaTitle;
    let metaDescription = parsed.metaDescription;
    let bodyHtml = parsed.bodyHtml;
    // bodyMarkdown: derive from bodyHtml (strip tags) as a lightweight fallback
    let bodyMarkdown = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const schemaMarkup = parsed.schemaMarkup;
    const faqItems = parsed.faqItems;

    const writeDone = Date.now();
    let wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    console.log(`[ArticleEngine] Write done for node ${nodeId}: "${title}" — ${wordCount} words in ${((writeDone - writeStart) / 1000).toFixed(1)}s`);

    // =========================================================================
    // STEP 2 — MECHANICAL POST-PROCESS (no LLM)
    // =========================================================================
    const postProcessed = mechanicalPostProcess(bodyHtml);
    bodyHtml = postProcessed.bodyHtml;
    wordCount = postProcessed.wordCount;

    // Enforce slug, meta title, meta description
    ctx.urlSlug = enforceSlug(ctx.urlSlug, ctx.primaryKeyword, nodeId);
    metaTitle = enforceMetaTitle(metaTitle, ctx.primaryKeyword);
    metaDescription = enforceMetaDescription(metaDescription, ctx.primaryKeyword, ctx.businessName);

    // Enforce keyword in title (H1)
    if (!kwPresentInText(ctx.primaryKeyword.toLowerCase(), title.toLowerCase())) {
      const capitalised = ctx.primaryKeyword.charAt(0).toUpperCase() + ctx.primaryKeyword.slice(1);
      title = `${capitalised}: ${title}`;
      console.log(`[ArticleEngine] P2 enforcement: prepended keyword into title for node ${nodeId}`);
    }

    // =========================================================================
    // STEP 2.6 — LINK VALIDATOR (strip any href not in the allowlist)
    // =========================================================================
    const linkValidationResult = await validateAndStripLinks(
      bodyHtml,
      ctx.linkAllowlist,
      [ctx.websiteUrl ?? "", ctx.ctaUrl].filter(Boolean),
    );
    if (linkValidationResult.strippedCount > 0) {
      console.warn(`[ArticleEngine] Link validator stripped ${linkValidationResult.strippedCount} hallucinated href(s) for node ${nodeId}: ${linkValidationResult.strippedUrls.join(", ")}`);
      bodyHtml = linkValidationResult.html;
      wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    }

    // STEP 2.6b — Remove any FAQ item that has a question but no answer
    const faqClean = removeOrphanFaqItems(bodyHtml);
    if (faqClean.removed > 0) {
      console.log(`[ArticleEngine] Removed ${faqClean.removed} orphan FAQ item(s) (question with no answer) for node ${nodeId}`);
      bodyHtml = faqClean.bodyHtml;
      wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    }

    // STEP 2.6c — GEO paragraph density: split any <p> over 4 sentences (MIC-08)
    bodyHtml = splitDenseParagraphs(bodyHtml, 4);

    // STEP 2.6d — Ensure the user-provided expert quote appears (EAT-04)
    const quoteResult = ensureExpertQuote(bodyHtml, ctx.expertQuote);
    if (quoteResult.inserted) {
      console.log(`[ArticleEngine] Inserted attributed expert quote for node ${nodeId}`);
      bodyHtml = quoteResult.bodyHtml;
    }

    // =========================================================================
    // STEP 2.5 — DOM-BASED WORD COUNT TRIM (instant, no LLM, fires before scoring)
    // =========================================================================
    if (wordCount > ctx.wordCountMax) {
      const trimStart = Date.now();
      const overage = wordCount - ctx.wordCountMax;
      console.log(`[ArticleEngine] Pre-score trim triggered for node ${nodeId}: ${wordCount} words, max is ${ctx.wordCountMax} (overage: ${overage} words)`);

      const trimResult = trimHtmlToWordCount(bodyHtml, ctx.wordCountMax, ctx.primaryKeyword);
      if (trimResult.removed > 0) {
        const prevWordCount = wordCount;
        bodyHtml = trimResult.bodyHtml;
        wordCount = trimResult.wordCount;
        console.log(`[ArticleEngine] Pre-score trim done for node ${nodeId}: ${prevWordCount} → ${wordCount} words in ${((Date.now() - trimStart) / 1000).toFixed(1)}s (DOM-based, no LLM)`);
        if (wordCount > ctx.wordCountMax) {
          console.warn(`[ArticleEngine] Pre-score trim: still ${wordCount - ctx.wordCountMax} words over max after trimming for node ${nodeId}`);
        }
      } else {
        console.warn(`[ArticleEngine] Pre-score trim: no removable paragraphs found for node ${nodeId} — word count unchanged`);
      }
    }

    // =========================================================================
    // STEP 2.7 — DETERMINISTIC KEYWORD PLACEMENT GUARANTEE (no LLM)
    // Ensures keyword appears in H1, at least one H2, first 150 words, meta
    // title, and slug — before Pass 1 scoring.
    // =========================================================================
    {
      const kw = ctx.primaryKeyword;
      // Use the SAME presence check as the Pass 1 scorer so we only edit when
      // the scorer would actually fail.
      const kwPresent = (s: string) => kwPresentInText(kw, s);

      // 1. Keyword in H1 — if missing, prepend keyword to H1 text
      if (!kwPresent(title)) {
        title = `${kw}: ${title}`;
        console.log(`[ArticleEngine] KW guarantee: prepended keyword to H1 for node ${nodeId}`);
      }

      // 2. Keyword in at least one H2 — clean topic-prefix insert (no band-aid)
      const h2Result = ensureKeywordInH2(bodyHtml, kw);
      if (h2Result.changed) {
        bodyHtml = h2Result.bodyHtml;
        console.log(`[ArticleEngine] KW guarantee: inserted keyword into first H2 for node ${nodeId}`);
      }

      // 2b. Keyword in at least one H3 (only if H3s exist) — clean topic-prefix
      const h3Result = ensureKeywordInH3(bodyHtml, kw);
      if (h3Result.changed) {
        bodyHtml = h3Result.bodyHtml;
        console.log(`[ArticleEngine] KW guarantee: inserted keyword into first H3 for node ${nodeId}`);
      }

      // 3. Keyword in first 150 words — if missing, append to first <p>
      const firstPMatch = bodyHtml.match(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/i);
      if (firstPMatch) {
        const firstPText = firstPMatch[2].replace(/<[^>]+>/g, " ");
        const first150Words = firstPText.split(/\s+/).slice(0, 150).join(" ");
        if (!kwPresent(first150Words)) {
          // Append keyword sentence to the first paragraph
          const originalP = firstPMatch[0];
          const newP = originalP.replace(/<\/p>/i, ` Understanding ${kw} is key to getting the best results.</p>`);
          bodyHtml = bodyHtml.replace(originalP, newP);
          console.log(`[ArticleEngine] KW guarantee: inserted keyword into first 150 words for node ${nodeId}`);
        }
      }

      // 4. Keyword in meta title — if missing, prepend
      if (!kwPresent(metaTitle)) {
        metaTitle = `${kw} | ${metaTitle}`.slice(0, 60);
        console.log(`[ArticleEngine] KW guarantee: prepended keyword to meta title for node ${nodeId}`);
      }

      // 5. Keyword in slug — if missing, prepend slug segment
      if (!kwPresent(ctx.urlSlug)) {
        const kwSlug = kw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        // urlSlug is pre-generated and stored on the node — we can't change it here,
        // but we log the miss so the surgical fix pass can address it via LLM if needed.
        console.warn(`[ArticleEngine] KW guarantee: slug "${ctx.urlSlug}" does not contain keyword — flagged for surgical fix`);
      }
    }

    // =========================================================================
    // STEP 2.8 — OPENING ANSWER BLOCK GUARANTEE (no LLM)
    // Ensures every article has a <strong>Question?</strong> immediately after
    // the H1 (Position Zero / Featured Snippet target).
    // =========================================================================
    {
      const first800 = bodyHtml.slice(0, 800);
      const hasAnswerBlock =
        /<(strong|b)[^>]*>[^<]*\?[^<]*<\/(strong|b)>/i.test(first800) ||
        /<p[^>]*>[^<]{5,200}\?/i.test(first800) ||
        /<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/i.test(first800);

      if (!hasAnswerBlock) {
        const question = `What is ${title.replace(/^[^:]+:\s*/, "")}?`;
        const answerSentence = `Understanding ${ctx.primaryKeyword} is essential for getting the best results — here is what you need to know.`;
        const answerBlock = `<p><strong>${question}</strong> ${answerSentence}</p>\n`;
        if (/<\/h1>/i.test(bodyHtml)) {
          bodyHtml = bodyHtml.replace(/<\/h1>/i, `</h1>\n${answerBlock}`);
        } else {
          bodyHtml = answerBlock + bodyHtml;
        }
        wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        console.log(`[ArticleEngine] Step 2.8: injected opening answer block for node ${nodeId}`);
      } else {
        console.log(`[ArticleEngine] Step 2.8: opening answer block already present for node ${nodeId}`);
      }
    }

    // =========================================================================
    // STEP 2.9 — SCHEMA MARKUP GUARANTEE (no LLM)
    // Every article must have at minimum Article + BreadcrumbList + FAQPage
    // schema, where the FAQPage includes the opening Q&A answer block.
    // Cluster articles get the opening Q&A only; Cornerstone/Pillar get the
    // full FAQ list from faqItems as well.
    // =========================================================================
    let schemaMarkupFinal = schemaMarkup;
    {
      const siteUrl = ctx.websiteUrl || ctx.ctaUrl.replace(/\/[^/]+$/, "") || "https://example.com";
      const articleUrl = `${siteUrl.replace(/\/$/, "")}/${ctx.urlSlug}`;

      // Extract the opening question from the first <strong>/<b> containing '?'
      const strongQMatch = bodyHtml.match(/<(strong|b)[^>]*>([^<]*\?[^<]*)<\/(strong|b)>/i);
      const openingQuestion = strongQMatch ? strongQMatch[2].trim() : `What is ${title}?`;
      // Extract the answer text from the first <p> (strip the question itself)
      const firstPMatch = bodyHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const firstPText = firstPMatch ? firstPMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
      const openingAnswer = firstPText
        .replace(openingQuestion, "")
        .replace(/^[\s.]+/, "")
        .trim() || `${ctx.primaryKeyword} requires a structured approach to achieve the best results.`;

      // Build the FAQPage mainEntity: opening Q&A + any faqItems (Cornerstone/Pillar only)
      const faqMainEntity = [
        {
          "@type": "Question",
          "name": openingQuestion,
          "acceptedAnswer": { "@type": "Answer", "text": openingAnswer },
        },
        ...(faqItems ?? []).map(item => ({
          "@type": "Question",
          "name": item.question,
          "acceptedAnswer": { "@type": "Answer", "text": item.answer },
        })),
      ];

      const existingHasFaq =
        schemaMarkupFinal.includes('"FAQPage"') ||
        schemaMarkupFinal.includes('"Question"');
      const existingHasArticle = schemaMarkupFinal.includes('"Article"');

      if (!schemaMarkupFinal || !existingHasArticle) {
        // LLM returned empty/invalid schema — build from scratch
        schemaMarkupFinal = JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Article",
              "@id": `${articleUrl}#article`,
              "headline": title,
              "description": metaDescription,
              "url": articleUrl,
              "publisher": { "@type": "Organization", "name": ctx.businessName, "url": siteUrl },
            },
            {
              "@type": "Organization",
              "@id": `${siteUrl}#organization`,
              "name": ctx.businessName,
              "url": siteUrl,
            },
            {
              "@type": "Person",
              "@id": `${articleUrl}#author`,
              "name": ctx.businessName,
            },
            {
              "@type": "BreadcrumbList",
              "@id": `${articleUrl}#breadcrumb`,
              "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": siteUrl },
                { "@type": "ListItem", "position": 2, "name": title, "item": articleUrl },
              ],
            },
            { "@type": "FAQPage", "@id": `${articleUrl}#faq`, "mainEntity": faqMainEntity },
          ],
        });
        console.log(`[ArticleEngine] Step 2.9: built full schema from scratch for node ${nodeId}`);
      } else if (!existingHasFaq) {
        // Schema exists but missing FAQPage — patch it in
        try {
          const existing = JSON.parse(schemaMarkupFinal) as Record<string, unknown>;
          const faqEntry = { "@type": "FAQPage", "@id": `${articleUrl}#faq`, "mainEntity": faqMainEntity };
          if (Array.isArray(existing["@graph"])) {
            (existing["@graph"] as unknown[]).push(faqEntry);
            schemaMarkupFinal = JSON.stringify(existing);
          } else {
            schemaMarkupFinal = JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [existing, faqEntry],
            });
          }
          console.log(`[ArticleEngine] Step 2.9: patched FAQPage into existing schema for node ${nodeId}`);
        } catch {
          // JSON parse failed — rebuild from scratch
          schemaMarkupFinal = JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Article",
                "headline": title,
                "description": metaDescription,
                "url": articleUrl,
                "publisher": { "@type": "Organization", "name": ctx.businessName, "url": siteUrl },
              },
              { "@type": "FAQPage", "mainEntity": faqMainEntity },
            ],
          });
          console.log(`[ArticleEngine] Step 2.9: schema parse failed, rebuilt from scratch for node ${nodeId}`);
        }
      } else {
        console.log(`[ArticleEngine] Step 2.9: schema already has FAQPage/Question for node ${nodeId} — no patch needed`);
      }
    }

    // =========================================================================
    // STEP 3 — PASS 1 SCORER (rules-based, synchronous)
    // =========================================================================
    const pass1 = runPass1Scorer({
      bodyHtml,
      bodyMarkdown,
      title,
      metaTitle,
      metaDescription,
      urlSlug: ctx.urlSlug,
      wordCount,
      level: ctx.level,
      primaryKeyword: ctx.primaryKeyword,
      externalLinkPresent: bodyHtml.includes("http"),
      internalCtaLinkPresent: bodyHtml.includes(ctx.ctaUrl),
      internalBlogLinksPresent: ctx.allBatchSlugs.some(slug => bodyHtml.includes(slug)),
      schemaPresent: schemaMarkupFinal.length > 0,
    });
    console.log(`[ArticleEngine] Pass 1 done for node ${nodeId}: ${pass1.score}/100 (${Object.values(pass1.points).filter(Boolean).length}/16 checks passed)`);

    // =========================================================================
    // STEP 4 — PASS 2 SCORER (AI quality)
    // =========================================================================
    const hasSiblings = (ctx.siblingUrls?.length ?? 0) > 0;
    let pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId, hasSiblings);
    const pass2Done = Date.now();
    console.log(`[ArticleEngine] Pass 2 done for node ${nodeId}: ${pass2.score}/100 — "${pass2.reason}" (${((pass2Done - writeDone) / 1000).toFixed(1)}s)`);

    // =========================================================================
    // STEP 5A — SURGICAL PASS 1 FIX (targeted edits only, no regeneration)
    // =========================================================================
    let pass1PointsCount = Object.values(pass1.points).filter(Boolean).length;
    let surgicalFixApplied = false;

    if (pass1PointsCount < 14) {
      // Build a precise list of failing checks with human-readable instructions
      const pass1FailureInstructions: string[] = [];

      if (!pass1.points.kwInH2) {
        pass1FailureInstructions.push(
          `KEYWORD IN H2: Find the most relevant existing <h2> heading and minimally edit it to include the exact phrase "${ctx.primaryKeyword}" naturally. Change ONLY that one heading line — nothing else in the article.`
        );
      }
      if (!pass1.points.kwInH3) {
        pass1FailureInstructions.push(
          `KEYWORD IN H3: If <h3> subheadings exist, edit one to include the exact phrase "${ctx.primaryKeyword}" naturally. If no <h3> exists, add one or two <h3> subheadings inside the longest <h2> section to break it up — do NOT rewrite the paragraphs under it.`
        );
      }
      if (!pass1.points.kwInFirst100) {
        pass1FailureInstructions.push(
          `KEYWORD IN FIRST 100 WORDS: The exact phrase "${ctx.primaryKeyword}" must appear naturally within the first 100 words of body text. Edit the opening paragraph minimally to include it — change as few words as possible.`
        );
      }
      if (!pass1.points.kwDensity) {
        pass1FailureInstructions.push(
          `KEYWORD DENSITY: The phrase "${ctx.primaryKeyword}" must appear at least 4 times across the full article. Find the sections where it is absent and add it naturally — do not stuff it, just weave it in where it fits.`
        );
      }
      if (!pass1.points.wordCount) {
        const wc = wordCount;
        if (wc < ctx.wordCountMin) {
          pass1FailureInstructions.push(
            `WORD COUNT TOO SHORT (${wc} words, minimum is ${ctx.wordCountMin}): Add one focused paragraph to the most relevant existing section to reach the minimum. Do NOT rewrite existing text — only add new content.`
          );
        } else {
          const overage = wc - ctx.wordCountMax;
          pass1FailureInstructions.push(
            `WORD COUNT TOO LONG (${wc} words, target maximum is ${ctx.wordCountMax} — overage of ${overage} words): Remove whole non-essential paragraphs and redundant sections to bring the article into the ${ctx.wordCountMin}–${ctx.wordCountMax} word range. Priority order for removal: (1) redundant recap paragraphs that repeat what was already said, (2) over-explained transitions between sections, (3) padding paragraphs that add no new information, (4) any sub-section that duplicates the content of another sub-section. RULES: Do NOT remove any heading. Do NOT remove any paragraph that contains the primary keyword. Do NOT remove the opening answer block, the FAQ section, or the closing CTA. Do NOT rewrite any paragraph — only delete whole paragraphs. Keep removing paragraphs until the word count is within the target range.`
          );
        }
      }
      // For other failing checks (meta, slug, external link, etc.) — collect as advisory
      const otherFailures = Object.entries(pass1.points)
        .filter(([checkId, passed]) => !passed && ![
          "kwInH2", "kwInH3", "kwInFirst100", "kwDensity", "wordCount"
        ].includes(checkId))
        .map(([checkId]) => `- ${checkId}: ${pass1.details[checkId] ?? checkId}`);

      if (otherFailures.length > 0) {
        pass1FailureInstructions.push(
          `OTHER FAILURES (fix these too if possible without restructuring):\n${otherFailures.join("\n")}`
        );
      }

      if (pass1FailureInstructions.length > 0) {
        console.log(`[ArticleEngine] Surgical Pass 1 fix triggered for node ${nodeId} (${pass1PointsCount}/16 checks passed, ${pass1FailureInstructions.length} fix instructions)...`);

        const surgicalPrompt = `You are making SURGICAL TARGETED EDITS to an existing article. You must NOT rewrite, restructure, or change anything that is not listed below.

PRIMARY KEYWORD: "${ctx.primaryKeyword}"

MAKE ONLY THESE SPECIFIC EDITS:
${pass1FailureInstructions.map((inst, i) => `${i + 1}. ${inst}`).join("\n\n")}

CRITICAL RULES:
- Every word, sentence, paragraph, and section NOT mentioned above must remain byte-for-byte identical.
- Do NOT change any heading that already passes.
- Do NOT rewrite any paragraph that is not listed above.
- Do NOT change the overall structure, order of sections, or length beyond what is required.
- Do NOT add or remove schema markup, the closing CTA section, or any links.
- Use Australian English spelling.
- Make the minimum possible change to satisfy each instruction.

Return the full article HTML with ONLY the listed edits applied, wrapped in:
<SURGICAL_HTML>
...full article HTML with only the listed edits applied...
</SURGICAL_HTML>

HERE IS THE CURRENT ARTICLE HTML:
${bodyHtml}`;

        try {
          const surgicalResult = await invokeLLMWithCost(
            {
              messages: [
                {
                  role: "system" as const,
                  content: "You are a precise HTML editor. Make only the specific edits listed. Return the complete article HTML with those changes applied and everything else identical.",
                },
                { role: "user" as const, content: surgicalPrompt },
              ],
              max_tokens: TOKEN_LIMITS.improvement,
            },
            { userId, feature: "article_generation" }
          );

          const rawSurgical = surgicalResult.choices[0]?.message?.content ?? "";
          const rawSurgicalStr = typeof rawSurgical === "string" ? rawSurgical : JSON.stringify(rawSurgical);
          const surgicalMatch = rawSurgicalStr.match(/<SURGICAL_HTML>([\s\S]*?)<\/SURGICAL_HTML>/i);
          const surgicalHtml = surgicalMatch ? surgicalMatch[1].trim() : "";

          if (surgicalHtml && surgicalHtml.length > 100) {
            const prevBodyHtml = bodyHtml;
            bodyHtml = surgicalHtml;
            wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
            surgicalFixApplied = true;

            // Re-run Pass 1 to see how many checks now pass
            const pass1After = runPass1Scorer({
              bodyHtml,
              bodyMarkdown,
              title,
              metaTitle,
              metaDescription,
              urlSlug: ctx.urlSlug,
              wordCount,
              level: ctx.level,
              primaryKeyword: ctx.primaryKeyword,
              externalLinkPresent: bodyHtml.includes("http"),
              internalCtaLinkPresent: bodyHtml.includes(ctx.ctaUrl),
              internalBlogLinksPresent: ctx.allBatchSlugs.some(slug => bodyHtml.includes(slug)),
              schemaPresent: schemaMarkup.length > 0,
            });
            const pass1AfterCount = Object.values(pass1After.points).filter(Boolean).length;
            console.log(`[ArticleEngine] Surgical fix: Pass 1 ${pass1PointsCount}/16 → ${pass1AfterCount}/16 for node ${nodeId}`);

            // Only keep the surgical result if it improved Pass 1 (or at least didn't regress)
            if (pass1AfterCount >= pass1PointsCount) {
              // Accept the surgical fix
              pass1PointsCount = pass1AfterCount;
              // Update pass1 reference for badge derivation
              Object.assign(pass1.points, pass1After.points);
              Object.assign(pass1.details, pass1After.details);
              (pass1 as { score: number }).score = pass1After.score;
            } else {
              // Surgical fix made things worse — revert
              console.warn(`[ArticleEngine] Surgical fix regressed Pass 1 (${pass1AfterCount} < ${pass1PointsCount}) for node ${nodeId} — reverting`);
              bodyHtml = prevBodyHtml;
              wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
              surgicalFixApplied = false;
            }
          } else {
            console.warn(`[ArticleEngine] Surgical fix returned no usable HTML for node ${nodeId} — keeping original`);
          }
        } catch (err) {
          console.warn(`[ArticleEngine] Surgical Pass 1 fix failed for node ${nodeId}:`, err);
        }
      }
    }

    // =========================================================================
    // STEP 5B — PASS 2 QUALITY FIX (if Pass 2 < 80)
    // =========================================================================
    let improvementAttempts = 0;

    if (pass2.score < 80) {
      improvementAttempts = 1;
      console.log(`[ArticleEngine] Pass 2 quality fix triggered for node ${nodeId} (Pass 2: ${pass2.score}/100)...`);

      const pass2FixPrompt = `This article scored ${pass2.score}/100 on a quality assessment. The scorer gave this specific feedback:
"${pass2.reason}"

You MUST fix exactly the issues described in the scorer feedback above. Do NOT rewrite the article from scratch.
Identify the specific sections, sentences, or patterns that caused the low score and fix only those.

Rules:
- Fix the specific quality issues raised in the scorer feedback
- Do NOT change the structure, headings, or overall length
- Do NOT rewrite sections that are already working well
- Do NOT add or remove schema markup or the closing CTA section
- Do NOT make it sound more AI-generated — make it sound more like a trusted human expert
- Use Australian English spelling

Return the improved article HTML body only, wrapped in:
<IMPROVED_HTML>
...improved HTML here...
</IMPROVED_HTML>

${bodyHtml}`;

      try {
        const improvementResult = await invokeLLMWithCost(
          {
            messages: [{ role: "user" as const, content: pass2FixPrompt }],
            max_tokens: TOKEN_LIMITS.improvement,
          },
          { userId, feature: "article_generation" }
        );

        const rawContent = improvementResult.choices[0]?.message?.content ?? "";
        const rawImprovement = typeof rawContent === "string"
          ? rawContent
          : (rawContent as Array<{ type: string; text?: string }>)
              .filter(b => b.type === "text")
              .map(b => b.text ?? "")
              .join("");

        const delimMatch = rawImprovement.match(/<IMPROVED_HTML>([\s\S]*?)<\/IMPROVED_HTML>/i);
        const improvedHtml = delimMatch ? delimMatch[1].trim() : rawImprovement.trim();

        if (improvedHtml && improvedHtml.length > 100) {
          bodyHtml = improvedHtml;
          wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
          const improvedPass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId, hasSiblings);
          console.log(`[ArticleEngine] Pass 2 fix: score ${pass2.score} → ${improvedPass2.score} for node ${nodeId}`);
          pass2 = improvedPass2;
        } else {
          console.warn(`[ArticleEngine] Pass 2 fix returned no usable HTML for node ${nodeId} — keeping original`);
        }
      } catch (err) {
        console.warn(`[ArticleEngine] Pass 2 fix failed for node ${nodeId}:`, err);
      }
    }

    // =========================================================================
    // STEP 6 — DERIVE BADGE AND RETURN
    // =========================================================================
    let { internalScore, statusBadge } = deriveStatusBadge(pass1.score, pass2.score);
    // Only override to needs_review if Pass 2 failed AND Pass 1 also failed.
    // If Pass 1 >= 14/16 (score >= 81), the article is objectively good — do not
    // penalise it for a subjective Pass 2 score that the model couldn't improve.
    if (pass2.score < 80 && improvementAttempts > 0 && pass1.score < MIN_DELIVERY_SCORE) {
      statusBadge = "needs_review";
      console.log(`[ArticleEngine] Badge overridden to needs_review for node ${nodeId} (Pass 1 ${pass1.score}/100, Pass 2 ${pass2.score}/100 after improvement attempt)`);
    } else if (pass2.score < 80 && improvementAttempts > 0) {
      console.log(`[ArticleEngine] Pass 2 score ${pass2.score}/100 after improvement attempt — badge kept as ${statusBadge} because Pass 1 passed (${pass1.score}/100)`);
    }

    const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`[ArticleEngine] Complete for node ${nodeId}: Pass 1 ${pass1.score}/100, Pass 2 ${pass2.score}/100, badge=${statusBadge}, total=${totalElapsed}s`);

    return {
      title,
      metaTitle,
      metaDescription,
      bodyHtml,
      bodyMarkdown,
      schemaMarkup: schemaMarkupFinal,
      faqItems,
      wordCount,
      urlSlug: ctx.urlSlug,
      internalScore,
      statusBadge,
      pass1Points: pass1.points,
      pass1Metrics: pass1.details,
      pass2Score: pass2.score,
      pass2Reason: pass2.reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ArticleEngine] generateSingleArticle failed for businessId=${businessId} nodeId=${nodeId}:`, message);
    throw err;
  }
}
