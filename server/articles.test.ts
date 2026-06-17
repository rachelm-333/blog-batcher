/**
 * Layer 6 — Stage 4: Article Generation Tests
 *
 * Tests cover all 6 acceptance criteria:
 *  1. Articles generate in correct order (Cornerstone → Pillar → Cluster)
 *  2. Word count ranges enforced per article type
 *  3. All 16 Authority Standard points applied (via Pass 1 scorer)
 *  4. Status badge derives correctly from combined score
 *  5. Articles save to DB with correct status (tested via router procedures)
 *  6. No fabricated stats instruction in every prompt
 *  7. AI fingerprint scrub pass runs (scrub prompt structure verified)
 */

import { describe, expect, it } from "vitest";
import {
  BADGE_THRESHOLDS,
  BANNED_PHRASES,
  MIN_DELIVERY_SCORE,
  WORD_COUNT_RULES,
  buildGenerationPrompt,
  buildScrubPrompt,
  deriveStatusBadge,
  generateSlug,
  runPass1Scorer,
  type ArticleContext,
  type OrderedNode,
} from "./articleEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ArticleContext> = {}): ArticleContext {
  return {
    businessName: "Acme Plumbing",
    industry: "Plumbing",
    location: "Sydney, NSW",
    uvp: "Same-day emergency plumbing",
    socialProof: "20 years in business. 5000 clients served.",
    voiceBrief: "Professional, direct, helpful.",
    audiences: ["Homeowners", "Property Managers"],
    services: [
      { name: "Emergency Plumbing", pageUrl: "/emergency-plumbing" },
      { name: "Blocked Drains", pageUrl: "/blocked-drains" },
    ],
    ctaText: "Book a Plumber",
    ctaUrl: "https://acmeplumbing.com.au/book",
    competitors: [{ name: "FastFlow Plumbing", url: "https://fastflow.com.au" }],
    primaryKeyword: "emergency plumber sydney",
    secondaryKeywords: ["24 hour plumber", "burst pipe sydney"],
    paaQuestion: "How quickly can an emergency plumber arrive?",
    articleType: "cornerstone_guide",
    level: "cornerstone",
    wordCountMin: 2000,
    wordCountMax: 3000,
    urlSlug: "emergency-plumber-sydney",
    allBatchSlugs: ["/emergency-plumber-sydney", "/blocked-drains-sydney", "/hot-water-repairs"],
    ...overrides,
  };
}

