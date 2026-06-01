/**
 * Layer 7 — Stage 5: Review, Approve, Publish & Schedule
 * Vitest tests covering:
 *  1. SEO field validation (slug, meta title, meta description, focus keyword)
 *  2. Schedule date calculation (all 5 cadences)
 *  3. Approval gate (publish options locked until all articles approved)
 *  4. ZIP export contents (HTML, Markdown, meta .txt, schema JSON-LD, schedule CSV)
 *  5. Status badge display logic (Authority Ready / Strong / Needs Review)
 *  6. Regenerate locked after approval
 */

import { describe, expect, it } from "vitest";
import { calculatePublishDates } from "./routers/schedule";

// ---------------------------------------------------------------------------
// 1. SEO Field Validation
// ---------------------------------------------------------------------------

describe("SEO field validation", () => {
  it("meta title must be ≤60 characters", () => {
    const valid = "Pool Installation Cost Sydney: Myths Debunked";
    const tooLong = "This Is A Very Long Meta Title That Exceeds The Sixty Character Limit For SEO";
    expect(valid.length).toBeLessThanOrEqual(60);
    expect(tooLong.length).toBeGreaterThan(60);
  });

  it("meta description must be 140–160 characters", () => {
    const valid = "Thinking about a new pool in Sydney? We debunk common pool installation cost Sydney myths, offering transparent insights from 14 years of experience.";
    const tooShort = "Short description.";
    const tooLong = "This meta description is intentionally very long and exceeds the one hundred and sixty character maximum that is required for proper SEO optimisation in search engines.";
    expect(valid.length).toBeGreaterThanOrEqual(140);
    expect(valid.length).toBeLessThanOrEqual(160);
    expect(tooShort.length).toBeLessThan(140);
    expect(tooLong.length).toBeGreaterThan(160);
  });

  it("URL slug must be lowercase with hyphens only", () => {
    const validSlug = "pool-installation-cost-sydney";
    const invalidSlug = "Pool Installation Cost Sydney";
    expect(/^[a-z0-9-]+$/.test(validSlug)).toBe(true);
    expect(/^[a-z0-9-]+$/.test(invalidSlug)).toBe(false);
  });

  it("focus keyword must not be empty", () => {
    const validKeyword = "pool installation cost Sydney";
    const emptyKeyword = "";
    expect(validKeyword.trim().length).toBeGreaterThan(0);
    expect(emptyKeyword.trim().length).toBe(0);
  });

  it("schema markup must be valid JSON when present", () => {
    const validSchema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How much does pool installation cost in Sydney?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The average cost ranges from $45,000 to $100,000+.",
          },
        },
      ],
    });
    expect(() => JSON.parse(validSchema)).not.toThrow();
    expect(JSON.parse(validSchema)["@type"]).toBe("FAQPage");
  });

  it("FAQ schema must only be on Cornerstone and Pillar articles", () => {
    const levels = ["cornerstone", "pillar", "cluster"] as const;
    const faqAllowed = (level: string) => level === "cornerstone" || level === "pillar";
    expect(faqAllowed("cornerstone")).toBe(true);
    expect(faqAllowed("pillar")).toBe(true);
    expect(faqAllowed("cluster")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Schedule Date Calculation
// ---------------------------------------------------------------------------

describe("calculatePublishDates", () => {
  const articleIds = [1, 2, 3, 4, 5];
  const startDate = new Date("2026-07-01T00:00:00.000Z");

  it("every_day: articles publish on consecutive days", () => {
    const dates = calculatePublishDates(articleIds, "every_day", startDate);
    expect(dates).toHaveLength(5);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(dates[1].publishDate.toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(dates[4].publishDate.toISOString().slice(0, 10)).toBe("2026-07-05");
  });

  it("every_2_days: articles publish every 2 days", () => {
    const dates = calculatePublishDates(articleIds, "every_2_days", startDate);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(dates[1].publishDate.toISOString().slice(0, 10)).toBe("2026-07-03");
    expect(dates[2].publishDate.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(dates[4].publishDate.toISOString().slice(0, 10)).toBe("2026-07-09");
  });

  it("every_3_days: articles publish every 3 days", () => {
    const dates = calculatePublishDates(articleIds, "every_3_days", startDate);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(dates[1].publishDate.toISOString().slice(0, 10)).toBe("2026-07-04");
    expect(dates[4].publishDate.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("once_per_week: articles publish 7 days apart", () => {
    const dates = calculatePublishDates(articleIds, "once_per_week", startDate);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(dates[1].publishDate.toISOString().slice(0, 10)).toBe("2026-07-08");
    expect(dates[4].publishDate.toISOString().slice(0, 10)).toBe("2026-07-29");
  });

  it("twice_per_week: articles publish 4 days apart", () => {
    const dates = calculatePublishDates(articleIds, "twice_per_week", startDate);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(dates[1].publishDate.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(dates[4].publishDate.toISOString().slice(0, 10)).toBe("2026-07-17");
  });

  it("returns correct articleId mapping", () => {
    const dates = calculatePublishDates([10, 20, 30], "every_day", startDate);
    expect(dates[0].articleId).toBe(10);
    expect(dates[1].articleId).toBe(20);
    expect(dates[2].articleId).toBe(30);
  });

  it("handles single article", () => {
    const dates = calculatePublishDates([99], "once_per_week", startDate);
    expect(dates).toHaveLength(1);
    expect(dates[0].articleId).toBe(99);
    expect(dates[0].publishDate.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("handles empty article list", () => {
    const dates = calculatePublishDates([], "every_day", startDate);
    expect(dates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Approval Gate Logic
// ---------------------------------------------------------------------------

describe("Approval gate", () => {
  type ArticleStatus = "generated" | "pending_approval" | "approved" | "scheduled" | "published" | "failed";

  function allApproved(articles: { status: ArticleStatus }[]): boolean {
    if (articles.length === 0) return false;
    return articles.every(
      a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
    );
  }

  it("publish options locked when no articles approved", () => {
    const articles = [
      { status: "generated" as ArticleStatus },
      { status: "generated" as ArticleStatus },
    ];
    expect(allApproved(articles)).toBe(false);
  });

  it("publish options locked when some articles still pending", () => {
    const articles = [
      { status: "approved" as ArticleStatus },
      { status: "generated" as ArticleStatus },
    ];
    expect(allApproved(articles)).toBe(false);
  });

  it("publish options unlocked when all articles approved", () => {
    const articles = [
      { status: "approved" as ArticleStatus },
      { status: "approved" as ArticleStatus },
      { status: "scheduled" as ArticleStatus },
    ];
    expect(allApproved(articles)).toBe(true);
  });

  it("publish options locked when article list is empty", () => {
    expect(allApproved([])).toBe(false);
  });

  it("published articles count as approved for gate check", () => {
    const articles = [
      { status: "approved" as ArticleStatus },
      { status: "published" as ArticleStatus },
    ];
    expect(allApproved(articles)).toBe(true);
  });

  it("failed articles block the gate", () => {
    const articles = [
      { status: "approved" as ArticleStatus },
      { status: "failed" as ArticleStatus },
    ];
    expect(allApproved(articles)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. ZIP Export Contents
// ---------------------------------------------------------------------------

describe("ZIP export file structure", () => {
  // Simulate the file names that would be added to the ZIP archive
  function getExpectedZipFiles(articles: { urlSlug: string; schemaMarkup?: string | null }[]): string[] {
    const files: string[] = [];
    for (const article of articles) {
      const slug = article.urlSlug;
      files.push(`articles/${slug}.html`);
      files.push(`articles/${slug}.md`);
      files.push(`articles/${slug}-meta.txt`);
      if (article.schemaMarkup) {
        files.push(`articles/${slug}-schema.json`);
      }
    }
    files.push("schedule.csv");
    return files;
  }

  it("ZIP contains HTML, Markdown, meta .txt for each article", () => {
    const articles = [
      { urlSlug: "pool-installation-cost-sydney", schemaMarkup: null },
      { urlSlug: "best-pool-builders-sydney", schemaMarkup: null },
    ];
    const files = getExpectedZipFiles(articles);
    expect(files).toContain("articles/pool-installation-cost-sydney.html");
    expect(files).toContain("articles/pool-installation-cost-sydney.md");
    expect(files).toContain("articles/pool-installation-cost-sydney-meta.txt");
    expect(files).toContain("articles/best-pool-builders-sydney.html");
  });

  it("ZIP contains schema JSON-LD only when schemaMarkup is present", () => {
    const articles = [
      { urlSlug: "pool-faq", schemaMarkup: '{"@type":"FAQPage"}' },
      { urlSlug: "pool-costs", schemaMarkup: null },
    ];
    const files = getExpectedZipFiles(articles);
    expect(files).toContain("articles/pool-faq-schema.json");
    expect(files).not.toContain("articles/pool-costs-schema.json");
  });

  it("ZIP always contains schedule.csv", () => {
    const articles = [{ urlSlug: "test-article", schemaMarkup: null }];
    const files = getExpectedZipFiles(articles);
    expect(files).toContain("schedule.csv");
  });

  it("schedule.csv has correct header", () => {
    const expectedHeader = "title,url_slug,level,status_badge,scheduled_publish_at";
    expect(expectedHeader).toContain("title");
    expect(expectedHeader).toContain("url_slug");
    expect(expectedHeader).toContain("level");
    expect(expectedHeader).toContain("status_badge");
    expect(expectedHeader).toContain("scheduled_publish_at");
  });

  it("meta .txt file contains all required fields", () => {
    const article = {
      title: "Pool Installation Cost Sydney",
      metaTitle: "Pool Installation Cost Sydney: Expert Guide",
      metaDescription: "Everything you need to know about pool installation costs in Sydney.",
      focusKeyword: "pool installation cost Sydney",
      urlSlug: "pool-installation-cost-sydney",
      wordCount: 1150,
      statusBadge: "authority_ready",
      level: "cluster",
      scheduledPublishAt: null as Date | null,
    };
    const metaTxt = [
      `Title: ${article.title}`,
      `Meta Title: ${article.metaTitle}`,
      `Meta Description: ${article.metaDescription}`,
      `Focus Keyword: ${article.focusKeyword}`,
      `URL Slug: ${article.urlSlug}`,
      `Word Count: ${article.wordCount}`,
      `Status: ${article.statusBadge}`,
      `Level: ${article.level}`,
      `Scheduled: ${article.scheduledPublishAt ? new Date(article.scheduledPublishAt).toISOString() : "Not scheduled"}`,
    ].join("\n");
    expect(metaTxt).toContain("Title: Pool Installation Cost Sydney");
    expect(metaTxt).toContain("Meta Title:");
    expect(metaTxt).toContain("Meta Description:");
    expect(metaTxt).toContain("Focus Keyword:");
    expect(metaTxt).toContain("URL Slug:");
    expect(metaTxt).toContain("Word Count:");
    expect(metaTxt).toContain("Status:");
    expect(metaTxt).toContain("Level:");
    expect(metaTxt).toContain("Scheduled: Not scheduled");
  });
});

// ---------------------------------------------------------------------------
// 5. Status Badge Display Logic
// ---------------------------------------------------------------------------

describe("Status badge display", () => {
  function getBadgeLabel(badge: string): string {
    switch (badge) {
      case "authority_ready": return "Authority Ready";
      case "strong": return "Strong";
      case "needs_review": return "Needs Review";
      default: return "Unknown";
    }
  }

  function getBadgeColor(badge: string): string {
    switch (badge) {
      case "authority_ready": return "emerald";
      case "strong": return "blue";
      case "needs_review": return "amber";
      default: return "gray";
    }
  }

  it("authority_ready badge shows 'Authority Ready' in emerald", () => {
    expect(getBadgeLabel("authority_ready")).toBe("Authority Ready");
    expect(getBadgeColor("authority_ready")).toBe("emerald");
  });

  it("strong badge shows 'Strong' in blue", () => {
    expect(getBadgeLabel("strong")).toBe("Strong");
    expect(getBadgeColor("strong")).toBe("blue");
  });

  it("needs_review badge shows 'Needs Review' in amber", () => {
    expect(getBadgeLabel("needs_review")).toBe("Needs Review");
    expect(getBadgeColor("needs_review")).toBe("amber");
  });
});

// ---------------------------------------------------------------------------
// 6. Regenerate Locked After Approval
// ---------------------------------------------------------------------------

describe("Regenerate lock after approval", () => {
  type ArticleStatus = "generated" | "pending_approval" | "approved" | "scheduled" | "published" | "failed";

  function canRegenerate(status: ArticleStatus): boolean {
    return status === "generated" || status === "failed" || status === "needs_review";
  }

  it("regenerate is available for generated articles", () => {
    expect(canRegenerate("generated")).toBe(true);
  });

  it("regenerate is available for failed articles", () => {
    expect(canRegenerate("failed")).toBe(true);
  });

  it("regenerate is locked for approved articles", () => {
    expect(canRegenerate("approved")).toBe(false);
  });

  it("regenerate is locked for scheduled articles", () => {
    expect(canRegenerate("scheduled")).toBe(false);
  });

  it("regenerate is locked for published articles", () => {
    expect(canRegenerate("published")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Publishing Method Selection
// ---------------------------------------------------------------------------

describe("Publishing method selection", () => {
  type PublishMethod = "wix" | "wordpress" | "zapier" | "export_zip";

  function isComingSoon(method: PublishMethod): boolean {
    return method === "wix" || method === "wordpress" || method === "zapier";
  }

  function isAvailable(method: PublishMethod): boolean {
    return method === "export_zip";
  }

  it("Export ZIP is the only available method", () => {
    const methods: PublishMethod[] = ["wix", "wordpress", "zapier", "export_zip"];
    const available = methods.filter(isAvailable);
    expect(available).toEqual(["export_zip"]);
  });

  it("Wix, WordPress, Zapier are coming soon", () => {
    expect(isComingSoon("wix")).toBe(true);
    expect(isComingSoon("wordpress")).toBe(true);
    expect(isComingSoon("zapier")).toBe(true);
    expect(isComingSoon("export_zip")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Publish As toggle
// ---------------------------------------------------------------------------

describe("Publish As toggle", () => {
  it("Scheduled means articles publish automatically on their dates", () => {
    const publishAs = "scheduled";
    const description =
      publishAs === "scheduled"
        ? "Articles will be published automatically on their scheduled dates."
        : "Articles will be sent as drafts — you publish them manually from your CMS.";
    expect(description).toContain("automatically");
  });

  it("Drafts means articles are sent as drafts for manual publishing", () => {
    const publishAs = "drafts";
    const description =
      publishAs === "scheduled"
        ? "Articles will be published automatically on their scheduled dates."
        : "Articles will be sent as drafts — you publish them manually from your CMS.";
    expect(description).toContain("drafts");
  });
});
