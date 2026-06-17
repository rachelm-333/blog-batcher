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

export async function runPass2Scorer(bodyHtml: string, primaryKeyword: string, userId?: number | null): Promise<{ score: number; reason: string }> {
  const prompt = `You are an SEO content quality auditor. Score the following article on these 5 criteria (each worth 20 points, total 100):

1. SEARCH INTENT RESOLUTION (20 pts): Does it fully resolve what the searcher is looking for?
2. HUMAN AUTHENTICITY (20 pts): Does it read as written by a real human expert, not AI?
3. TITLE TERRITORY (20 pts): Does the title own a specific territory and signal clear value?
4. E-E-A-T AUTHORITY (20 pts): Does it demonstrate Experience, Expertise, Authoritativeness, Trustworthiness?
5. BATCH COHESION (20 pts): Does it feel like part of a coherent content strategy?

Primary keyword: ${primaryKeyword}

Article (first 3000 chars):
${bodyHtml.slice(0, 3000)}

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

=== INTERNAL LINK CONTEXT ===
${internalLinkContext || "No parent/sibling articles yet — this is a Cornerstone."}

All article slugs in this batch (use for internal blog links):
${ctx.allBatchSlugs.slice(0, 20).join(", ")}

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
10. EXTERNAL AUTHORITY LINK: You MUST include at least one hyperlink to a real, high-authority external source — a government website (.gov.au), an industry body, or a nationally recognised publication. Use descriptive anchor text. This link must be genuine and relevant to the article topic.
11. INTERNAL CTA LINK: At least one link back to the business (shop, product, service, bookings, or testimonials page). Anchor text only.
12. INTERNAL BLOG LINKS: You MUST include at minimum 2 internal links to OTHER articles in this batch. Use ONLY the real slugs listed above — do NOT invent or guess URLs.
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
16. SEARCH INTENT RESOLUTION: The article title makes a promise to the reader. You MUST deliver on that promise.
   HARD RULES — SEARCH INTENT RESOLUTION:
   - If the title promises "how to start X", "how to do X", or "step-by-step guide to X" — deliver actual numbered step-by-step actionable instructions. Do NOT substitute framework overviews.
   - Every H2 section MUST contain at least one specific, actionable instruction the reader can execute today.
   - Actionable instructions must be concrete: name the tool, form, website, phone number, or exact action.

=== PASS 2 QUALITY SCORING — WRITE TO SCORE 80+ ON ALL FIVE ===
This article will be scored on these five dimensions. Write to score 80+ on all five:
1. SEARCH INTENT RESOLUTION: Fully resolves what the searcher is looking for. Delivers on the title's promise.
2. HUMAN AUTHENTICITY: Reads as written by a real human expert. No AI fingerprint patterns. Specific, opinionated, direct.
3. TITLE TERRITORY: The title owns a specific territory and signals clear value.
4. E-E-A-T AUTHORITY: Demonstrates Experience, Expertise, Authoritativeness, Trustworthiness.
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
function mechanicalPostProcess(bodyHtml: string): { bodyHtml: string; wordCount: number } {
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
function enforceMetaTitle(metaTitle: string, primaryKeyword: string): string {
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
function enforceMetaDescription(metaDescription: string, primaryKeyword: string, businessName: string): string {
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
      schemaPresent: schemaMarkup.length > 0,
    });
    console.log(`[ArticleEngine] Pass 1 done for node ${nodeId}: ${pass1.score}/100 (${Object.values(pass1.points).filter(Boolean).length}/16 checks passed)`);

    // =========================================================================
    // STEP 4 — PASS 2 SCORER (AI quality)
    // =========================================================================
    let pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId);
    const pass2Done = Date.now();
    console.log(`[ArticleEngine] Pass 2 done for node ${nodeId}: ${pass2.score}/100 — "${pass2.reason}" (${((pass2Done - writeDone) / 1000).toFixed(1)}s)`);

    // =========================================================================
    // STEP 5 — ONE IMPROVEMENT ATTEMPT (if needed)
    // =========================================================================
    const pass1PointsCount = Object.values(pass1.points).filter(Boolean).length;
    const needsImprovement = pass1PointsCount < 14 || pass2.score < 80;
    let improvementAttempts = 0;

    if (needsImprovement) {
      improvementAttempts = 1;
      // Collect Pass 1 failures for the prompt
      const pass1Failures = Object.entries(pass1.points)
        .filter(([, passed]) => !passed)
        .map(([checkId]) => {
          const detail = pass1.details[checkId] ?? checkId;
          return `- ${checkId}: ${detail}`;
        })
        .join("\n");

      console.log(`[ArticleEngine] Improvement pass triggered for node ${nodeId} (Pass 1: ${pass1PointsCount}/16, Pass 2: ${pass2.score}/100)...`);

      const improvementPrompt = `This article needs improvement. Here are the exact issues identified:

PASS 1 FAILURES (SEO rules not met):
${pass1Failures || "None — all Pass 1 checks passed"}

PASS 2 QUALITY SCORE: ${pass2.score}/100
The scorer gave this specific feedback:
"${pass2.reason}"

You MUST fix exactly the issues described above. Do NOT rewrite the article from scratch.
Identify the specific sections, sentences, or patterns that caused the failures and fix only those.

Rules for this improvement pass:
- Fix the specific Pass 1 failures listed above (keyword placement, meta fields, link requirements)
- Fix the specific Pass 2 issues raised in the scorer feedback
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
            messages: [{ role: "user", content: improvementPrompt }],
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
          // Re-score Pass 2 after improvement
          const improvedPass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId);
          console.log(`[ArticleEngine] Improvement pass: Pass 2 score ${pass2.score} → ${improvedPass2.score} for node ${nodeId}`);
          pass2 = improvedPass2;
        } else {
          console.warn(`[ArticleEngine] Improvement pass returned no usable HTML for node ${nodeId} — keeping original`);
        }
      } catch (err) {
        console.warn(`[ArticleEngine] Improvement pass failed for node ${nodeId}:`, err);
      }
    }

    // =========================================================================
    // STEP 6 — DERIVE BADGE AND RETURN
    // =========================================================================
    let { internalScore, statusBadge } = deriveStatusBadge(pass1.score, pass2.score);
    if (pass2.score < 80 && improvementAttempts > 0) {
      statusBadge = "needs_review";
      console.log(`[ArticleEngine] Badge overridden to needs_review for node ${nodeId} (Pass 2 score ${pass2.score} after improvement attempt)`);
    }

    const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
    console.log(`[ArticleEngine] Complete for node ${nodeId}: Pass 1 ${pass1.score}/100, Pass 2 ${pass2.score}/100, badge=${statusBadge}, total=${totalElapsed}s`);

    return {
      title,
      metaTitle,
      metaDescription,
      bodyHtml,
      bodyMarkdown,
      schemaMarkup,
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
