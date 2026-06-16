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

export function buildGenerationPrompt(ctx: ArticleContext): string {
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

  // Build optional internal page links section — only include pages that have URLs
  const optionalPageLinks: string[] = [];
  if (ctx.contactPageUrl) optionalPageLinks.push(`Contact Page: ${ctx.contactPageUrl}`);
  if (ctx.bookingsPageUrl) optionalPageLinks.push(`Bookings/Appointments Page: ${ctx.bookingsPageUrl}`);
  if (ctx.testimonialsPageUrl) optionalPageLinks.push(`Testimonials/Reviews Page: ${ctx.testimonialsPageUrl}`);
  if (ctx.shopUrl) optionalPageLinks.push(`Shop/E-commerce Page: ${ctx.shopUrl}`);
  if (ctx.otherInternalLinks?.length) {
    ctx.otherInternalLinks.forEach(l => optionalPageLinks.push(`${l.label}: ${l.url}`));
  }
  const optionalLinksText = optionalPageLinks.length
    ? optionalPageLinks.join("\n")
    : null;

  return `You are an expert SEO content writer producing a high-authority blog article for an Australian business.

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
Word Count: ${ctx.wordCountMin}–${ctx.wordCountMax} words (MINIMUM: ${ctx.wordCountMin} words — you MUST write at least ${ctx.wordCountMin} words; HARD MAXIMUM: ${ctx.wordCountMax} words — do not exceed). A ${ctx.level} article that is shorter than ${ctx.wordCountMin} words is UNACCEPTABLE and will be rejected.

=== INTERNAL LINK CONTEXT ===
${internalLinkContext || "No parent/sibling articles yet — this is a Cornerstone."}

All article slugs in this batch (use for internal blog links):
${ctx.allBatchSlugs.slice(0, 20).join(", ")}

=== 16-POINT AUTHORITY STANDARD — ALL POINTS ARE MANDATORY ===

1. PRIMARY KEYWORD DENSITY: The primary keyword "${ctx.primaryKeyword}" must appear a MINIMUM of 4 times across the full article (H1 title, H2 headings, and body text combined). HARD MAXIMUM: keyword density must not exceed 1% of total word count (e.g. for a 1,000-word article, no more than 10 mentions). After drafting, count keyword appearances and total words. If count is below 4, add the keyword naturally in headings or body paragraphs before finalising. Never stuff — every use must read naturally.
2. KEYWORD IN H1: Primary keyword must appear verbatim in the H1 heading (the article title).
3. KEYWORD IN H2: Primary keyword must appear verbatim in AT LEAST ONE <h2> heading. This is mandatory — not optional, not an H3. An H2.
4. KEYWORD IN H3: If the article uses H3 subheadings, the primary keyword MUST appear in at least one H3. If the article has no H3 headings at all, this rule is automatically satisfied — do not force H3s just to satisfy it.
5. KEYWORD IN FIRST 100 WORDS: Primary keyword must appear naturally within the first 100 words of body text (not counting the H1 title). Do not bury it — place it in the opening paragraph.
6. KEYWORD IN URL SLUG: The URL slug is already set to /${ctx.urlSlug}. Ensure the H1 title reflects the same topic territory.
7. META TITLE: Must include primary keyword verbatim. Maximum 60 characters. Written for click-through rate.
8. META DESCRIPTION: Must include the EXACT primary keyword phrase "${ctx.primaryKeyword}" verbatim (do not insert extra words into the phrase). Exactly 140–160 characters. Written for CTR.
9. OPENING ANSWER BLOCK: Immediately after the H1, include a direct-answer block that answers the most likely search question in 40–60 words. Format: start with the question as a bold line or <strong> tag, then answer it directly in 1–2 sentences. This block must be present and clearly formatted for Google Featured Snippet extraction.
10. EXTERNAL AUTHORITY LINK: You MUST include at least one hyperlink to a real, high-authority external source — a government website (.gov.au), an industry body, or a nationally recognised publication. Use descriptive anchor text (never a raw URL). This link must be genuine and relevant to the article topic. Examples: Australian Building Codes Board, Fair Work Commission, Australian Bureau of Statistics, relevant industry association.
11. INTERNAL CTA LINK: At least one link back to the business (shop, product, service, bookings, or testimonials page). Anchor text only.
12. INTERNAL BLOG LINKS: You MUST include at minimum 2 internal links to OTHER articles in this batch. Use ONLY the real slugs listed below — do NOT invent or guess URLs. Use descriptive anchor text. No keyword cannibalization.
   Available batch article slugs (use these exact paths):
   ${ctx.allBatchSlugs.slice(0, 20).join(", ")}
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
- Use the customer's actual situation (field 1) to open the first body section — describe the scenario in second person ("If you've ever found yourself...") or third person ("Most [industry] clients come to us after...")
- Use the frustrations (field 2) when writing any section about common mistakes, what to avoid, or why other approaches fail
- Use the transformation (field 3) in the conclusion and CTA — what the reader can achieve, not just what the business offers
- Pull specific words and phrases from these answers where they fit naturally — this is how the article sounds like it was written by someone who actually knows the customer, not an AI that read a brief
` : ""}${ctx.contentPlanDirection ? `
WRITER DIRECTION FROM PUBLISHER:
The person publishing this article has added this specific direction:
"${ctx.contentPlanDirection}"
Follow this direction. If it specifies topics, examples, or angles to cover — include them. This takes priority over general guidelines.
` : ""}15. HUMAN AUTHENTICITY: No AI fingerprint patterns. Content must solve the reader's problem completely. Must be cohesive with the rest of the batch.
16. ARTICLE TYPE STRUCTURE: Format and structure this as a ${typeLabel}. The title must signal specific territory ownership.

=== CLOSING CTA SECTION (MANDATORY) ===
Every article MUST end with a dedicated CTA section using this exact structure:
<h2>Ready to Take the Next Step?</h2>
<p>[1–2 sentences summarising the value the reader has just gained and why acting now makes sense.]</p>
<p>${ctx.ctaText}: <a href="${ctx.ctaUrl}">${ctx.ctaText}</a></p>

Customise the H2 heading and body copy to match the article topic and brand voice — do not use the generic placeholder text above verbatim. The CTA link MUST point to ${ctx.ctaUrl}.

=== ABSOLUTE RULES ===
- DO NOT fabricate statistics, quotes, or data. If you reference a statistic, it must come from a real, citable source. Use the external authority link as the citation anchor.
- DO NOT invent URLs. Every link in the article must use a real, verifiable URL. For internal links, use only the batch slugs listed in point 12. For external links, use only well-known, verifiable domains (.gov.au, industry bodies, major publications). If no real external link is available for a claim, do not include one.
- DO NOT use em dashes (—) excessively.
- DO NOT open with a rhetorical question.
- DO NOT introduce sections with a bolded question followed by an answer paragraph — this is a formulaic AI pattern.
- DO NOT use formulaic section structures where every H3 follows the exact same pattern.
- DO NOT open paragraphs with "This means that...".
- DO NOT use these phrases (banned): "in today's world", "it's important to note", "it's worth noting", "delve into", "game-changer", "game-changing", "leverage", "synergy", "transformative", "non-negotiable", "minefield blindfolded", "the truth is", "let's be honest", "the reality is", "make no mistake", "here's the thing", "the fact is", "simply put", "it's no secret", "spoiler alert", "the good news is", "the bad news is", "in other words", "to put it simply".
- DO NOT use strong declarations that sound performative or designed to impress rather than inform.
- DO NOT repeat sentence structures — vary sentence length, mixing short punchy sentences with longer explanatory ones.
- Write as a knowledgeable human practitioner who has actually done this work, not as an AI summarising a topic.
- Use specific numbers, real examples, and concrete details rather than general statements.
- Sections should feel like they were written by someone with direct experience — conversational but authoritative, like a trusted advisor explaining something, not a content farm.
- Use Australian English spelling (e.g., "optimise" not "optimize", "colour" not "color").

=== WRITING QUALITY SCORING CRITERIA ===
This article will be scored on four dimensions after generation. Write to score 80+ on all four:
1. CLARITY & FLOW: Ideas connect logically. Transitions feel natural, not mechanical. The reader never has to re-read a sentence.
2. HUMAN AUTHENTICITY: Reads as written by a real human expert. No AI fingerprint patterns. No performative declarations. Specific, opinionated, direct.
3. DEPTH & SPECIFICITY: Uses concrete numbers, named examples, real scenarios. Avoids vague generalisations. Demonstrates genuine subject-matter knowledge.
4. ENGAGEMENT: Holds the reader's attention throughout. Varied rhythm. Strong opening. Sections that build on each other rather than repeating the same point.

