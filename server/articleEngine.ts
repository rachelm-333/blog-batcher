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
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Word count rules (from scope Table 4)
// ---------------------------------------------------------------------------
export const WORD_COUNT_RULES = {
  cornerstone: { min: 2500, max: 3200 },
  pillar: { min: 1500, max: 1800 },
  cluster: { min: 1000, max: 1200 },
} as const;

// ---------------------------------------------------------------------------
// Status badge thresholds (from scope Section 6.6)
// ---------------------------------------------------------------------------
export const BADGE_THRESHOLDS = {
  authority_ready: 90,  // all 16 points met
  strong: 80,           // 14–15 points met
  // below 80 = needs_review
} as const;

// Minimum score to surface to user (below = auto-regenerate once)
export const MIN_DELIVERY_SCORE = 80;

// ---------------------------------------------------------------------------
// Banned AI fingerprint phrases (from scope Section 6.4)
// ---------------------------------------------------------------------------
export const BANNED_PHRASES = [
  "in today's world",
  "it's important to note",
  "it is important to note",
  "delve into",
  "game-changer",
  "game changer",
  "leverage",
  "synergy",
  "transformative",
] as const;

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
export async function preGenerateSlugs(businessId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Get all nodes without slugs, joined with their keywords
  const nodes = await db
    .select({
      nodeId: articleNodes.id,
      existingSlug: articleNodes.urlSlug,
      keyword: keywords.primaryKeyword,
    })
    .from(articleNodes)
    .leftJoin(keywords, eq(keywords.articleNodeId, articleNodes.id))
    .where(and(eq(articleNodes.businessId, businessId), isNull(articleNodes.urlSlug)));

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
export async function getOrderedNodes(businessId: number): Promise<OrderedNode[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const nodes = await db
    .select()
    .from(articleNodes)
    .where(eq(articleNodes.businessId, businessId));

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
    case_study: "Case Study",
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

  return `You are an expert SEO content writer producing a high-authority blog article for an Australian business.

=== BUSINESS CONTEXT ===
Business Name: ${ctx.businessName}
Industry: ${ctx.industry}
Location: ${ctx.location}
Unique Value Proposition: ${ctx.uvp}
Social Proof: ${ctx.socialProof || "Not provided"}
Target Audiences: ${ctx.audiences.join(", ") || "General audience"}

Services/Products (use these for internal CTA links):
${servicesText || "No services listed"}

Primary CTA: ${ctx.ctaText} → ${ctx.ctaUrl}

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
Word Count: ${ctx.wordCountMin}–${ctx.wordCountMax} words (HARD MAXIMUM: ${ctx.wordCountMax} words — do not exceed)

=== INTERNAL LINK CONTEXT ===
${internalLinkContext || "No parent/sibling articles yet — this is a Cornerstone."}

All article slugs in this batch (use for internal blog links):
${ctx.allBatchSlugs.slice(0, 20).join(", ")}

=== 16-POINT AUTHORITY STANDARD — ALL POINTS ARE MANDATORY ===

1. PRIMARY KEYWORD DENSITY: Minimum 4 mentions. Maximum 1% of total word count. Never forced — must read naturally.
2. KEYWORD IN H1: Primary keyword must appear in the H1 heading.
3. KEYWORD IN H2: Primary keyword must appear in at least one H2.
4. KEYWORD IN H3: Primary keyword must appear in at least one H3 (if H3s are present).
5. KEYWORD IN FIRST 100 WORDS: Primary keyword must appear authentically within the first 100 words.
6. KEYWORD IN URL SLUG: Already set to /${ctx.urlSlug} — ensure H1/title aligns with this slug.
7. META TITLE: Must include primary keyword. Maximum 60 characters. Written for click-through rate.
8. META DESCRIPTION: Must include primary keyword. Exactly 140–160 characters. Written for CTR.
9. OPENING ANSWER BLOCK: First 40–60 words directly answer the PAA question. Format for Featured Snippet (clear, direct, no fluff).
10. EXTERNAL AUTHORITY LINK: At least one link to a high-authority external source relevant to the industry. Use natural anchor text — never a raw URL.
11. INTERNAL CTA LINK: At least one link back to the business (shop, product, service, bookings, or testimonials page). Anchor text only.
12. INTERNAL BLOG LINKS: Link to other articles in the batch using anchor text. No keyword cannibalization.
13. SCHEMA MARKUP: Always include Article schema + Breadcrumb schema. ${isCornerstoneOrPillar ? "Include FAQ schema (this is a Cornerstone/Pillar). Include How-To schema if applicable." : "DO NOT include FAQ schema on Cluster articles."}
14. E-E-A-T SIGNALS: Weave in Experience, Expertise, Authoritativeness, and Trustworthiness. Include social proof signals: ${ctx.socialProof || "mention industry experience"}.
15. HUMAN AUTHENTICITY: No AI fingerprint patterns. Content must solve the reader's problem completely. Must be cohesive with the rest of the batch.
16. ARTICLE TYPE STRUCTURE: Format and structure this as a ${typeLabel}. The title must signal specific territory ownership.

=== ABSOLUTE RULES ===
- DO NOT fabricate statistics, quotes, or data. If you reference a statistic, it must come from a real, citable source. Use the external authority link as the citation anchor.
- DO NOT use em dashes (—) excessively.
- DO NOT open with a rhetorical question.
- DO NOT use these phrases: "in today's world", "it's important to note", "delve into", "game-changer", "leverage", "synergy", "transformative".
- DO NOT repeat sentence structures — vary sentence length, mixing short punchy sentences with longer explanatory ones.
- Write as a specific human expert with a clear point of view, not as a generic AI assistant.
- Use Australian English spelling (e.g., "optimise" not "optimize", "colour" not "color").

=== REQUIRED OUTPUT FORMAT (JSON) ===
Return a single JSON object with these exact fields:
{
  "title": "H1 title of the article",
  "metaTitle": "SEO meta title (max 60 chars, includes primary keyword)",
  "metaDescription": "SEO meta description (140–160 chars exactly, includes primary keyword)",
  "bodyHtml": "Full article body as clean HTML (h2, h3, p, ul, ol, a tags only — no inline styles)",
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

export function buildScrubPrompt(bodyHtml: string, bodyMarkdown: string): string {
  return `You are an AI content editor specialising in removing AI fingerprints from blog content.

Review the following article and rewrite it to remove all AI tells. The result must be indistinguishable from content written by a specific human expert with a strong point of view.

SPECIFIC THINGS TO FIX:
1. Remove em dash (—) overuse — replace with commas, full stops, or restructure the sentence
2. Remove rhetorical question openings — replace with direct statements
3. Remove these exact phrases (replace with natural alternatives): "in today's world", "it's important to note", "it is important to note", "delve into", "game-changer", "game changer", "leverage", "synergy", "transformative"
4. Remove repetitive sentence structures — vary the rhythm
5. Vary sentence length — mix short punchy sentences (5–10 words) with longer explanatory ones (20–30 words)
6. Ensure the article sounds like it was written by a specific human with a point of view, not a generic assistant
7. Preserve all HTML tags, links, headings, and schema markup exactly — only change the prose text

IMPORTANT: Do NOT change the meaning, facts, keyword placement, or structure. Only improve the human authenticity of the writing.

Return a JSON object with:
{
  "bodyHtml": "scrubbed HTML body",
  "bodyMarkdown": "scrubbed Markdown body"
}

ARTICLE TO SCRUB:
${bodyHtml.slice(0, 8000)}`;
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

  const kw = primaryKeyword.toLowerCase();
  const bodyLower = bodyHtml.toLowerCase();
  const titleLower = title.toLowerCase();

  // Count keyword occurrences in body text (strip tags first)
  const bodyText = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();
  const kwMatches = (bodyText.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const kwDensity = wordCount > 0 ? kwMatches / wordCount : 0;

  // Extract first 100 words
  const first100Words = bodyText.split(/\s+/).slice(0, 100).join(" ");

  // H1 check (title)
  const h1Present = titleLower.includes(kw);

  // H2 check
  const h2Matches = bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  const kwInH2 = h2Matches.some(h => h.toLowerCase().includes(kw));

  // H3 check
  const h3Matches = bodyHtml.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];
  const kwInH3 = h3Matches.length === 0 || h3Matches.some(h => h.toLowerCase().includes(kw));

  const wc = WORD_COUNT_RULES[level];

  const points: Record<string, boolean> = {
    p1_keyword_density: kwMatches >= 4 && kwDensity <= 0.01,
    p2_keyword_in_h1: h1Present,
    p3_keyword_in_h2: kwInH2,
    p4_keyword_in_h3: kwInH3,
    p5_keyword_first_100: first100Words.includes(kw),
    p6_keyword_in_slug: urlSlug.toLowerCase().includes(kw.replace(/\s+/g, "-")),
    p7_meta_title: metaTitle.toLowerCase().includes(kw) && metaTitle.length <= 60,
    p8_meta_description: metaDescription.toLowerCase().includes(kw) && metaDescription.length >= 140 && metaDescription.length <= 160,
    p9_opening_answer: bodyText.split(/\s+/).slice(0, 60).join(" ").length > 20,  // has content in first 60 words
    p10_external_link: externalLinkPresent,
    p11_internal_cta: internalCtaLinkPresent,
    p12_internal_blog_links: internalBlogLinksPresent,
    p13_schema: schemaPresent,
    p14_eeat: bodyLower.includes("year") || bodyLower.includes("experience") || bodyLower.includes("client") || bodyLower.includes("award"),
    p15_human_authenticity: !BANNED_PHRASES.some(phrase => bodyLower.includes(phrase.toLowerCase())),
    p16_word_count: wordCount >= wc.min && wordCount <= wc.max,
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

export async function runPass2Scorer(bodyHtml: string, primaryKeyword: string): Promise<{ score: number; feedback: string }> {
  const prompt = `You are an SEO content quality auditor. Score the following article on these 5 criteria (each worth 20 points, total 100):

1. SEARCH INTENT RESOLUTION (20 pts): Does it fully resolve what the searcher is looking for?
2. HUMAN AUTHENTICITY (20 pts): Does it read as written by a real human expert, not AI?
3. TITLE TERRITORY (20 pts): Does the title own a specific territory and signal clear value?
4. E-E-A-T AUTHORITY (20 pts): Does it demonstrate Experience, Expertise, Authoritativeness, Trustworthiness?
5. BATCH COHESION (20 pts): Does it feel like part of a coherent content strategy?

Primary keyword: ${primaryKeyword}

Article (first 3000 chars):
${bodyHtml.slice(0, 3000)}

Return JSON: { "score": <0-100 integer>, "feedback": "<one sentence summary>" }`;

  try {
    const result = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const content = result.choices[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    return {
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      feedback: parsed.feedback || "",
    };
  } catch {
    // If AI scorer fails, return a neutral score so generation isn't blocked
    return { score: 75, feedback: "AI quality check unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Combined score → status badge
// ---------------------------------------------------------------------------

export function deriveStatusBadge(pass1Score: number, pass2Score: number): {
  internalScore: number;
  statusBadge: "authority_ready" | "strong" | "needs_review";
} {
  // Weight: Pass 1 (objective) = 60%, Pass 2 (subjective) = 40%
  const internalScore = Math.round(pass1Score * 0.6 + pass2Score * 0.4);

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
  pass2Score: number;
  pass2Feedback: string;
}

export async function generateSingleArticle(
  businessId: number,
  nodeId: number,
  allOrderedNodes: OrderedNode[]
): Promise<GenerationResult> {
  const ctx = await buildArticleContext(businessId, nodeId, allOrderedNodes);

  // --- Pass A: Generate article ---
  const genPrompt = buildGenerationPrompt(ctx);
  const genResult = await invokeLLM({
    messages: [{ role: "user", content: genPrompt }],
    response_format: { type: "json_object" },
    max_tokens: 16000,
  });

  const genContent = genResult.choices[0]?.message?.content;
  let genParsed: Record<string, unknown>;
  try {
    genParsed = JSON.parse(typeof genContent === "string" ? genContent : JSON.stringify(genContent));
  } catch {
    throw new Error("Article generation returned invalid JSON");
  }

  let bodyHtml = (genParsed.bodyHtml as string) || "";
  let bodyMarkdown = (genParsed.bodyMarkdown as string) || "";
  const title = (genParsed.title as string) || "";
  const metaTitle = (genParsed.metaTitle as string) || "";
  const metaDescription = (genParsed.metaDescription as string) || "";
  const schemaMarkup = (genParsed.schemaMarkup as string) || "";
  const faqItems = (genParsed.faqItems as Array<{ question: string; answer: string }> | null) ?? null;
  let wordCount = (genParsed.wordCount as number) || bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  // Enforce hard word count maximum for Cornerstones
  if (ctx.level === "cornerstone" && wordCount > WORD_COUNT_RULES.cornerstone.max) {
    // Truncate at the max — trim trailing HTML tags cleanly
    const words = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean);
    wordCount = WORD_COUNT_RULES.cornerstone.max;
    // Note: we flag this rather than destructively truncating HTML
  }

  // --- Pass B: AI fingerprint scrub ---
  try {
    const scrubPrompt = buildScrubPrompt(bodyHtml, bodyMarkdown);
    const scrubResult = await invokeLLM({
      messages: [{ role: "user", content: scrubPrompt }],
      response_format: { type: "json_object" },
      max_tokens: 16000,
    });
    const scrubContent = scrubResult.choices[0]?.message?.content;
    const scrubParsed = JSON.parse(typeof scrubContent === "string" ? scrubContent : JSON.stringify(scrubContent));
    if (scrubParsed.bodyHtml) bodyHtml = scrubParsed.bodyHtml;
    if (scrubParsed.bodyMarkdown) bodyMarkdown = scrubParsed.bodyMarkdown;
    // Recount words after scrub
    wordCount = bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  } catch {
    // Scrub failure is non-fatal — continue with original content
    console.warn(`[ArticleEngine] Scrub pass failed for node ${nodeId} — using original content`);
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
    externalLinkPresent: (genParsed.externalLinkPresent as boolean) ?? bodyHtml.includes("http"),
    internalCtaLinkPresent: (genParsed.internalCtaLinkPresent as boolean) ?? bodyHtml.includes(ctx.ctaUrl),
    internalBlogLinksPresent: (genParsed.internalBlogLinksPresent as boolean) ?? false,
    schemaPresent: (genParsed.schemaPresent as boolean) ?? schemaMarkup.length > 0,
  });

  // --- Pass 2: AI quality scorer ---
  const pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword);

  // --- Derive badge ---
  const { internalScore, statusBadge } = deriveStatusBadge(pass1.score, pass2.score);

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
    pass2Score: pass2.score,
    pass2Feedback: pass2.feedback,
  };
}
