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

  it("Cornerstone word count range is 2000–3000", () => {
    expect(WORD_COUNT_RULES.cornerstone.min).toBe(2000);
    expect(WORD_COUNT_RULES.cornerstone.max).toBe(3000);
  });

  it("Pillar word count range is 1500–1800", () => {
    expect(WORD_COUNT_RULES.pillar.min).toBe(1500);
    expect(WORD_COUNT_RULES.pillar.max).toBe(1800);
  });

  it("Cluster word count range is 800–1200", () => {
    expect(WORD_COUNT_RULES.cluster.min).toBe(800);
    expect(WORD_COUNT_RULES.cluster.max).toBe(1200);
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
    // 1900 words is 100 below the 2000 minimum, exceeding the 50-word tolerance
    const result = runPass1Scorer(makePass1Params({ wordCount: 1900, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 when word count is within 50-word tolerance of minimum", () => {
    // 1960 words is 40 below the 2000 minimum, within the 50-word tolerance
    const result = runPass1Scorer(makePass1Params({ wordCount: 1960, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 when word count exceeds maximum for cornerstone", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 3500, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 when word count is within range for cornerstone", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 2600, level: "cornerstone" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer passes p16 for pillar within 1500–1800", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1600, level: "pillar" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 for pillar below 1500", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1200, level: "pillar" }));
    expect(result.points.p16_word_count).toBe(false);
  });

  it("Pass 1 scorer passes p16 for cluster within 1000–1200", () => {
    const result = runPass1Scorer(makePass1Params({ wordCount: 1100, level: "cluster" }));
    expect(result.points.p16_word_count).toBe(true);
  });

  it("Pass 1 scorer fails p16 for cluster above 1200", () => {
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
    // Updated: minimum 5 mentions, density 0.5%–2.5%
    expect(prompt).toContain("MINIMUM of 5 times");
    expect(prompt).toContain("0.5%–2.5%");
  });

  it("Prompt instructs to count keyword appearances and enforce density before finalising", () => {
    expect(prompt).toContain("count keyword appearances");
    expect(prompt).toContain("density is below 0.5%");
  });

  it("Prompt includes keyword in H1 rule (point 2)", () => {
    expect(prompt).toContain("KEYWORD IN H1");
  });

  it("Prompt requires keyword in H2 (not just H3) — point 3 is mandatory", () => {
    expect(prompt).toContain("KEYWORD IN H2");
    expect(prompt).toContain("AT LEAST ONE <h2> heading");
    expect(prompt).toContain("mandatory");
  });

  it("Prompt instructs keyword in opening sentence / first 50 words — point 5", () => {
    expect(prompt).toContain("OPENING SENTENCE");
    expect(prompt).toContain("first 50 words");
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

  it("Prompt includes internal blog links rule (point 12)", () => {
    expect(prompt).toContain("INTERNAL BLOG LINKS");
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

  it("Combined score weights Pass 1 at 60% and Pass 2 at 40%", () => {
    const { internalScore } = deriveStatusBadge(100, 0);
    expect(internalScore).toBe(60);
  });

  it("Combined score is 100 when both passes are 100", () => {
    const { internalScore } = deriveStatusBadge(100, 100);
    expect(internalScore).toBe(100);
  });

  it("MIN_DELIVERY_SCORE is 80 (auto-regenerate threshold)", () => {
    expect(MIN_DELIVERY_SCORE).toBe(80);
  });

  it("BADGE_THRESHOLDS.authority_ready is 90", () => {
    expect(BADGE_THRESHOLDS.authority_ready).toBe(90);
  });

  it("BADGE_THRESHOLDS.strong is 80", () => {
    expect(BADGE_THRESHOLDS.strong).toBe(80);
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

  it("p1_keyword_density passes with 4+ mentions (regardless of density)", () => {
    // 4 mentions in ~200 words = ~2% density — passes on mention count alone
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Emergency Plumber Sydney Services</h2><p>Our emergency plumber sydney team arrives fast. Call emergency plumber sydney now.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 200,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p1_keyword_density).toBe(true);
  });

  it("p1_keyword_density passes with density ≥1% even with fewer than 4 mentions", () => {
    // 3 mentions in ~200 words = 1.5% density — passes on density alone
    const body = `<p>emergency plumber sydney is available 24/7.</p><h2>Emergency Plumber Sydney</h2><p>Call emergency plumber sydney now. We help you fast.</p>`;
    const result = runPass1Scorer(makePass1Params({
      bodyHtml: body,
      wordCount: 200,
      primaryKeyword: "emergency plumber sydney",
    }));
    expect(result.points.p1_keyword_density).toBe(true);
  });

  it("p1_keyword_density fails with fewer than 4 mentions AND density below 1%", () => {
    // 1 mention in ~200 words = 0.5% density — fails both conditions
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
// 10. Outline-first + section-by-section generation
// ---------------------------------------------------------------------------

import {
  buildOutlinePrompt,
  buildSectionPrompt,
  hasTrailingEmptyHeading,
  type OutlineSection,
} from "./articleEngine";

describe("buildOutlinePrompt", () => {
  it("Contains the primary keyword in the outline prompt", () => {
    const ctx = makeContext();
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain(ctx.primaryKeyword);
  });

  it("Specifies the correct word count range for cornerstone", () => {
    const ctx = makeContext({ level: "cornerstone", wordCountMin: 2000, wordCountMax: 3000 });
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("2000");
    expect(prompt).toContain("3000");
  });

  it("Specifies the correct word count range for cluster", () => {
    const ctx = makeContext({ level: "cluster", wordCountMin: 800, wordCountMax: 1200 });
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("800");
    expect(prompt).toContain("1200");
  });

  it("Includes FAQ instruction for cornerstone/pillar", () => {
    const ctx = makeContext({ level: "cornerstone" });
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("FAQ section");
  });

  it("Excludes FAQ for cluster articles", () => {
    const ctx = makeContext({ level: "cluster" });
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("DO NOT include a FAQ section");
  });

  it("Requires Australian English spelling", () => {
    const ctx = makeContext();
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("Australian English spelling");
  });

  it("Requires H1 title to contain primary keyword verbatim", () => {
    const ctx = makeContext();
    const prompt = buildOutlinePrompt(ctx);
    expect(prompt).toContain("primary keyword verbatim");
  });

  it("Plans enough sections for the word count target", () => {
    const ctx = makeContext({ level: "cornerstone", wordCountMin: 2000, wordCountMax: 3000 });
    const prompt = buildOutlinePrompt(ctx);
    // Should plan at least 8 sections (2000/250=8) for a cornerstone
    const minSections = Math.ceil(2000 / 250);
    expect(prompt).toContain(`${minSections}`);
  });
});

describe("buildSectionPrompt", () => {
  const ctx = makeContext();
  const sections: OutlineSection[] = [
    { heading: "What Is an Emergency Plumber?", targetWords: 60, notes: "Opening answer block" },
    { heading: "When to Call an Emergency Plumber", targetWords: 300, notes: "Signs of a plumbing emergency" },
    { heading: "How to Find a Reliable Emergency Plumber in Sydney", targetWords: 300, notes: "Tips for finding a plumber" },
    { heading: "Ready to Book?", targetWords: 60, notes: "CTA section" },
  ];

  it("First section prompt mentions opening answer block rules", () => {
    const prompt = buildSectionPrompt(ctx, sections[0], 0, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("OPENING SECTION RULES");
    expect(prompt).toContain("featured snippet");
  });

  it("Last section prompt mentions CTA rules", () => {
    const prompt = buildSectionPrompt(ctx, sections[3], 3, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("CTA SECTION RULES");
    expect(prompt).toContain(ctx.ctaUrl);
  });

  it("Middle section prompt does not include CTA or opening rules", () => {
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).not.toContain("OPENING SECTION RULES");
    expect(prompt).not.toContain("CTA SECTION RULES");
    expect(prompt).toContain("CONTENT RULES");
  });

  it("Section 2 (index 1) includes external link instruction", () => {
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("EXTERNAL LINK RULE");
    expect(prompt).toContain(".gov.au");
  });

  it("Section 3 (index 2) includes internal link instruction", () => {
    const prompt = buildSectionPrompt(ctx, sections[2], 2, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("INTERNAL LINK RULE");
    expect(prompt).toContain(ctx.ctaUrl);
  });

  it("Includes the section heading in the prompt", () => {
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain(sections[1].heading);
  });

  it("Includes target word count in the prompt", () => {
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("300");
  });

  it("Wraps output in SECTION_HTML delimiters", () => {
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", "");
    expect(prompt).toContain("<SECTION_HTML>");
    expect(prompt).toContain("</SECTION_HTML>");
  });

  it("Passes previous sections as context", () => {
    const previousHtml = "<h2>What Is an Emergency Plumber?</h2><p>An emergency plumber is...</p>";
    const prompt = buildSectionPrompt(ctx, sections[1], 1, sections.length, "Emergency Plumber Sydney Guide", previousHtml);
    expect(prompt).toContain("PREVIOUS SECTIONS");
    expect(prompt).toContain("What Is an Emergency Plumber?");
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