=== REQUIRED OUTPUT FORMAT (JSON) ===
Return a single JSON object with these exact fields:
{
  "title": "H1 title of the article",
  "metaTitle": "SEO meta title (max 60 chars, includes primary keyword)",
  "metaDescription": "SEO meta description (140–160 chars exactly, includes primary keyword)",
  "bodyHtml": "Full article body as clean HTML. FORMATTING RULES: (1) Use h2, h3, p, ul, ol, li, a, strong, em, blockquote tags — no inline styles. (2) BULLET LISTS: Every <li> must be a direct child of <ul> or <ol>. Add a blank line (newline) between each <li> item so Wix/WordPress renders spacing between bullets. Do NOT indent <ul> tags — keep them flush with the left margin. (3) FAQ SECTION: If the article includes a FAQ, format each Q&A pair as: <div class=\"faq-item\"><hr><p><strong>Q: [question]</strong></p><p>A: [answer]</p></div> — the <hr> creates a visible divider line between each Q&A pair. The FAQ section must start with <h2>Frequently Asked Questions</h2>. Do NOT use Q: and A: as plain text paragraphs — always wrap them in this structure.",
  "bodyMarkdown": "Full article body as Markdown",
  "schemaMarkup": "JSON-LD schema as a string (Article + Breadcrumb${isCornerstoneOrPillar ? " + FAQ" : ""})",
  "faqItems": ${isCornerstoneOrPillar ? '[{"question": "...", "answer": "..."}] — include 3–5 FAQ items' : "null — Cluster articles do not get FAQ"},
  "wordCount": <integer — actual word count of bodyHtml>,
  "externalLinkPresent": <boolean>,
  "internalCtaLinkPresent": <boolean>,
  "internalBlogLinksPresent": <boolean>,
  "schemaPresent": <boolean>
}`;
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
// Outline-first section-by-section generation helpers
// ---------------------------------------------------------------------------

export interface OutlineSection {
  heading: string;       // H2 heading text
  targetWords: number;   // target word count for this section
  notes: string;         // brief instruction for what this section should cover
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
 * Step 1: Ask the LLM to plan the full article structure.
 * This is a small, fast call that always completes — no truncation risk.
 */
export function buildOutlinePrompt(ctx: ArticleContext): string {
  const isCornerstoneOrPillar = ctx.level === "cornerstone" || ctx.level === "pillar";
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

  return `You are an expert SEO content strategist. Plan the full structure for a ${typeLabel} article.

Business: ${ctx.businessName} (${ctx.industry}, ${ctx.location})
Primary Keyword: ${ctx.primaryKeyword}
Secondary Keywords: ${ctx.secondaryKeywords.join(", ") || "None"}
PAA Question: ${ctx.paaQuestion || "Answer the most likely search intent question"}
Article Type: ${typeLabel}
URL Slug: /${ctx.urlSlug}
Total Word Count Target: ${ctx.wordCountMin}–${ctx.wordCountMax} words
Level: ${ctx.level}

TITLE RULES — these are mandatory:
- Never write a title that starts with 'What Is' or 'What Are'
- Never write a title that is purely definitional (e.g. 'What Is Branding', 'What Is SEO', 'Understanding X')
- Every title must have a specific angle, audience, or outcome:
  WEAK: 'What Is Brand Strategy?'
  STRONG: 'Brand Strategy for Small Businesses: Where to Start'
  WEAK: 'What Are Psychosocial Hazards?'
  STRONG: 'Psychosocial Hazards: Your Legal Obligations as an Australian Employer'
- Titles must create curiosity or signal a specific benefit
- Include the focus keyword naturally — do not just prepend it
- For Australian businesses, include 'Australia' or the location in the title where it fits naturally
- The title must make someone stop scrolling and want to read

RULES (ALL MANDATORY — these map directly to the 16-point SEO checklist):
- H1 title MUST contain the exact primary keyword verbatim [P2]
- Meta title MUST contain the primary keyword and be ≤60 characters [P7]
- Meta description MUST contain the exact primary keyword phrase and be EXACTLY 140–160 characters [P8]
- Plan ${Math.ceil(ctx.wordCountMin / 250)} to ${Math.ceil(ctx.wordCountMax / 200)} H2 sections so the total hits ${ctx.wordCountMin}–${ctx.wordCountMax} words [P16]
- AT LEAST ONE H2 heading must contain the primary keyword verbatim [P3]
- The FIRST section must be an "Opening Answer Block" (40–60 words) that directly answers the search query with a bold question [P9]
- The LAST section must be a CTA section titled "Ready to Take the Next Step?" or similar (50–80 words) with a link to ${ctx.ctaUrl} [P11]
- ${isCornerstoneOrPillar ? "Include a FAQ section (3–5 questions) near the end" : "DO NOT include a FAQ section (Cluster articles only)"}
- Each section's targetWords should be realistic for that section's depth
- Use Australian English spelling
- Plan for an external authority link (.gov.au or industry body) in section 2 [P10]
- Plan for AT LEAST 2 internal blog links to other articles in the batch using ONLY these real slugs: ${ctx.allBatchSlugs.slice(0, 10).join(", ")} [P12]
- Plan for E-E-A-T signals (years experience, clients served, awards) in at least one section [P14]
- Plan the outline so the focus keyword '${ctx.primaryKeyword}' can naturally appear in the opening paragraph (within the first 100 words of body text), at least one H2 heading, at least one H3 heading (only if the article uses H3s — do not force H3s), and the conclusion section [P1/P5]
${ctx.problemsSolved ? `- The outline MUST include at least one section that directly addresses this customer problem: "${ctx.problemsSolved}". Label that section with a heading like 'Why [problem occurs]' or 'The real cost of [problem]' or 'How to solve [problem]'` : ""}
${ctx.customerSituationBefore ? `- Plan at least one section using this customer scenario as the opening context: "${ctx.customerSituationBefore}"` : ""}
${ctx.customerFrustrations ? `- Plan at least one section that addresses these specific frustrations: "${ctx.customerFrustrations}"` : ""}
${ctx.contentPlanDirection ? `- Publisher direction for this specific article: "${ctx.contentPlanDirection}"
  Build the outline around this direction.` : ""}

Return a single JSON object:
{
  "title": "H1 title (contains primary keyword verbatim)",
  "metaTitle": "SEO meta title (≤60 chars, contains primary keyword)",
  "metaDescription": "SEO meta description (140–160 chars, contains exact primary keyword phrase)",
  "sections": [
    { "heading": "H2 heading text", "targetWords": 200, "notes": "What this section covers in 1 sentence" }
  ],
  "schemaMarkupInstructions": "Brief note on what schema types to include: Article + Breadcrumb${isCornerstoneOrPillar ? " + FAQ" : ""}",
  "faqItems": ${isCornerstoneOrPillar ? '[{"question": "...", "answer": "..."}] — 3–5 items' : "null"}
}`;
}

/**
 * Step 2: Write a single section of the article.
 * Each section is a separate LLM call — no single call can be truncated mid-article.
 */
export function buildSectionPrompt(
  ctx: ArticleContext,
  section: OutlineSection,
  sectionIndex: number,
  totalSections: number,
  articleTitle: string,
  previousSectionsHtml: string
): string {
  const isFirst = sectionIndex === 0;
  const isLast = sectionIndex === totalSections - 1;
  const isCTA = isLast;

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

  const servicesText = ctx.services
    .map(s => `- ${s.name}${s.pageUrl ? ` (${s.pageUrl})` : ""}`)
    .join("\n");

  return `You are an expert SEO content writer. Write ONE section of a blog article.

ARTICLE CONTEXT:
Business: ${ctx.businessName} (${ctx.industry}, ${ctx.location})
Article Title (H1): ${articleTitle}
Primary Keyword: ${ctx.primaryKeyword}
Brand Voice: ${ctx.voiceBrief || "Professional, authoritative, helpful. Sound like a real human expert."}
Section ${sectionIndex + 1} of ${totalSections}