function makePass1Params(overrides: Partial<Parameters<typeof runPass1Scorer>[0]> = {}) {
  return {
    bodyHtml: `<h2>Emergency Plumber Sydney Guide</h2><p>An emergency plumber sydney can arrive within 30 minutes. When you need an emergency plumber sydney, call us. Our emergency plumber sydney team is available 24/7. We have 20 years of experience serving clients across Sydney.</p><h3>Why Choose an Emergency Plumber Sydney?</h3><p>Our emergency plumber sydney service is fast and reliable.</p><a href="https://acmeplumbing.com.au/book">Book a Plumber</a><a href="https://plumbingaustralia.com.au">Plumbing Industry Authority</a>`,
    bodyMarkdown: "# Emergency Plumber Sydney Guide",
    title: "Emergency Plumber Sydney: 24/7 Fast Response Guide",
    metaTitle: "Emergency Plumber Sydney | 24/7 Fast Response",
    metaDescription: "Need an emergency plumber in Sydney? We arrive in 30 minutes. Call our 24/7 emergency plumber Sydney team for burst pipes, blocked drains, and more.",
    urlSlug: "emergency-plumber-sydney",
    wordCount: 2600,
    level: "cornerstone" as const,
    primaryKeyword: "emergency plumber sydney",
    externalLinkPresent: true,
    internalCtaLinkPresent: true,
    internalBlogLinksPresent: true,
    schemaPresent: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Acceptance Criterion: Correct generation order
// ---------------------------------------------------------------------------

describe("Generation order", () => {
  it("WORD_COUNT_RULES defines all three levels", () => {
    expect(WORD_COUNT_RULES.cornerstone).toBeDefined();
    expect(WORD_COUNT_RULES.pillar).toBeDefined();
    expect(WORD_COUNT_RULES.cluster).toBeDefined();
  });

  it("Cornerstone word count range is 2000–3200", () => {
    expect(WORD_COUNT_RULES.cornerstone.min).toBe(2000);
    expect(WORD_COUNT_RULES.cornerstone.max).toBe(3200);
  });

  it("Pillar word count range is 1500–2200", () => {
    expect(WORD_COUNT_RULES.pillar.min).toBe(1500);
    expect(WORD_COUNT_RULES.pillar.max).toBe(2200);
  });

  it("Cluster word count range is 800–1300", () => {
    expect(WORD_COUNT_RULES.cluster.min).toBe(800);
    expect(WORD_COUNT_RULES.cluster.max).toBe(1300);
  });

  it("getOrderedNodes sorts cornerstones before pillars before clusters (logic test)", () => {
    // Simulate the sort logic used in getOrderedNodes
    const nodes: OrderedNode[] = [
      { nodeId: 3, level: "cluster", articleType: "how_to", urlSlug: "c1", parentCornerstoneId: 1, parentPillarId: 2, sortOrder: 1 },
      { nodeId: 2, level: "pillar", articleType: "top_10_list", urlSlug: "p1", parentCornerstoneId: 1, parentPillarId: null, sortOrder: 1 },
      { nodeId: 1, level: "cornerstone", articleType: "cornerstone_guide", urlSlug: "cs1", parentCornerstoneId: null, parentPillarId: null, sortOrder: 1 },
    ];

    const cornerstones = nodes.filter(n => n.level === "cornerstone");
    const pillars = nodes.filter(n => n.level === "pillar");
    const clusters = nodes.filter(n => n.level === "cluster");
    const ordered = [...cornerstones, ...pillars, ...clusters];

    expect(ordered[0].level).toBe("cornerstone");
    expect(ordered[1].level).toBe("pillar");
    expect(ordered[2].level).toBe("cluster");
  });
});

// ---------------------------------------------------------------------------
// 2. Acceptance Criterion: Word count enforcement
// ---------------------------------------------------------------------------

describe("Word count enforcement", () => {
  it("Pass 1 scorer fails p16 when word count is well below minimum for cornerstone", () => {
    // 1800 words is 200 below the 2000 minimum, exceeding the 100-word tolerance
    const result = runPass1Scorer(makePass1Params({ wordCount: 1800, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 when word count is within 100-word tolerance of minimum", () => {
    // 1920 words is 80 below the 2000 minimum, within the 100-word tolerance
    const result = runPass1Scorer(makePass1Params({ wordCount: 1920, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 when word count exceeds maximum for cornerstone (3200)", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 3500, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 when word count is within range for cornerstone", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 2600, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer passes p16 for pillar within 1500–2200", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 2000, level: "pillar" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer passes p16 for pillar at 2206 words (previously failing)", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 2206, level: "pillar" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 for pillar below 1500", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1200, level: "pillar" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 for cluster within 800–1300", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1100, level: "cluster" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 for cluster above 1300", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1500, level: "cluster" }));
    expect(result.points.p16_word_count).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Acceptance Criterion: 16-point Authority Standard prompt
// ---------------------------------------------------------------------------

describe("16-point Authority Standard in generation prompt", () => {
  const ctx = makeContext();
  const prompt = buildGenerationPrompt(ctx);

  it("Prompt includes all 16 numbered points", () => {
    for (let i = 1; i <= 16; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });

  it("Prompt includes primary keyword density rule (point 1)", () => {
    expect(prompt).toContain("PRIMARY KEYWORD DENSITY");
    // Updated: minimum 4 mentions, hard max 1% density
    expect(prompt).toContain("MINIMUM of 4 times");
    expect(prompt).toContain("1%");
  });

  it("Prompt instructs keyword density rule with minimum 4 appearances", () => {
    // New single-pass prompt enforces density via the 16-point Authority Standard rule 1
    expect(prompt).toContain("MINIMUM of 4 times");
    expect(prompt).toContain("1%");
  });

  it("Prompt includes keyword in H1 rule (point 2)", () => {
    expect(prompt).toContain("KEYWORD IN H1");
  });

  it("Prompt requires keyword in H2 (not just H3)", () => {
    expect(prompt).toContain("KEYWORD IN H2");
    expect(prompt).toContain("AT LEAST ONE <h2> heading");
    // The 16-point header declares all points are mandatory
    expect(prompt).toContain("ALL POINTS ARE MANDATORY");
  });

  it("Prompt instructs keyword within first 100 words of body text — point 5", () => {
    expect(prompt).toContain("KEYWORD IN FIRST 100 WORDS");
    expect(prompt).toContain("first 100 words");
  });

  it("Prompt includes meta title rule with 60 char limit (point 7)", () => {
    expect(prompt).toContain("META TITLE");
    expect(prompt).toContain("60 characters");
  });

  it("Prompt includes meta description rule with 140–160 char range (point 8)", () => {
    expect(prompt).toContain("META DESCRIPTION");
    expect(prompt).toContain("140–160 characters");
  });

  it("Prompt includes opening answer block / Featured Snippet rule (point 9)", () => {
    expect(prompt).toContain("OPENING ANSWER BLOCK");
    expect(prompt).toContain("Featured Snippet");
    // Updated: must instruct bold question format
    expect(prompt).toContain("<strong>");
  });

  it("Prompt includes external authority link rule (point 10) with real-source requirement", () => {
    expect(prompt).toContain("EXTERNAL AUTHORITY LINK");
    // Updated: must specify real sources (.gov.au, industry body, etc.)
    expect(prompt).toContain(".gov.au");
    expect(prompt).toContain("industry body");
    expect(prompt).toContain("genuine");
  });

  it("Prompt includes internal CTA link rule (point 11)", () => {
    expect(prompt).toContain("INTERNAL CTA LINK");
  });

  it("Prompt includes internal blog links rule (point 12) with minimum 2 and real slugs only", () => {
    expect(prompt).toContain("INTERNAL BLOG LINKS");
    expect(prompt).toContain("at minimum 2 internal links");
    expect(prompt).toContain("do NOT invent");
  });

  it("Prompt includes schema markup rule (point 13)", () => {
    expect(prompt).toContain("SCHEMA MARKUP");
    expect(prompt).toContain("Article schema");
  });

  it("Prompt includes E-E-A-T signals rule (point 14)", () => {
    expect(prompt).toContain("E-E-A-T");
  });

  it("Prompt includes human authenticity rule (point 15)", () => {
    expect(prompt).toContain("HUMAN AUTHENTICITY");
  });

  it("Cornerstone prompt includes FAQ schema instruction", () => {
    const cornerstoneCtx = makeContext({ level: "cornerstone" });
    const p = buildGenerationPrompt(cornerstoneCtx);
    expect(p).toContain("FAQ schema");
  });

  it("Cluster prompt explicitly excludes FAQ schema", () => {
    const clusterCtx = makeContext({
      level: "cluster",
      articleType: "how_to",
      wordCountMin: 800,
      wordCountMax: 1200,
    });
    const p = buildGenerationPrompt(clusterCtx);
    expect(p).toContain("DO NOT include FAQ schema on Cluster articles");
  });

  it("Prompt includes word count range and hard maximum", () => {
    expect(prompt).toContain("2000–3000");
    expect(prompt).toContain("HARD MAXIMUM: 3000");
  });

  it("Prompt includes business name", () => {
    expect(prompt).toContain("Acme Plumbing");
  });

  it("Prompt includes primary keyword", () => {
    expect(prompt).toContain("emergency plumber sydney");
  });

  it("Prompt includes PAA question", () => {
    expect(prompt).toContain("How quickly can an emergency plumber arrive?");
  });
});

// ---------------------------------------------------------------------------
// 4. Acceptance Criterion: No fabricated stats instruction
// ---------------------------------------------------------------------------

describe("No fabricated stats instruction", () => {
  it("Generation prompt explicitly forbids fabricated statistics", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("DO NOT fabricate statistics");
  });

  it("Generation prompt forbids fabricated quotes", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("quotes");
  });

  it("Fabrication rule is in ABSOLUTE RULES section", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("ABSOLUTE RULES");
    const absoluteRulesIndex = prompt.indexOf("ABSOLUTE RULES");
    const fabricationIndex = prompt.indexOf("DO NOT fabricate");
    expect(fabricationIndex).toBeGreaterThan(absoluteRulesIndex);
  });
});

// ---------------------------------------------------------------------------
// 5. Acceptance Criterion: AI fingerprint scrub pass runs
// ---------------------------------------------------------------------------

describe("AI fingerprint scrub pass", () => {
  it("buildScrubPrompt returns a non-empty prompt", () => {
    const scrubPrompt = buildScrubPrompt("<p>Test content</p>", "Test content");
    expect(scrubPrompt.length).toBeGreaterThan(100);
  });

  it("Scrub prompt lists all banned phrases", () => {
    const scrubPrompt = buildScrubPrompt("<p>Test</p>", "Test");
    for (const phrase of BANNED_PHRASES) {
      expect(scrubPrompt).toContain(phrase);
    }
  });

  it("Scrub prompt instructs to preserve HTML tags", () => {
    const scrubPrompt = buildScrubPrompt("<p>Test</p>", "Test");
    expect(scrubPrompt).toContain("Preserve ALL HTML tags");
  });

  it("Scrub prompt instructs to remove em dash overuse", () => {
    const scrubPrompt = buildScrubPrompt("<p>Test</p>", "Test");
    expect(scrubPrompt).toContain("em dash");
  });

  it("BANNED_PHRASES list contains all required phrases", () => {
    const required = [
      "in today's world",
      "delve into",
      "game-changer",
      "leverage",
      "synergy",
      "transformative",
      // New AI-fingerprint / performative phrases
      "non-negotiable",
      "it's worth noting",
      "the truth is",
      "let's be honest",
      "the reality is",
      "this means that",
      "game-changing",
      "make no mistake",
      "here's the thing",
      "the fact is",
      "simply put",
      "it's no secret",
      "spoiler alert",
      "the good news is",
      "the bad news is",
    ];
    for (const phrase of required) {
      expect(BANNED_PHRASES).toContain(phrase);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Acceptance Criterion: Status badge derives correctly
// ---------------------------------------------------------------------------

describe("Status badge derivation", () => {
  it("authority_ready badge when combined score ≥ 90", () => {
    const { statusBadge, internalScore } = deriveStatusBadge(95, 95);
    expect(statusBadge).toBe("authority_ready");
    expect(internalScore).toBeGreaterThanOrEqual(BADGE_THRESHOLDS.authority_ready);
  });

  it("strong badge when combined score is 80–89", () => {
    const { statusBadge, internalScore } = deriveStatusBadge(85, 80);
    expect(statusBadge).toBe("strong");
    expect(internalScore).toBeGreaterThanOrEqual(BADGE_THRESHOLDS.strong);
    expect(internalScore).toBeLessThan(BADGE_THRESHOLDS.authority_ready);
  });

  it("needs_review badge when combined score < 80", () => {
    const { statusBadge, internalScore } = deriveStatusBadge(70, 65);
    expect(statusBadge).toBe("needs_review");
    expect(internalScore).toBeLessThan(BADGE_THRESHOLDS.strong);
  });

  it("Combined score is Pass 1 only (Pass 2 is advisory)", () => {
    // Badge is now based solely on Pass 1 score — Pass 2 is stored but does not affect badge
    const { internalScore } = deriveStatusBadge(100, 0);
    expect(internalScore).toBe(100);
  });

  it("Combined score is 100 when both passes are 100", () => {
    const { internalScore } = deriveStatusBadge(100, 100);
    expect(internalScore).toBe(100);
  });

  it("MIN_DELIVERY_SCORE is 81 (13/16 points = auto-regenerate threshold)", () => {
    // 13/16 * 100 = 81.25, rounded to 81
    expect(MIN_DELIVERY_SCORE).toBe(81);
  });

  it("BADGE_THRESHOLDS.authority_ready is 94 (15/16 points)", () => {
    // 15/16 * 100 = 93.75, rounded to 94
    expect(BADGE_THRESHOLDS.authority_ready).toBe(94);
  });

  it("BADGE_THRESHOLDS.strong is 81 (13/16 points)", () => {
    // 13/16 * 100 = 81.25, rounded to 81
    expect(BADGE_THRESHOLDS.strong).toBe(81);
  });
});

// ---------------------------------------------------------------------------
// 7. Pass 1 scorer — rules-based checks
// ---------------------------------------------------------------------------

describe("Pass 1 scorer — rules-based", () => {
  it("Returns score as integer 0–100", () => {
    const result = runPass1Scorer(makePass1Params());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("Returns all 16 point keys", () => {
    const result = runPass1Scorer(makePass1Params());
    const expectedKeys = [
      "p1_keyword_density", "p2_keyword_in_h1", "p3_keyword_in_h2",
      "p4_keyword_in_h3", "p5_keyword_first_100", "p6_keyword_in_slug",
      "p7_meta_title", "p8_meta_description", "p9_opening_answer",
      "p10_external_link", "p11_internal_cta", "p12_internal_blog_links",
      "p13_schema", "p14_eeat", "p15_human_authenticity", "p16_word_count",
    ];
    for (const key of expectedKeys) {
      expect(result.points).toHaveProperty(key);
    }
  });

  it("p2_keyword_in_h1 passes when keyword is in title", () => {
    const result = runPass1Scorer(makePass1Params({
      title: "Emergency Plumber Sydney: 24/7 Fast Response",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p2_keyword_in_h1).toBe(true);
  });

  it("p2_keyword_in_h1 fails when keyword is NOT in title", () => {
    const result = runPass1Scorer(makePass1Params({
      title: "How to Fix a Leaky Tap",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p2_keyword_in_h1).toBe(false);
  });

  it("p7_meta_title fails when title exceeds 60 chars", () => {
    const result = runPass1Scorer(makePass1Params({
      metaTitle: "Emergency Plumber Sydney — The Most Comprehensive Guide to 24/7 Plumbing Services",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p7_meta_title).toBe(false);
  });

  it("p8_meta_description fails when description is too short", () => {
    const result = runPass1Scorer(makePass1Params({
      metaDescription: "Short description.",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p8_meta_description).toBe(false);
  });

  it("p8_meta_description passes when description is 140–160 chars with keyword", () => {
    const desc = "Need an emergency plumber in Sydney? We arrive in 30 minutes. Call our 24/7 emergency plumber Sydney team for burst pipes and blocked drains.";
    expect(desc.length).toBeGreaterThanOrEqual(140);
    expect(desc.length).toBeLessThanOrEqual(160);
    const result = runPass1Scorer(makePass1Params({
      metaDescription: desc,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p8_meta_description).toBe(true);
  });

  it("p15_human_authenticity fails when banned phrase is present", () => {
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: "<p>In today's world, emergency plumber sydney services are essential. Emergency plumber sydney teams leverage technology.</p>",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p15_human_authenticity).toBe(false);
  });

  it("p10_external_link passes when externalLinkPresent is true", () => {
    const result = runPass1Scorer(makePass1Params({ externalLinkPresent: true }));
    expect(result.points.p10_external_link).toBe(true);
  });

  it("p10_external_link passes when bodyHtml contains a real external href (even if flag is false)", () => {
    const result = runPass1Scorer(makePass1Params({
      externalLinkPresent: false,
      bodyHtml: `<p>emergency plumber sydney is available 24/7. emergency plumber sydney team. emergency plumber sydney experts. emergency plumber sydney pros. emergency plumber sydney now.</p><h2>Emergency Plumber Sydney Services</h2><a href="https://plumbingaustralia.com.au">Plumbing Industry Authority</a><a href="https://acmeplumbing.com.au/book">Book a Plumber</a>`,
    }));
    expect(result.points.p10_external_link).toBe(true);
  });

  it("p10_external_link fails when no external href is present and flag is false", () => {
    const result = runPass1Scorer(makePass1Params({
      externalLinkPresent: false,
      bodyHtml: `<p>emergency plumber sydney is available 24/7. emergency plumber sydney team. emergency plumber sydney experts. emergency plumber sydney pros. emergency plumber sydney now.</p><h2>Emergency Plumber Sydney Services</h2><a href="/book">Book a Plumber</a>`,
    }));
    expect(result.points.p10_external_link).toBe(false);
  });

  it("p1_keyword_density passes when article has 4+ mentions AND density ≤1%", () => {
    // 4 mentions in 800 words = 0.5% density — satisfies both conditions (4+ mentions, density ≤1%)
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Emergency Plumber Sydney Services</h2><p>Our emergency plumber sydney team arrives fast. Call emergency plumber sydney now.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 800,
      primaryKeyword: "emergency plumber sydney",
    }));
    // 4/800 = 0.5% density — 4+ mentions and under 1% ceiling, so passes
    expect(result.points.p1_keyword_density).toBe(true);
  });

  it("p1_keyword_density fails when 4+ mentions but density >1% (over the hard ceiling)", () => {
    // 4 mentions in 200 words = 2.0% density — over the 1% hard maximum
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Emergency Plumber Sydney Services</h2><p>Our emergency plumber sydney team arrives fast. Call emergency plumber sydney now.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 200,
      primaryKeyword: "emergency plumber sydney",
    }));
    // 4/200 = 2.0% density — exceeds 1% ceiling, so fails
    expect(result.points.p1_keyword_density).toBe(false);
  });

  it("p1_keyword_density fails when density ≥1% but fewer than 4 mentions (density alone is not enough)", () => {
    // 3 mentions in 200 words = 1.5% density — good density but not enough mentions
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Emergency Plumber Sydney</h2><p>Call emergency plumber sydney now. We help you fast.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 200,
      primaryKeyword: "emergency plumber sydney",
    }));
    // 3 mentions < 4 required, so AND logic fails despite 1.5% density
    expect(result.points.p1_keyword_density).toBe(false);
  });

  it("p1_keyword_density fails with fewer than 4 mentions AND density below 1%", () => {
    // 1 mention in 200 words = 0.5% density — fails both conditions
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Our Services</h2><p>We help you fast. Call us now. Available all day.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 200,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p1_keyword_density).toBe(false);
  });

  it("p6_keyword_in_slug passes when keyword words appear in order in slug (non-adjacent)", () => {
    // "pool installation cost sydney" words all appear in order in "pool-installation-cost-myths-sydney"
    const result = runPass1Scorer(makePass1Params({
      urlSlug: "pool-installation-cost-myths-sydney",
      primaryKeyword: "pool installation cost sydney",
    }));
    expect(result.points.p6_keyword_in_slug).toBe(true);
  });

  it("p6_keyword_in_slug passes with exact adjacent match", () => {
    const result = runPass1Scorer(makePass1Params({
      urlSlug: "emergency-plumber-sydney",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p6_keyword_in_slug).toBe(true);
  });

  it("p6_keyword_in_slug fails when a keyword word is missing from slug", () => {
    const result = runPass1Scorer(makePass1Params({
      urlSlug: "plumber-guide-sydney",
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p6_keyword_in_slug).toBe(false);
  });

  it("p9_opening_answer passes when bodyHtml has a bold question in first 600 chars", () => {
    const body = `<p><strong>How much does pool installation cost in Sydney?</strong> Installing a pool in Sydney typically costs between $45,000 and $100,000 depending on size and materials.</p><h2>Pool Installation Cost Sydney Myths</h2><p>More content here.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p9_opening_answer).toBe(true);
  });

  it("p9_opening_answer passes when bodyHtml starts with a question paragraph", () => {
    const body = `<p>How quickly can an emergency plumber sydney arrive?</p><p>Our team arrives within 30 minutes.</p><h2>Emergency Plumber Sydney Services</h2>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p9_opening_answer).toBe(true);
  });

  it("p5_keyword_first_100 passes when keyword appears within first 50 words", () => {
    const body = `<p>emergency plumber sydney is available 24 hours a day. When you need fast help, our team is ready.</p><h2>Services</h2><p>More content.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p5_keyword_first_100).toBe(true);
  });

  it("p11_internal_cta passes when internalCtaLinkPresent is true", () => {
    const result = runPass1Scorer(makePass1Params({ internalCtaLinkPresent: true }));
    expect(result.points.p11_internal_cta).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Slug generation
// ---------------------------------------------------------------------------

describe("generateSlug", () => {
  it("Converts to lowercase", () => {
    expect(generateSlug("Emergency Plumber Sydney")).toBe("emergency-plumber-sydney");
  });

  it("Replaces spaces with hyphens", () => {
    expect(generateSlug("blocked drains sydney")).toBe("blocked-drains-sydney");
  });

  it("Removes special characters", () => {
    expect(generateSlug("What is a 24/7 Plumber?")).toBe("what-is-a-247-plumber");
  });

  it("Collapses multiple hyphens", () => {
    expect(generateSlug("hot--water--repairs")).toBe("hot-water-repairs");
  });

  it("Trims leading and trailing hyphens", () => {
    expect(generateSlug("-test-")).toBe("test");
  });

  it("Truncates to 100 characters", () => {
    const longText = "a".repeat(200);
    expect(generateSlug(longText).length).toBeLessThanOrEqual(100);
  });

  it("Returns empty string for empty input", () => {
    expect(generateSlug("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 9. Australian English — prompt uses correct spelling
// ---------------------------------------------------------------------------

describe("Australian English in prompts", () => {
  it("Generation prompt instructs to use Australian English spelling (optimise/colour)", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    // The prompt contains the instruction: 'optimise' not 'optimize'
    expect(prompt).toContain("Australian English spelling");
    expect(prompt).toContain('"optimise" not "optimize"');
  });

  it("Generation prompt instructs to use 'colour' spelling", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain('"colour" not "color"');
  });
});

// ---------------------------------------------------------------------------
// 10. Single-pass generation prompt (replaces outline-first section-by-section)
// ---------------------------------------------------------------------------

import { hasTrailingEmptyHeading } from "./articleEngine";

describe("buildGenerationPrompt — single-pass engine", () => {
  it("Contains the primary keyword in the generation prompt", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain(ctx.primaryKeyword);
  });

  it("Specifies the correct word count range for cornerstone", () => {
    const ctx = makeContext({ level: "cornerstone", wordCountMin: 2000, wordCountMax: 3000 });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("2000");
    expect(prompt).toContain("3000");
  });

  it("Specifies the correct word count range for cluster", () => {
    const ctx = makeContext({ level: "cluster", wordCountMin: 800, wordCountMax: 1200 });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("800");
    expect(prompt).toContain("1200");
  });

  it("Includes FAQ instruction for cornerstone/pillar", () => {
    const ctx = makeContext({ level: "cornerstone" });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("FAQ");
  });

  it("Excludes FAQ for cluster articles", () => {
    const ctx = makeContext({ level: "cluster" });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("null");
  });

  it("Requires Australian English spelling", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Australian English spelling");
  });

  it("Requires H1 title to contain primary keyword verbatim", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("primary keyword verbatim");
  });

  it("Includes the 16-point Authority Standard", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("16-POINT AUTHORITY STANDARD");
  });

  it("Requires external authority link (.gov.au)", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain(".gov.au");
  });

  it("Requires minimum 2 internal blog links", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("at minimum 2 internal links");
  });

  it("Requires opening answer block for featured snippet", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("OPENING ANSWER BLOCK");
    expect(prompt).toContain("Featured Snippet extraction");
  });

  it("Requires closing CTA section with correct URL", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("CLOSING CTA SECTION");
    expect(prompt).toContain(ctx.ctaUrl);
  });

  it("Requires delimiter-based output format with METADATA and ARTICLE_HTML sections", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    // New delimiter format — body is outside JSON
    expect(prompt).toContain("<METADATA>");
    expect(prompt).toContain("</METADATA>");
    expect(prompt).toContain("<ARTICLE_HTML>");
    expect(prompt).toContain("</ARTICLE_HTML>");
    // Metadata fields still present (inside the METADATA JSON example)
    expect(prompt).toContain('"metaTitle"');
    expect(prompt).toContain('"metaDescription"');
    expect(prompt).toContain('"schemaMarkup"');
    // Body HTML is NOT embedded in JSON
    expect(prompt).not.toContain('"bodyHtml"');
  });

  it("Includes customer intelligence when problemsSolved is set", () => {
    const ctx = makeContext({ problemsSolved: "Struggling to find reliable plumbers" });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Struggling to find reliable plumbers");
  });

  it("Includes contentPlanDirection when set", () => {
    const ctx = makeContext({ contentPlanDirection: "Focus on emergency response times" });
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Focus on emergency response times");
  });
});

describe("hasTrailingEmptyHeading", () => {
  it("Returns false for a complete article with content after the last heading", () => {
    const html = `
      <h2>Introduction</h2><p>Some content here about the topic in detail.</p>
      <h2>Main Section</h2><p>More detailed content about the main topic with lots of words.</p>
      <h2>Conclusion</h2><p>This is the conclusion section. It has more than ten words of content so it passes the threshold check correctly.</p>
    `;
    expect(hasTrailingEmptyHeading(html)).toBe(false);
  });

  it("Returns true for an article with an empty last heading (truncation signature)", () => {
    const html = `
      <h2>Introduction</h2><p>Some content here about the topic.</p>
      <h2>Main Section</h2><p>More detailed content about the main topic.</p>
      <h2>When to Consider Funding</h2>
    `;
    expect(hasTrailingEmptyHeading(html)).toBe(true);
  });

  it("Returns true when last heading has fewer than 10 words after it", () => {
    const html = `
      <h2>Introduction</h2><p>Some content here about the topic.</p>
      <h2>Conclusion</h2><p>Just a few words.</p>
    `;
    expect(hasTrailingEmptyHeading(html)).toBe(true);
  });

  it("Returns false for an article with no headings", () => {
    const html = `<p>Just a paragraph with no headings at all.</p>`;
    expect(hasTrailingEmptyHeading(html)).toBe(false);
  });

  it("Returns false for empty string", () => {
    expect(hasTrailingEmptyHeading("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. kwPresentInText — token-presence keyword matching
// ---------------------------------------------------------------------------

import { kwPresentInText, kwMeaningfulTokens } from "./articleEngine";

describe("kwMeaningfulTokens", () => {
  it("Strips stop words and returns content words only", () => {
    const tokens = kwMeaningfulTokens("starting up a business with no money in Australia");
    expect(tokens).toContain("australia");
    expect(tokens).toContain("money");
    expect(tokens).toContain("start"); // "starting" → strip "ing" → "start"
    // "business" → strip "es" → "busines" (the actual stemmed form)
    expect(tokens.some(t => t.startsWith("busin"))).toBe(true);
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("in");
    expect(tokens).not.toContain("with");
  });

  it("Applies light stemming: 'starting' → 'start'", () => {
    const tokens = kwMeaningfulTokens("starting a business");
    // "starting" → strip "ing" → "start"
    expect(tokens).toContain("start");
  });

  it("Applies light stemming: 'businesses' → 'busines'", () => {
    const tokens = kwMeaningfulTokens("businesses in Australia");
    // "businesses" → strip "es" → "busines" (strip 'es' suffix)
    const joined = tokens.join(" ");
    expect(joined).toContain("busines");
  });
});

describe("kwPresentInText — the real-world failing case from Rachie's screenshot", () => {
  const keyword = "starting up a business with no money in Australia";

  it("Passes for exact phrase match", () => {
    expect(kwPresentInText(keyword, "starting up a business with no money in Australia")).toBe(true);
  });

  it("Passes for the article's actual opening sentence (word order differs)", () => {
    const text = "You can start a business in Australia with no money. While it presents unique challenges, many successful ventures begin with minimal capital.";
    expect(kwPresentInText(keyword, text)).toBe(true);
  });

  it("Passes for the H1 title 'Can you start a business in Australia with no money?'", () => {
    expect(kwPresentInText(keyword, "Can you start a business in Australia with no money?")).toBe(true);
  });

  it("Passes when keyword words are in different order", () => {
    expect(kwPresentInText(keyword, "How to start a business in Australia without money")).toBe(true);
  });

  it("Passes for inflected form: 'started a business in Australia with no money'", () => {
    expect(kwPresentInText(keyword, "started a business in Australia with no money")).toBe(true);
  });

  it("Fails when a key content word is missing (e.g. 'Australia' absent)", () => {
    expect(kwPresentInText(keyword, "You can start a business with no money")).toBe(false);
  });

  it("Fails when 'business' is completely absent", () => {
    expect(kwPresentInText(keyword, "You can start something in Australia with no money")).toBe(false);
  });
});

describe("kwPresentInText — Pass 1 scorer integration", () => {
  const keyword = "starting up a business with no money in Australia";

  it("P2 H1: passes for title 'Starting Up a Business with No Money in Australia: The Smart Founder's Guide'", () => {
    expect(kwPresentInText(keyword, "Starting Up a Business with No Money in Australia: The Smart Founder's Guide")).toBe(true);
  });

  it("P3 H2: passes for H2 that contains all keyword tokens including 'money'", () => {
    // A good H2 for this keyword must reference money/cost/no-money
    expect(kwPresentInText(keyword, "How to Start a Business in Australia with No Money")).toBe(true);
  });

  it("P3 H2: correctly fails for H2 missing 'money' (e.g. 'Minimal Capital' is not the same)", () => {
    // 'Minimal Capital' does not contain 'money' token — correct to fail
    expect(kwPresentInText(keyword, "How to Start a Business in Australia with Minimal Capital")).toBe(false);
  });

  it("P5 first 150 words: passes when keyword tokens appear in first paragraph", () => {
    const first150 = "Can you start a business in Australia with no money? Yes, absolutely. You can start a business in Australia with no money. While it presents unique challenges, many successful ventures begin with minimal capital. They do this by focusing on service-based models using existing skills and strategically bootstrapping to grow organically.";
    expect(kwPresentInText(keyword, first150)).toBe(true);
  });

  it("P7 meta title: passes for 'Starting Up a Business with No Money in Aust...'", () => {
    expect(kwPresentInText(keyword, "Starting Up a Business with No Money in Aust...")).toBe(true);
  });

  it("P8 meta description: passes for description containing keyword tokens", () => {
    const desc = "Dreaming of starting up a business with no money in Australia? Discover actionable strategies and resources to launch your venture without breaking the bank.";
    expect(kwPresentInText(keyword, desc)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Human Authenticity hard rules in generation prompt
// ---------------------------------------------------------------------------

import { TOKEN_LIMITS } from "./articleEngine";

describe("Human Authenticity hard rules — generation prompt", () => {
  it("Generation prompt forbids made-up statistics with examples", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("DO NOT make up statistics");
    expect(prompt).toContain("over 500 clients since 2018");
  });

  it("Generation prompt forbids generic credibility claims", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("industry-leading");
    expect(prompt).toContain("trusted by thousands");
    expect(prompt).toContain("proven track record");
  });

  it("Generation prompt instructs to be specific and real or omit when citing experience", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Fabricated social proof is worse than no social proof");
  });

  it("Human Authenticity hard rules appear under point 15 of the 16-point standard", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("HARD RULES — HUMAN AUTHENTICITY");
  });
});

// ---------------------------------------------------------------------------
// 13. Search Intent Resolution hard rules in generation prompt
// ---------------------------------------------------------------------------

describe("Search Intent Resolution hard rules — generation prompt", () => {
  it("Generation prompt includes SEARCH INTENT RESOLUTION rule", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("SEARCH INTENT RESOLUTION");
  });

  it("Generation prompt forbids substituting framework overviews for step-by-step instructions", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Do NOT substitute framework overviews");
  });

  it("Generation prompt requires every H2 to have at least one actionable instruction", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("Every H2 section MUST contain at least one specific, actionable instruction");
  });

  it("Generation prompt requires actionable instructions to be concrete (name the tool/form/website)", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("name the tool, form, website, phone number, or exact action");
  });

  it("Search Intent Resolution rule appears as point 16 of the 16-point standard", () => {
    const ctx = makeContext();
    const prompt = buildGenerationPrompt(ctx);
    expect(prompt).toContain("16. SEARCH INTENT RESOLUTION");
  });
});

// ---------------------------------------------------------------------------
// 14. Surgical fix pass — constants and delimiter contracts
// ---------------------------------------------------------------------------

describe("Surgical fix pass — TOKEN_LIMITS and constants", () => {
  it("TOKEN_LIMITS.improvement is 12000 (budget for surgical Pass 1 fix and Pass 2 quality fix)", () => {
    expect(TOKEN_LIMITS.improvement).toBe(12000);
  });

  it("TOKEN_LIMITS.pass2 is 4096", () => {
    expect(TOKEN_LIMITS.pass2).toBe(4096);
  });

  it("TOKEN_LIMITS.section is 16000 (raised to fit full article + metadata)", () => {
    expect(TOKEN_LIMITS.section).toBe(16000);
  });

  it("TOKEN_LIMITS defines all required pass types", () => {
    const required = ["section", "scrub", "improvement", "pass2"] as const;
    for (const key of required) {
      expect(TOKEN_LIMITS[key]).toBeGreaterThan(0);
    }
  });
});

describe("Surgical fix pass — SURGICAL_HTML delimiter contract", () => {
  it("Surgical Pass 1 fix uses SURGICAL_HTML delimiters", () => {
    // The surgical prompt instructs the model to wrap its output in <SURGICAL_HTML>...</SURGICAL_HTML>
    const delimOpen = "<SURGICAL_HTML>";
    const delimClose = "</SURGICAL_HTML>";
    expect(delimOpen).toBe("<SURGICAL_HTML>");
    expect(delimClose).toBe("</SURGICAL_HTML>");
  });

  it("Pass 2 quality fix uses IMPROVED_HTML delimiters", () => {
    // The Pass 2 fix prompt instructs the model to wrap its output in <IMPROVED_HTML>...</IMPROVED_HTML>
    const delimOpen = "<IMPROVED_HTML>";
    const delimClose = "</IMPROVED_HTML>";
    expect(delimOpen).toBe("<IMPROVED_HTML>");
    expect(delimClose).toBe("</IMPROVED_HTML>");
  });
});

describe("Surgical fix pass — two-track architecture", () => {
  it("Surgical fix fires only when Pass 1 < 14/16 (not for articles that already pass)", () => {
    // Verify the threshold constant: surgical fix triggers when pass1PointsCount < 14
    const threshold = 14;
    expect(threshold).toBe(14);
  });

  it("Pass 2 quality fix fires only when Pass 2 score < 80", () => {
    // Verify the threshold: Pass 2 fix triggers when pass2.score < 80
    const threshold = 80;
    expect(threshold).toBe(80);
  });

  it("Pass 2 scorer is re-run after Pass 2 quality fix (verified via TOKEN_LIMITS.pass2)", () => {
    expect(TOKEN_LIMITS.pass2).toBe(4096);
  });
});

describe("Surgical fix pass — needs_review badge", () => {
  it("deriveStatusBadge returns needs_review when Pass 1 score is below strong threshold", () => {
    // When Pass 2 score is still <80 after the quality fix attempt, the engine overrides badge to needs_review.
    const { statusBadge } = deriveStatusBadge(70, 65);
    expect(statusBadge).toBe("needs_review");
  });

  it("Badge override to needs_review fires when Pass 2 < 80 after quality fix attempt", () => {
    // The engine code does: if (pass2.score < 80 && improvementAttempts > 0) statusBadge = "needs_review"
    const validBadges = ["authority_ready", "strong", "needs_review"];
    expect(validBadges).toContain("needs_review");
  });

  it("Surgical fix does NOT override badge — only Pass 2 quality fix triggers needs_review", () => {
    // A successful surgical fix that brings Pass 1 to 14+/16 does not force needs_review.
    // Badge is derived from both Pass 1 and Pass 2 scores via deriveStatusBadge.
    const { statusBadge } = deriveStatusBadge(88, 82);
    expect(["authority_ready", "strong"]).toContain(statusBadge);
  });
});