THIS SECTION TO WRITE:
H2 Heading: ${section.heading}
Target Word Count: ${section.targetWords} words (write AT LEAST ${Math.round(section.targetWords * 0.9)} words)
Section Notes: ${section.notes}

${isFirst ? `OPENING SECTION RULES:
- Start with the H2 heading: <h2>${section.heading}</h2>
- Immediately answer the most likely search question in 40–60 words (bold the question)
- The primary keyword "${ctx.primaryKeyword}" MUST appear naturally within the first 100 words of this opening section
- This is the featured snippet target — be direct and specific` : ""}

${isCTA ? `CTA SECTION RULES:
- Start with <h2>${section.heading}</h2>
- Write 1–2 sentences summarising the value the reader gained
- Include a CTA link: <a href="${ctx.ctaUrl}">${ctx.ctaText}</a>
- Keep it to ${section.targetWords} words` : ""}

${!isFirst && !isCTA ? `CONTENT RULES:
- The focus keyword is: "${ctx.primaryKeyword}". This section MUST include the focus keyword at least once, used naturally in a sentence. Do not force it — find a place where it fits the meaning of the sentence.
- Start with <h2>${section.heading}</h2>
- Write ${section.targetWords} words of specific, practical, expert-level content
- Use H3 subheadings where appropriate to break up the content
- Include bullet lists or numbered lists where they add clarity
- DO NOT fabricate statistics — only cite real, verifiable facts
- Use Australian English spelling (optimise, colour, organise)
- Vary sentence length — mix short punchy sentences with longer explanatory ones
- Sound like a specific human expert, not a generic AI assistant
- DO NOT use em dashes (—) excessively
- DO NOT introduce sections with a bolded question followed by an answer paragraph
- DO NOT open paragraphs with "This means that..."
- DO NOT use formulaic section structures where every H3 follows the exact same pattern
- DO NOT use these phrases (banned): "in today's world", "it's important to note", "it's worth noting", "delve into", "game-changer", "game-changing", "leverage", "synergy", "transformative", "non-negotiable", "the truth is", "let's be honest", "the reality is", "make no mistake", "here's the thing", "the fact is", "simply put", "it's no secret", "the good news is", "the bad news is"
- DO NOT use strong declarations that sound performative rather than informative
- Write as a knowledgeable human practitioner with direct experience, not an AI summarising a topic
- Use specific numbers, real examples, and concrete details rather than general statements` : ""}

${sectionIndex === 1 ? `EXTERNAL LINK RULE (Section 2 only): Include at least one hyperlink to a real, high-authority external source (.gov.au, industry body, or nationally recognised publication). Use descriptive anchor text.` : ""}

${sectionIndex === 2 ? `INTERNAL LINK RULE (Section 3 only): Include at least one internal link to a business service or page:\n${servicesText}\n${optionalPageLinks.length ? optionalPageLinks.join("\n") : ""}\nPrimary CTA: ${ctx.ctaText} → ${ctx.ctaUrl}` : ""}

${internalLinkContext ? `INTERNAL BLOG LINKS (MANDATORY — minimum 2 across the full article):\n${internalLinkContext}\nAvailable batch slugs (use ONLY these exact paths — do NOT invent URLs): ${ctx.allBatchSlugs.slice(0, 15).join(", ")}` : `INTERNAL BLOG LINKS (MANDATORY — minimum 2 across the full article):\nAvailable batch slugs (use ONLY these exact paths — do NOT invent URLs): ${ctx.allBatchSlugs.slice(0, 15).join(", ")}`}

PREVIOUS SECTIONS (for context and continuity — DO NOT repeat this content):
${previousSectionsHtml ? previousSectionsHtml.slice(-2000) : "(This is the first section)"}

Return ONLY the HTML for this section, wrapped in these exact delimiters:
<SECTION_HTML>
...section HTML here (h2, h3, p, ul, ol, li, a, strong, em, blockquote tags only — no inline styles)...
</SECTION_HTML>`;
}

/**
 * Detect if an HTML body has a trailing empty heading (truncation signature).
 * Returns true if the last heading tag has no meaningful content after it.
 */
export function hasTrailingEmptyHeading(bodyHtml: string): boolean {
  // Find all headings and their positions
  const headingMatches = Array.from(bodyHtml.matchAll(/<h[2-6][^>]*>([^<]+)<\/h[2-6]>/gi));
  if (headingMatches.length === 0) return false;
  const lastHeading = headingMatches[headingMatches.length - 1];
  const lastHeadingEnd = (lastHeading.index ?? 0) + lastHeading[0].length;
  const afterLastHeading = bodyHtml.slice(lastHeadingEnd).replace(/<[^>]+>/g, " ").trim();
  // If there are fewer than 10 words after the last heading, it's likely truncated
  // (10 is low enough to avoid false positives on short CTA/conclusion sections)
  const wordsAfter = afterLastHeading.split(/\s+/).filter(Boolean).length;
  return wordsAfter < 10;
}

// ---------------------------------------------------------------------------
// Single article generation (one at a time)
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

export async function generateSingleArticle(
  businessId: number,
  nodeId: number,
  allOrderedNodes: OrderedNode[],
  userId?: number | null
): Promise<GenerationResult> {
  const ctx = await buildArticleContext(businessId, nodeId, allOrderedNodes);

  // =========================================================================
  // Pass A: Outline-first + section-by-section generation
  //
  // WHY: A single LLM call for a full 2,000–3,000 word article risks hitting
  // the token limit mid-article, producing a truncated article with an empty
  // last heading. The outline-first approach splits the work:
  //   Step 1 — Outline: plan all H2 sections + word targets (tiny call, always completes)
  //   Step 2 — Sections: write each section in its own LLM call (~200–400 words each)
  //   Step 3 — Assemble: concatenate all sections into the final bodyHtml
  // No single call can be cut off mid-article.
  // =========================================================================

  // --- Pre-Step 1: Enforce slug BEFORE outline so all section-level links use the correct slug ---
  // (Prompt 4 FIX2: slug enforcement moved before outline generation)
  {
    const kwLower = ctx.primaryKeyword.toLowerCase();
    const slugLower = ctx.urlSlug.toLowerCase();
    const kwWords = kwLower.split(/\s+/);
    const allWordsInSlug = kwWords.every((w) => slugLower.includes(w));
    if (!allWordsInSlug) {
      const kwSlug = kwLower.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (!slugLower.includes(kwSlug)) {
        ctx.urlSlug = `${kwSlug}-${ctx.urlSlug}`.replace(/--+/g, "-").slice(0, 80);
        console.log(`[ArticleEngine] Pre-outline P6 slug enforcement: set slug to "${ctx.urlSlug}" for node ${nodeId}`);
      }
    }
  }

  // --- Step 1: Get article outline ---
  const outlinePrompt = buildOutlinePrompt(ctx);
  let outline: ArticleOutline;
  {
    let outlineParsed: Record<string, unknown> | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const outlineResult = await invokeLLMWithCost(
          {
            messages: [
              { role: "system" as const, content: "You are an expert SEO content strategist. Return only a valid JSON object. No markdown, no code fences." },
              { role: "user" as const, content: outlinePrompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 12000,
          },
          { userId, feature: "article_generation" }
        );
        const raw = outlineResult.choices[0]?.message?.content ?? "";
        const stripped = (typeof raw === "string" ? raw : JSON.stringify(raw))
          .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        outlineParsed = JSON.parse(stripped);
        break;
      } catch (err) {
        if (attempt === 2) throw new Error(`Article outline generation failed after 2 attempts: ${err}`);
        console.warn(`[ArticleEngine] Outline attempt ${attempt} failed — retrying...`);
      }
    }
    const parsed = outlineParsed!;
    const rawSections = Array.isArray(parsed.sections) ? (parsed.sections as OutlineSection[]) : [];
    // Validate sections — must have at least 3
    if (rawSections.length < 3) {
      throw new Error(`Article outline returned too few sections (${rawSections.length}) for node ${nodeId}`);
    }
    outline = {
      title: (parsed.title as string) || "",
      metaTitle: (parsed.metaTitle as string) || "",
      metaDescription: (parsed.metaDescription as string) || "",
      sections: rawSections,
      schemaMarkup: "",
      faqItems: Array.isArray(parsed.faqItems) ? (parsed.faqItems as Array<{ question: string; answer: string }>) : null,
    };
    console.log(`[ArticleEngine] Outline for node ${nodeId}: "${outline.title}" — ${outline.sections.length} sections planned (target: ${ctx.wordCountMin}–${ctx.wordCountMax} words)`);
  }

  // --- Step 2: Write each section ---
  const sectionHtmlParts: string[] = [];
  for (let i = 0; i < outline.sections.length; i++) {
    const section = outline.sections[i];
    const previousHtml = sectionHtmlParts.join("\n");
    const sectionPrompt = buildSectionPrompt(ctx, section, i, outline.sections.length, outline.title, previousHtml);
    let sectionHtml = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const sectionResult = await invokeLLMWithCost(
          {
            messages: [
              { role: "system" as const, content: "You are an expert SEO content writer. Return ONLY the section HTML wrapped in <SECTION_HTML>...</SECTION_HTML> delimiters. No other text." },
              { role: "user" as const, content: sectionPrompt },
            ],
            max_tokens: 12000,
          },
          { userId, feature: "article_generation" }
        );
        const finishReason = sectionResult.choices[0]?.finish_reason;
        const rawSection = sectionResult.choices[0]?.message?.content ?? "";
        const rawStr = typeof rawSection === "string" ? rawSection : JSON.stringify(rawSection);
        // Check for truncation
        if (finishReason === "length") {
          console.warn(`[ArticleEngine] Section ${i + 1} truncated (finish_reason=length) for node ${nodeId} — retrying with shorter target`);
          // Reduce target and retry with a note to be more concise
          outline.sections[i] = { ...section, targetWords: Math.round(section.targetWords * 0.7), notes: section.notes + " (be concise)" };
          if (attempt === 2) {
            // Accept whatever we got — extract partial content
            const partialMatch = rawStr.match(/<SECTION_HTML>([\s\S]*)/i);
            sectionHtml = partialMatch ? partialMatch[1].trim() : rawStr.trim();
            console.warn(`[ArticleEngine] Section ${i + 1} still truncated after retry — using partial content`);
            break;
          }
          continue;
        }
        const delimMatch = rawStr.match(/<SECTION_HTML>([\s\S]*?)<\/SECTION_HTML>/i);
        sectionHtml = delimMatch ? delimMatch[1].trim() : rawStr.trim();
        if (sectionHtml.length > 50) break;
        if (attempt === 2) console.warn(`[ArticleEngine] Section ${i + 1} returned very short content for node ${nodeId}`);
      } catch (err) {
        if (attempt === 2) {
          console.warn(`[ArticleEngine] Section ${i + 1} failed after 2 attempts for node ${nodeId}:`, err);
          sectionHtml = `<h2>${section.heading}</h2><p>Section content unavailable.</p>`;
        }
      }
    }
    sectionHtmlParts.push(sectionHtml);
    const sectionWc = sectionHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    console.log(`[ArticleEngine] Section ${i + 1}/${outline.sections.length} written: "${section.heading}" — ${sectionWc} words for node ${nodeId}`);
  }

  // --- Step 3: Assemble final article ---
  // Generate schema markup in a separate small call
  let schemaMarkup = "";
  {
    const isCornerstoneOrPillar = ctx.level === "cornerstone" || ctx.level === "pillar";
    const schemaPrompt = `Generate JSON-LD schema markup for this blog article. Include Article schema and Breadcrumb schema${isCornerstoneOrPillar ? " and FAQ schema" : ""}.

Title: ${outline.title}
URL: https://example.com/${ctx.urlSlug}
Business: ${ctx.businessName}
Primary Keyword: ${ctx.primaryKeyword}
${outline.faqItems ? `FAQ Items: ${JSON.stringify(outline.faqItems)}` : ""}

Return ONLY the raw JSON-LD string (no markdown, no code fences, no explanation).`;
    try {
      const schemaResult = await invokeLLMWithCost(
        {
          messages: [{ role: "user" as const, content: schemaPrompt }],
          max_tokens: 2048,
        },
        { userId, feature: "article_generation" }
      );
      const rawSchema = schemaResult.choices[0]?.message?.content ?? "";
      schemaMarkup = (typeof rawSchema === "string" ? rawSchema : JSON.stringify(rawSchema))
        .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    } catch (err) {
      console.warn(`[ArticleEngine] Schema generation failed for node ${nodeId}:`, err);
    }
  }

  let bodyHtml = sectionHtmlParts.join("\n\n");
  const bodyMarkdown = ""; // Markdown not generated in section-by-section mode
  let title = outline.title;
  let metaTitle = outline.metaTitle;
  let metaDescription = outline.metaDescription;
  const faqItems = outline.faqItems;
  let wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  // Check for trailing empty heading (truncation signature) — safety net
  if (hasTrailingEmptyHeading(bodyHtml)) {
    console.warn(`[ArticleEngine] Trailing empty heading detected for node ${nodeId} — article may be incomplete. Word count: ${wordCount}`);
  }

  // --- Pre-pass: P2 enforcement — keyword must appear in article title ---
  // If the LLM omitted the keyword from the title, rewrite the title via LLM (not prepend).
  {
    const kwLower = ctx.primaryKeyword.toLowerCase();
    const titleLower = title.toLowerCase();
    if (!kwPresentInText(kwLower, titleLower)) {
      try {
        const titleRewriteResult = await invokeLLMWithCost(
          {
            messages: [
              {
                role: "user",
                content: `Rewrite this article title to naturally include the focus keyword.\nFocus keyword: "${ctx.primaryKeyword}"\nOriginal title: "${title}"\nRules: Keep the meaning. Sound like a real article title a human would write. Do not just prepend the keyword. Max 70 characters. Return ONLY the new title text, nothing else.`,
              },
            ],
            max_tokens: 100,
          },
          { userId, feature: "article_generation" }
        );
        const rewrittenTitle = (titleRewriteResult.choices[0]?.message?.content ?? "").toString().trim().replace(/^"|"$/g, "");
        if (rewrittenTitle && rewrittenTitle.length > 5 && rewrittenTitle.length <= 80) {
          title = rewrittenTitle;
          // Also patch the H1 in bodyHtml
          const h1Match = bodyHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          if (h1Match) {
            bodyHtml = bodyHtml.replace(h1Match[0], h1Match[0].replace(h1Match[1], rewrittenTitle));
          }
          console.log(`[ArticleEngine] P2 enforcement: LLM rewrote title to include keyword for node ${nodeId}: "${rewrittenTitle}"`);
        } else {
          // Fallback: prepend if LLM rewrite fails
          const capitalised = ctx.primaryKeyword.charAt(0).toUpperCase() + ctx.primaryKeyword.slice(1);
          const h1Match = bodyHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
          if (h1Match && !kwPresentInText(kwLower, h1Match[1].toLowerCase())) {
            const newH1 = `${capitalised}: ${h1Match[1]}`;
            bodyHtml = bodyHtml.replace(h1Match[0], h1Match[0].replace(h1Match[1], newH1));
            console.log(`[ArticleEngine] P2 enforcement: fallback prepend keyword into H1 for node ${nodeId}`);
          }
        }
      } catch (err) {
        console.warn(`[ArticleEngine] P2 title rewrite failed for node ${nodeId}:`, err);
      }
    }
  }

  // --- Pre-pass: P6 enforcement — keyword must appear in URL slug ---
  {
    const kwLower = ctx.primaryKeyword.toLowerCase();
    const slugLower = ctx.urlSlug.toLowerCase();
    const kwWords = kwLower.split(/\s+/);
    const allWordsInSlug = kwWords.every(w => slugLower.includes(w));
    if (!allWordsInSlug) {
      // Prepend keyword words to slug (e.g. "psychosocial-hazards-examples-guide")
      const kwSlug = kwLower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      // Only prepend if not already present as a substring
      if (!slugLower.includes(kwSlug)) {
        ctx.urlSlug = `${kwSlug}-${ctx.urlSlug}`.replace(/--+/g, '-').slice(0, 80);
        console.log(`[ArticleEngine] P6 enforcement: prepended keyword to slug for node ${nodeId}: ${ctx.urlSlug}`);
      }
    }
  }

  // Enforce meta title length: must be ≤60 chars
  if (metaTitle.length > 60) {
    // Trim to last word boundary at or before 57 chars, then add ellipsis
    const trimmedTitle = metaTitle.slice(0, 57);
    const lastSpaceTitle = trimmedTitle.lastIndexOf(" ");
    metaTitle = (lastSpaceTitle > 30 ? trimmedTitle.slice(0, lastSpaceTitle) : trimmedTitle) + "...";
    console.log(`[ArticleEngine] Meta title trimmed to ${metaTitle.length} chars for node ${nodeId}`);
  }

  // --- P7 enforcement: keyword must appear in meta title ---
  {
    const kwLower = ctx.primaryKeyword.toLowerCase();
    if (!kwPresentInText(kwLower, metaTitle.toLowerCase())) {
      // Prepend keyword to meta title, then re-enforce length
      const capitalised = ctx.primaryKeyword.charAt(0).toUpperCase() + ctx.primaryKeyword.slice(1);
      metaTitle = `${capitalised}: ${metaTitle}`;
      // Re-trim if now over 60 chars
      if (metaTitle.length > 60) {
        const trimmed = metaTitle.slice(0, 57);
        const lastSp = trimmed.lastIndexOf(" ");
        metaTitle = (lastSp > 30 ? trimmed.slice(0, lastSp) : trimmed) + "...";
      }
      console.log(`[ArticleEngine] P7 enforcement: injected keyword into meta title for node ${nodeId}: "${metaTitle}"`);
    }
  }

  // Enforce meta description length: must be 140–160 chars
  if (metaDescription.length > 160) {
    // Trim to last word boundary at or before 157 chars, then add ellipsis
    const trimmed = metaDescription.slice(0, 157);
    const lastSpace = trimmed.lastIndexOf(" ");
    metaDescription = (lastSpace > 120 ? trimmed.slice(0, lastSpace) : trimmed) + "...";
    console.log(`[ArticleEngine] Meta description trimmed to ${metaDescription.length} chars for node ${nodeId}`);
  } else if (metaDescription.length < 140 && metaDescription.length > 0) {
    // If too short, append a generic CTA to pad it to 140+
    const pad = ` Get expert advice from ${ctx.businessName}.`;
    if ((metaDescription + pad).length <= 160) {
      metaDescription = metaDescription + pad;
    }
    console.log(`[ArticleEngine] Meta description padded to ${metaDescription.length} chars for node ${nodeId}`);
  }

  // --- P8 enforcement: keyword must appear in meta description ---
  {
    const kwLower = ctx.primaryKeyword.toLowerCase();
    if (!kwPresentInText(kwLower, metaDescription.toLowerCase())) {
      // Prepend a keyword-containing phrase, then re-enforce length
      const capitalised = ctx.primaryKeyword.charAt(0).toUpperCase() + ctx.primaryKeyword.slice(1);
      const prefix = `${capitalised}: `;
      metaDescription = prefix + metaDescription;
      // Re-enforce length after injection
      if (metaDescription.length > 160) {
        const trimmed2 = metaDescription.slice(0, 157);
        const lastSp2 = trimmed2.lastIndexOf(" ");
        metaDescription = (lastSp2 > 120 ? trimmed2.slice(0, lastSp2) : trimmed2) + "...";
      } else if (metaDescription.length < 140) {
        const pad2 = ` Learn more from ${ctx.businessName}.`;
        if ((metaDescription + pad2).length <= 160) metaDescription = metaDescription + pad2;
      }
      console.log(`[ArticleEngine] P8 enforcement: injected keyword into meta description for node ${nodeId} (${metaDescription.length} chars)`);
    }
  }

  // --- Pass A1: Word count condensation (if over maximum) ---
  // Retry loop: up to MAX_CONDENSATION_ATTEMPTS passes until the article is under the max.
  const MAX_CONDENSATION_ATTEMPTS = 3;
  wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  if (wordCount > ctx.wordCountMax) {
    for (let condensationAttempt = 1; condensationAttempt <= MAX_CONDENSATION_ATTEMPTS; condensationAttempt++) {
      if (wordCount <= ctx.wordCountMax) break;
      const currentWordCount = wordCount;
      console.log(`[ArticleEngine] Condensation attempt ${condensationAttempt}/${MAX_CONDENSATION_ATTEMPTS} for node ${nodeId}: ${currentWordCount} words (max: ${ctx.wordCountMax})`);
      try {
        const condensationPrompt = `This article is ${currentWordCount} words. The maximum for a ${ctx.level} article is ${ctx.wordCountMax} words. Condense it to under ${ctx.wordCountMax} words. Remove redundant sentences, shorten over-explained sections, and cut any padding. Do not remove headings, key points, or examples — only cut filler.

Return ONLY the condensed article body as clean HTML, wrapped in these exact delimiters:
<CONDENSED_HTML>
...full condensed HTML here...
</CONDENSED_HTML>`;

        const condensationResult = await invokeLLMWithCost(
          {
            messages: [
              { role: "system", content: "You are an expert SEO content editor. Condense the article as instructed. Preserve all headings, key points, examples, internal links, keyword mentions, and schema markup. Use Australian English spelling." },
              { role: "user", content: condensationPrompt + "\n\n" + bodyHtml },
            ],
            max_tokens: 12000,
          },
          { userId, feature: "article_generation" }
        );
        const condensationContent = condensationResult.choices[0]?.message?.content ?? "";
        const rawCondensation = typeof condensationContent === "string" ? condensationContent : JSON.stringify(condensationContent);
        const condensationMatch = rawCondensation.match(/<CONDENSED_HTML>([\s\S]*?)<\/CONDENSED_HTML>/i);
        const condensedHtml = condensationMatch ? condensationMatch[1].trim() : rawCondensation.trim();
        if (condensedHtml && condensedHtml.length > 100) {
          const condensedWordCount = condensedHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
          if (condensedWordCount < currentWordCount && condensedWordCount >= ctx.wordCountMin) {
            bodyHtml = condensedHtml;
            wordCount = condensedWordCount;
            if (condensedWordCount <= ctx.wordCountMax) {
              console.log(`[ArticleEngine] Condensation attempt ${condensationAttempt} successful for node ${nodeId}: ${currentWordCount} → ${condensedWordCount} words`);
              break;
            } else {
              console.log(`[ArticleEngine] Condensation attempt ${condensationAttempt} partial for node ${nodeId}: ${currentWordCount} → ${condensedWordCount} words (still over max)`);
            }
          } else {
            console.warn(`[ArticleEngine] Condensation attempt ${condensationAttempt} unusable for node ${nodeId}: ${condensedWordCount} words (original: ${currentWordCount}) — keeping current`);
          }
        }
      } catch (err) {
        console.warn(`[ArticleEngine] Condensation pass failed for node ${nodeId}:`, err);
        break;
      }
    }
    if (wordCount > ctx.wordCountMax) {
      console.warn(`[ArticleEngine] WARNING: node ${nodeId} still ${wordCount} words after ${MAX_CONDENSATION_ATTEMPTS} condensation attempts (max: ${ctx.wordCountMax})`);
    }
  }

  // --- Pass A2: Word count expansion loop (guaranteed minimum) ---
  // Keeps expanding until the article meets the minimum word count or 4 attempts are exhausted.
  // This is deterministic enforcement — not prompt-based hoping.
  const MAX_EXPANSION_ATTEMPTS = 4;
  for (let expansionAttempt = 1; expansionAttempt <= MAX_EXPANSION_ATTEMPTS; expansionAttempt++) {
    const currentWc = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    wordCount = currentWc;
    if (currentWc >= ctx.wordCountMin - WORD_COUNT_TOLERANCE) {
      if (expansionAttempt > 1) console.log(`[ArticleEngine] Word count met after ${expansionAttempt - 1} expansion pass(es): ${currentWc} words for node ${nodeId}`);
      if (currentWc < ctx.wordCountMin) console.log(`[ArticleEngine] Word count ${currentWc} is within ${WORD_COUNT_TOLERANCE}-word tolerance of minimum ${ctx.wordCountMin} — passing for node ${nodeId}`);
      break;
    }
    const wordsNeeded = ctx.wordCountMin - currentWc;
    console.log(`[ArticleEngine] Expansion attempt ${expansionAttempt}/${MAX_EXPANSION_ATTEMPTS} for node ${nodeId}: ${currentWc} words, need ${wordsNeeded} more (min: ${ctx.wordCountMin})`);
    try {
      // Collect existing H2 headings from the current article for outline context
    const existingH2Headings = Array.from(bodyHtml.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)).map((m) => m[1].trim());
    // Collect internal links already in the article
    const existingInternalLinks = Array.from(bodyHtml.matchAll(/href="([^"]+)"[^>]*>([^<]+)<\/a>/gi))
      .filter((m) => !m[1].startsWith("http") || (ctx.ctaUrl && m[1].includes(new URL(ctx.ctaUrl.startsWith("http") ? ctx.ctaUrl : `https://${ctx.ctaUrl}`).hostname)))
      .map((m) => ({ url: m[1], label: m[2] }))
      .slice(0, 10);
    const expansionSystemPrompt = `You are an expert SEO content writer. You will receive an article that is too short and must be expanded.

Current word count: ${currentWc} words
Required minimum: ${ctx.wordCountMin} words (you are ${wordsNeeded} words SHORT)
Required maximum: ${ctx.wordCountMax} words
Primary keyword: ${ctx.primaryKeyword}

You MUST add at least ${wordsNeeded} words. This is not optional.

Existing article outline (H2 sections already written):
${existingH2Headings.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Internal links available in this article (use ONLY these, do not invent new URLs):
${existingInternalLinks.map((l) => `- ${l.label}: ${l.url}`).join("\n") || "None"}

How to expand:
- Add ${Math.ceil(wordsNeeded / 200)} new H2 section(s) that fit naturally into the existing outline above
- Each new section should be 150–250 words with practical, specific advice
- The new section(s) must NOT reference pages or URLs that are not in the internal links list above
- Focus keyword: "${ctx.primaryKeyword}" — use it naturally once in each new section
- Expand existing thin paragraphs with real-world examples and step-by-step guidance
- Add a FAQ section if one does not already exist (3–5 questions and detailed answers)
- Maintain the same tone, voice, and HTML structure
- Keep all existing links, keywords, schema, and the closing CTA section intact
- Do NOT add the CTA section again — it already exists at the end
- Use Australian English spelling

Return ONLY the expanded article body as clean HTML, wrapped in these exact delimiters:
<EXPANDED_HTML>
...full expanded HTML here...
</EXPANDED_HTML>`;

      const expansionResult = await invokeLLMWithCost(
        {
          messages: [
            { role: "system", content: expansionSystemPrompt },
            { role: "user", content: bodyHtml },
          ],
          max_tokens: 12000,
        },
        { userId, feature: "article_generation" }
      );
      const expansionContent = expansionResult.choices[0]?.message?.content ?? "";
      const rawExpansion = typeof expansionContent === "string" ? expansionContent : JSON.stringify(expansionContent);
      // Extract HTML from delimiters — robust against any JSON/markdown wrapping
      const delimMatch = rawExpansion.match(/<EXPANDED_HTML>([\s\S]*?)<\/EXPANDED_HTML>/i);
      const expandedHtml = delimMatch ? delimMatch[1].trim() : rawExpansion.trim();
      if (expandedHtml && expandedHtml.length > 100) {
        const expandedWordCount = expandedHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        if (expandedWordCount > currentWc) {
          bodyHtml = expandedHtml;
          wordCount = expandedWordCount;
          console.log(`[ArticleEngine] Expansion attempt ${expansionAttempt} for node ${nodeId}: ${currentWc} → ${expandedWordCount} words`);
        } else {
          console.warn(`[ArticleEngine] Expansion attempt ${expansionAttempt} for node ${nodeId} did not increase word count (${expandedWordCount} vs ${currentWc}) — retrying`);
        }
      }
    } catch (err) {
      console.warn(`[ArticleEngine] Expansion attempt ${expansionAttempt} failed for node ${nodeId}:`, err);
    }
    if (expansionAttempt === MAX_EXPANSION_ATTEMPTS) {
      console.warn(`[ArticleEngine] Max expansion attempts reached for node ${nodeId}: final word count ${wordCount} (min: ${ctx.wordCountMin})`);
    }
  }

  // --- Pass B: AI fingerprint scrub ---
  try {
    const scrubPrompt = buildScrubPrompt(bodyHtml, bodyMarkdown, ctx.primaryKeyword, ctx.level);
    const scrubResult = await invokeLLMWithCost(
      {
        messages: [{ role: "user", content: scrubPrompt }],
        // No json_object mode — we use plain HTML delimiters to avoid JSON encoding issues
        max_tokens: 12000,
      },
      { userId, feature: "article_generation" }
    );
    const scrubContent = scrubResult.choices[0]?.message?.content ?? "";
    const rawScrub = typeof scrubContent === "string" ? scrubContent : JSON.stringify(scrubContent);
    // Extract HTML from delimiters
    const scrubMatch = rawScrub.match(/<SCRUBBED_HTML>([\s\S]*?)<\/SCRUBBED_HTML>/i);
    const scrubbedHtml = scrubMatch ? scrubMatch[1].trim() : "";
    if (scrubbedHtml && scrubbedHtml.length > 100) {
      const scrubWordCount = scrubbedHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
      const originalWordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
      // Safety guard: reject scrubbed body if it lost more than 20% of the original content
      if (scrubWordCount >= originalWordCount * 0.8) {
        bodyHtml = scrubbedHtml;
        console.log(`[ArticleEngine] Scrub pass accepted: ${scrubWordCount} words (original: ${originalWordCount}) for node ${nodeId}`);
      } else {
        console.warn(`[ArticleEngine] Scrub pass REJECTED for node ${nodeId}: scrubbed body too short (${scrubWordCount} vs ${originalWordCount} original words) — using original`);
      }
    } else {
      console.warn(`[ArticleEngine] Scrub pass returned no delimited content for node ${nodeId} — using original content`);
    }
    // Recount words after scrub
    wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  } catch (err) {
    // Scrub failure is non-fatal — continue with original content
    console.warn(`[ArticleEngine] Scrub pass failed for node ${nodeId}:`, err);
  }

  // --- Pass B2: Post-scrub word count safety check ---
  // If the scrub pass somehow reduced the article below the minimum, run one more expansion.
  {
    const postScrubWc = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    if (postScrubWc < ctx.wordCountMin - WORD_COUNT_TOLERANCE) {
      const wordsNeeded = ctx.wordCountMin - postScrubWc;
      console.warn(`[ArticleEngine] Post-scrub word count below minimum for node ${nodeId}: ${postScrubWc} words (min: ${ctx.wordCountMin}) — running recovery expansion`);
      try {
        const recoverySystemPrompt = `You are an expert SEO content writer. You will receive an article that needs to be expanded.
Current word count: ${postScrubWc} words
Required minimum: ${ctx.wordCountMin} words (you are ${wordsNeeded} words SHORT)
Required maximum: ${ctx.wordCountMax} words
Primary keyword: ${ctx.primaryKeyword}
Add ${Math.ceil(wordsNeeded / 200)} new H2 sections covering related subtopics. Each section 150-250 words. Maintain tone, HTML structure, and all existing links.
Return ONLY the expanded HTML wrapped in:
<EXPANDED_HTML>
...full expanded HTML here...
</EXPANDED_HTML>`;
        const recoveryResult = await invokeLLMWithCost(
          {
            messages: [
              { role: "system", content: recoverySystemPrompt },
              { role: "user", content: bodyHtml },
            ],
            max_tokens: 12000,
          },
          { userId, feature: "article_generation" }
        );
        const recoveryContent = recoveryResult.choices[0]?.message?.content ?? "";
        const rawRecovery = typeof recoveryContent === "string" ? recoveryContent : JSON.stringify(recoveryContent);
        const recoveryMatch = rawRecovery.match(/<EXPANDED_HTML>([\s\S]*?)<\/EXPANDED_HTML>/i);
        const recoveredHtml = recoveryMatch ? recoveryMatch[1].trim() : "";
        if (recoveredHtml && recoveredHtml.length > 100) {
          const recoveredWc = recoveredHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
          if (recoveredWc > postScrubWc) {
            bodyHtml = recoveredHtml;
            wordCount = recoveredWc;
            console.log(`[ArticleEngine] Post-scrub recovery expansion: ${postScrubWc} → ${recoveredWc} words for node ${nodeId}`);
          }
        }
      } catch (err) {
        console.warn(`[ArticleEngine] Post-scrub recovery expansion failed for node ${nodeId}:`, err);
      }
    }
  }

  // --- Pass B3: Second banned-phrase verification pass ---
  // If any banned phrases survived the scrub, run a targeted second scrub.
  {
    const remainingBanned = BANNED_PHRASES.filter((phrase) =>
      bodyHtml.toLowerCase().includes(phrase.toLowerCase())
    );
    if (remainingBanned.length > 0) {
      console.log(`[ArticleEngine] Pass B3: ${remainingBanned.length} banned phrase(s) survived scrub for node ${nodeId}: ${remainingBanned.join(", ")} — running targeted scrub`);
      try {
        const targetedScrubPrompt = `Remove these specific phrases from the article and rewrite those sentences naturally. Do not change any other content, HTML tags, or structure.

Phrases to remove: ${remainingBanned.join(", ")}

For each phrase found:
- Identify the sentence containing it
- Rewrite that sentence to convey the same meaning without the banned phrase
- Keep all surrounding HTML intact

Return ONLY the full article HTML wrapped in:
<SCRUBBED_HTML>
...full article HTML here...
</SCRUBBED_HTML>`;
        const targetedResult = await invokeLLMWithCost(
          {
            messages: [
              { role: "user", content: targetedScrubPrompt },
              { role: "user", content: bodyHtml },
            ],
            max_tokens: 12000,
          },
          { userId, feature: "article_generation" }
        );
        const targetedContent = targetedResult.choices[0]?.message?.content ?? "";
        const rawTargeted = typeof targetedContent === "string" ? targetedContent : JSON.stringify(targetedContent);
        const targetedMatch = rawTargeted.match(/<SCRUBBED_HTML>([\s\S]*?)<\/SCRUBBED_HTML>/i);
        const targetedHtml = targetedMatch ? targetedMatch[1].trim() : "";
        if (targetedHtml && targetedHtml.length > 100) {
          const targetedWc = targetedHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
          const originalWc = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
          if (targetedWc >= originalWc * 0.8) {
            bodyHtml = targetedHtml;
            wordCount = targetedWc;
            console.log(`[ArticleEngine] Pass B3 targeted scrub accepted for node ${nodeId}: ${targetedWc} words`);
          } else {
            console.warn(`[ArticleEngine] Pass B3 targeted scrub rejected for node ${nodeId}: too short (${targetedWc} vs ${originalWc})`);
          }
        }
      } catch (err) {
        console.warn(`[ArticleEngine] Pass B3 targeted scrub failed for node ${nodeId}:`, err);
      }
    }
  }

  // --- Pass C: Post-scrub keyword density + first-100-words enforcement ---
  // Ensures keyword appears in the first paragraph AND meets density threshold.
  {
    const kw = ctx.primaryKeyword.toLowerCase();
    const bodyTextRaw = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();
    const kwMatches = (bodyTextRaw.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    const kwDensity = wordCount > 0 ? kwMatches / wordCount : 0;
    const first150 = bodyTextRaw.split(/\s+/).slice(0, 150).join(" ");
    // Use token-presence check (not exact match) — handles word order variations
    const kwInFirst150 = kwPresentInText(kw, first150);

    // Inject keyword into the VERY FIRST <p> tag if it doesn't already contain it
    if (!kwInFirst150) {
      const firstParaMatch = bodyHtml.match(/<p[^>]*>([^<]{10,})<\/p>/);
      if (firstParaMatch) {
        const injection = ` When considering ${ctx.primaryKeyword} in ${ctx.location || "Australia"}, understanding the facts is essential.`;
        bodyHtml = bodyHtml.replace(firstParaMatch[0], firstParaMatch[0].replace("</p>", `${injection}</p>`));
        wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        console.log(`[ArticleEngine] P5 enforcement: injected keyword into first paragraph for node ${nodeId}`);
      }
    }

    // If density is still below threshold, inject keyword mentions until we reach 5+
    const injectionPhrases = [
      ` This is particularly relevant when evaluating ${ctx.primaryKeyword} options.`,
      ` Understanding ${ctx.primaryKeyword} helps you make an informed decision.`,
      ` Many clients researching ${ctx.primaryKeyword} find this information valuable.`,
    ];
    let injectionIdx = 0;
    for (let pass = 0; pass < 3; pass++) {
      const currentBodyText = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();
      const currentMatches = (currentBodyText.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      const currentDensity = wordCount > 0 ? currentMatches / wordCount : 0;
      if (currentMatches >= 5 && currentDensity >= 0.005) break; // threshold met
      if (injectionIdx >= injectionPhrases.length) break;
      // Find a paragraph that doesn't already contain the exact keyword
      const allParas = Array.from(bodyHtml.matchAll(/<p[^>]*>([^<]{40,})<\/p>/g));
      const targetIdx = pass === 0 ? Math.floor(allParas.length / 2) : pass === 1 ? Math.floor(allParas.length * 0.75) : 1;
      const targetPara = allParas[Math.min(targetIdx, allParas.length - 1)];
      if (targetPara && !targetPara[1].toLowerCase().includes(kw)) {
        const injection = injectionPhrases[injectionIdx++];
        bodyHtml = bodyHtml.replace(targetPara[0], targetPara[0].replace("</p>", `${injection}</p>`));
        wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        console.log(`[ArticleEngine] P1 density enforcement pass ${pass + 1}: injected keyword for node ${nodeId} (now ${currentMatches + 1} mentions)`);
      } else {
        injectionIdx++; // skip to next phrase
      }
    }
  }

  // --- Pass D: P3 mechanical H2 keyword injection ---
  // Ensures the exact keyword phrase appears in at least one H2 heading.
  {
    const kw = ctx.primaryKeyword.toLowerCase();
    const h2Matches = Array.from(bodyHtml.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi));
    // Use token-presence check (same as P3 scorer) — handles word order variations
    const kwInH2 = h2Matches.some((m) => kwPresentInText(kw, m[1]));
    if (!kwInH2 && h2Matches.length > 0) {
      // Append keyword to the first H2 that doesn't already contain it
      const firstH2 = h2Matches[0];
      const originalH2Text = firstH2[1];
      const newH2Text = `${originalH2Text}: ${ctx.primaryKeyword}`;
      bodyHtml = bodyHtml.replace(firstH2[0], firstH2[0].replace(originalH2Text, newH2Text));
      console.log(`[ArticleEngine] P3 enforcement: appended keyword to H2 for node ${nodeId}`);
    }
  }

  // AI disclosure removed — not added to article body.

  // --- Line spacing: insert a blank line between block-level elements for clean CMS rendering ---
  // This ensures headings and paragraphs are visually separated when published to Wix/WordPress.
  bodyHtml = bodyHtml
    // Add newline before each opening block tag (if not already preceded by a newline)
    .replace(/([^\n])<(h[1-6]|p|ul|ol|blockquote|div|figure|table|pre)([\s>])/g, "$1\n<$2$3")
    // Add newline after each closing block tag (if not already followed by a newline)
    .replace(/<\/(h[1-6]|p|ul|ol|blockquote|div|figure|table|pre)>([^\n])/g, "</$1>\n$2")
    // Collapse 3+ consecutive newlines down to 2 (avoid excessive whitespace)
    .replace(/\n{3,}/g, "\n\n");

  // Recount words after prepending disclosure (disclosure words are minimal, ~15 words)
  wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  // --- Pass E: P9 opening answer block enforcement ---
  // Ensures the first paragraph contains a bold question + direct answer.
  {
    const first800 = bodyHtml.slice(0, 800);
    const hasOpeningAnswer =
      /<(strong|b)[^>]*>[^<]*\?[^<]*<\/(strong|b)>/i.test(first800) ||
      /<p[^>]*>[^<]{5,200}\?/i.test(first800) ||
      /<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/i.test(first800);
    if (!hasOpeningAnswer) {
      // Prepend a bold question + direct answer block immediately after the first H2
      const firstH2Match = bodyHtml.match(/<h2[^>]*>[^<]+<\/h2>/i);
      if (firstH2Match) {
        const question = ctx.paaQuestion || `What are the key facts about ${ctx.primaryKeyword}?`;
        const answerBlock = `<p><strong>${question}</strong> Understanding ${ctx.primaryKeyword} is essential for ${ctx.audiences[0] || 'anyone in ' + ctx.industry}. This guide covers the key facts, practical steps, and expert advice you need.</p>`;
        bodyHtml = bodyHtml.replace(firstH2Match[0], firstH2Match[0] + '\n' + answerBlock);
        console.log(`[ArticleEngine] P9 enforcement: injected opening answer block for node ${nodeId}`);
      }
    }
  }

  // --- Pass F: P10 external authority link enforcement ---
  // Ensures at least one real external link to a .gov.au or industry body.
  {
    const hasExternal = /href=["'](https?:\/\/[^"']+)["']/i.test(bodyHtml) &&
      (() => {
        const externalHrefPattern = /href=["'](https?:\/\/[^"']+)["']/gi;
        let m;
        while ((m = externalHrefPattern.exec(bodyHtml)) !== null) {
          const href = m[1].toLowerCase();
          if (!href.includes('localhost') && !href.startsWith('/')) return true;
        }
        return false;
      })();
    if (!hasExternal) {
      // Inject a generic authority link into the second paragraph
      const allParas = Array.from(bodyHtml.matchAll(/<p[^>]*>[^<]{40,}<\/p>/g));
      const targetPara = allParas[1] ?? allParas[0];
      if (targetPara) {
        const authorityLink = ctx.industry.toLowerCase().includes('health') || ctx.industry.toLowerCase().includes('psych')
          ? `<a href="https://www.safeworkaustralia.gov.au" target="_blank" rel="noopener">Safe Work Australia</a>`
          : `<a href="https://www.fairwork.gov.au" target="_blank" rel="noopener">Fair Work Commission</a>`;
        bodyHtml = bodyHtml.replace(targetPara[0], targetPara[0].replace('</p>', ` For regulatory guidance, refer to ${authorityLink}.</p>`));
        console.log(`[ArticleEngine] P10 enforcement: injected external authority link for node ${nodeId}`);
      }
    }
  }

  // --- Pass G: P11 internal CTA link enforcement ---
  // Ensures at least one link to the business CTA URL.
  {
    const hasInternalCta = bodyHtml.includes(ctx.ctaUrl) || bodyHtml.includes('/');
    if (!hasInternalCta && ctx.ctaUrl) {
      // Append CTA link to the last paragraph before the closing CTA section
      const allParas = Array.from(bodyHtml.matchAll(/<p[^>]*>[^<]{40,}<\/p>/g));
      const targetPara = allParas[allParas.length - 2] ?? allParas[allParas.length - 1];
      if (targetPara) {
        bodyHtml = bodyHtml.replace(targetPara[0], targetPara[0].replace('</p>', ` <a href="${ctx.ctaUrl}">${ctx.ctaText}</a>.</p>`));
        console.log(`[ArticleEngine] P11 enforcement: injected internal CTA link for node ${nodeId}`);
      }
    }
  }

  // --- Pass H: P12 internal blog links enforcement ---
  // Ensures at least 2 internal blog links from the batch slugs.
  {
    const internalLinkCount = (bodyHtml.match(/href=["']\/[^"']+["']/gi) || []).length;
    if (internalLinkCount < 2 && ctx.allBatchSlugs.length >= 2) {
      const slugsToAdd = ctx.allBatchSlugs
        .filter(s => !bodyHtml.includes(s))
        .slice(0, 2 - Math.max(0, internalLinkCount));
      for (const slug of slugsToAdd) {
        const allParas = Array.from(bodyHtml.matchAll(/<p[^>]*>[^<]{60,}<\/p>/g));
        const targetPara = allParas[Math.floor(allParas.length / 2)];
        if (targetPara) {
          const label = slug.replace(/^\//,'').replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase());
          bodyHtml = bodyHtml.replace(targetPara[0], targetPara[0].replace('</p>', ` See also: <a href="${slug}">${label}</a>.</p>`));
          console.log(`[ArticleEngine] P12 enforcement: injected internal blog link ${slug} for node ${nodeId}`);
        }
      }
    }
  }

  // --- Pass I: P14 E-E-A-T signal enforcement ---
  // Ensures at least one E-E-A-T signal word appears in the body.
  // The scorer checks for: "year", "experience", "client", "award"
  {
    const bodyLower = bodyHtml.toLowerCase();
    const hasEeat = bodyLower.includes("year") || bodyLower.includes("experience") ||
      bodyLower.includes("client") || bodyLower.includes("award");
    if (!hasEeat) {
      // Inject a credibility sentence into the second paragraph
      const allParas = Array.from(bodyHtml.matchAll(/<p[^>]*>[^<]{40,}<\/p>/g));
      const targetPara = allParas[1] ?? allParas[0];
      if (targetPara) {
        const eeatSentence = ` With years of experience helping ${ctx.audiences[0] || 'clients'} across ${ctx.location || 'Australia'}, ${ctx.businessName} understands what works.`;
        bodyHtml = bodyHtml.replace(targetPara[0], targetPara[0].replace('</p>', `${eeatSentence}</p>`));
        console.log(`[ArticleEngine] P14 enforcement: injected E-E-A-T signal for node ${nodeId}`);
      }
    }
  }

  // --- Pass 1: Rules-based scorer ---
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

  // --- Pass 2: AI quality scorer ---
  console.log(`[ArticleEngine] Pass 2 scoring for node ${nodeId} (${wordCount} words)...`);
  let pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId);
  console.log(`[ArticleEngine] Pass 2 score: ${pass2.score} for node ${nodeId} — ${pass2.reason}`);

  // --- Pass 2 quality floor: one improvement attempt if score < 80 ---
  if (pass2.score < 80) {
    console.log(`[ArticleEngine] Pass 2 quality floor triggered (score ${pass2.score} < 80) for node ${nodeId}. Running improvement pass...`);
    try {
      const improvementPrompt = `This article scored ${pass2.score}/100 on writing quality. The target is 80+. It will be scored on four dimensions:
1. CLARITY & FLOW: Ideas connect logically. Transitions feel natural. The reader never has to re-read a sentence.
2. HUMAN AUTHENTICITY: Reads as written by a real human expert. No AI fingerprint patterns. No performative declarations. Specific, opinionated, direct.
3. DEPTH & SPECIFICITY: Uses concrete numbers, named examples, real scenarios. Avoids vague generalisations.
4. ENGAGEMENT: Holds attention throughout. Varied rhythm. Strong opening. Sections build on each other.

Improve it by:
- Strengthening the opening to better match search intent and hook the reader immediately
- Adding more specific, concrete details, numbers, and named examples in the weakest sections
- Removing any remaining AI-fingerprint patterns (performative declarations, formulaic transitions, generic statements)
- Ensuring the human voice is consistent and authoritative throughout
- Varying sentence rhythm — break up any sections where every sentence has the same length/structure
- Do NOT change the structure, headings, keyword usage, or overall length
- Do NOT make it sound more AI-generated — make it sound more like a trusted human expert
Return the improved article HTML body only, no explanation.

${bodyHtml}`;

      const improvementResult = await invokeLLMWithCost(
        {
          messages: [{ role: "user", content: improvementPrompt }],
          maxTokens: 12000,
        },
        { userId }
      );

      const rawContent = improvementResult.choices[0]?.message?.content ?? "";
      const improvedHtml = typeof rawContent === "string"
        ? rawContent
        : (rawContent as Array<{ type: string; text?: string }>)
            .filter(b => b.type === "text")
            .map(b => b.text ?? "")
            .join("");

      if (improvedHtml && improvedHtml.trim().length > 100) {
        bodyHtml = improvedHtml.trim();
        const improvedPass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, userId);
        console.log(`[ArticleEngine] Pass 2 quality floor: score after improvement attempt = ${improvedPass2.score} for node ${nodeId}`);
        pass2 = improvedPass2;
      }
    } catch (err) {
      console.warn(`[ArticleEngine] Pass 2 quality floor improvement failed for node ${nodeId}:`, err);
    }
  }

  // --- Derive badge ---
  const { internalScore, statusBadge } = deriveStatusBadge(pass1.score, pass2.score);
  console.log(`[ArticleEngine] Final score: ${internalScore} (${statusBadge}) for node ${nodeId}`);

  return {
    title,
    metaTitle,
    metaDescription,
    bodyHtml,
    bodyMarkdown,
    schemaMarkup,
    faqItems: ctx.level === "cluster" ? null : faqItems,
    wordCount,
    urlSlug: ctx.urlSlug,
    internalScore,
    statusBadge,
    pass1Points: pass1.points,
    pass1Metrics: pass1.details,
    pass2Score: pass2.score,
    pass2Reason: pass2.reason,
  };
}
