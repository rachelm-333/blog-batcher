/**
 * server/support.layer11.test.ts
 *
 * Layer 11 — Support Centre vitest tests.
 *
 * Tests:
 *  1. searchHelpArticles — finds results for known terms
 *  2. searchHelpArticles — returns empty array for unknown terms
 *  3. searchHelpArticles — case-insensitive matching
 *  4. searchHelpArticles — tag matching
 *  5. getArticleSnippet — returns snippet with context around match
 *  6. support.search tRPC — returns results for a known query
 *  7. support.search tRPC — returns empty array for unknown query
 *  8. support.getArticle — returns article for valid slug
 *  9. support.getArticle — returns null for unknown slug
 * 10. support.getTopics — returns all 8 topics with articles
 * 11. support.submitContactForm — validates required fields (name missing)
 * 12. support.submitContactForm — validates email format
 * 13. support.submitContactForm — validates message minimum length
 * 14. HELP_ARTICLES — all articles have unique slugs
 * 15. HELP_ARTICLES — all articles belong to a valid topicId
 */

import { describe, it, expect, vi } from "vitest";
import { searchHelpArticles, getArticleSnippet, HELP_ARTICLES, HELP_TOPICS } from "../shared/helpContent";
import { appRouter } from "./routers";

// ---------------------------------------------------------------------------
// Mock Resend so contact form tests don't hit the network
// ---------------------------------------------------------------------------
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "mock-id" }, error: null }),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helper: create a caller without auth (publicProcedure)
// ---------------------------------------------------------------------------
const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });

// ---------------------------------------------------------------------------
// 1–5: searchHelpArticles and getArticleSnippet (pure functions)
// ---------------------------------------------------------------------------
describe("searchHelpArticles", () => {
  it("returns results for a known term", () => {
    const results = searchHelpArticles("keyword");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty array for a term that does not exist", () => {
    const results = searchHelpArticles("xyzzy_nonexistent_term_12345");
    expect(results).toEqual([]);
  });

  it("is case-insensitive", () => {
    const lower = searchHelpArticles("wordpress");
    const upper = searchHelpArticles("WORDPRESS");
    expect(lower.length).toEqual(upper.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  it("matches on tags", () => {
    // "pipeline" is a tag on the first article
    const results = searchHelpArticles("pipeline");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(a => a.tags.includes("pipeline"))).toBe(true);
  });
});

describe("getArticleSnippet", () => {
  it("returns a non-empty snippet for a matching article", () => {
    const article = HELP_ARTICLES.find(a => a.slug === "how-blog-batcher-works");
    expect(article).toBeDefined();
    const snippet = getArticleSnippet(article!, "pipeline");
    expect(typeof snippet).toBe("string");
    expect(snippet.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6–10: tRPC procedures
// ---------------------------------------------------------------------------
describe("support.search", () => {
  it("returns results for a known query", async () => {
    const results = await caller.support.search({ query: "keyword research" });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("slug");
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("snippet");
  });

  it("returns empty array for an unknown query", async () => {
    const results = await caller.support.search({ query: "xyzzy_nonexistent_term_12345" });
    expect(results).toEqual([]);
  });
});

describe("support.getArticle", () => {
  it("returns the article for a valid slug", async () => {
    const article = await caller.support.getArticle({ slug: "how-blog-batcher-works" });
    expect(article).not.toBeNull();
    expect(article?.title).toBe("How Blog Batcher works — the 5-stage pipeline");
    expect(article?.topic).not.toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    const article = await caller.support.getArticle({ slug: "this-slug-does-not-exist" });
    expect(article).toBeNull();
  });
});

describe("support.getTopics", () => {
  it("returns all 8 topics with their articles", async () => {
    const topics = await caller.support.getTopics();
    expect(topics.length).toBe(8);
    for (const topic of topics) {
      expect(topic).toHaveProperty("id");
      expect(topic).toHaveProperty("label");
      expect(topic).toHaveProperty("articles");
      expect(Array.isArray(topic.articles)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11–13: submitContactForm validation
// ---------------------------------------------------------------------------
describe("support.submitContactForm validation", () => {
  it("throws UNPROCESSABLE_CONTENT when name is missing", async () => {
    await expect(
      caller.support.submitContactForm({
        name: "",
        email: "test@example.com",
        subject: "Test",
        message: "This is a test message that is long enough.",
      })
    ).rejects.toThrow();
  });

  it("throws when email is invalid", async () => {
    await expect(
      caller.support.submitContactForm({
        name: "Test User",
        email: "not-an-email",
        subject: "Test",
        message: "This is a test message that is long enough.",
      })
    ).rejects.toThrow();
  });

  it("throws when message is too short", async () => {
    await expect(
      caller.support.submitContactForm({
        name: "Test User",
        email: "test@example.com",
        subject: "Test",
        message: "Short",
      })
    ).rejects.toThrow();
  });

  it("succeeds with valid input (mocked Resend)", async () => {
    const result = await caller.support.submitContactForm({
      name: "Test User",
      email: "test@example.com",
      subject: "Test support request",
      message: "This is a valid test message with enough characters to pass validation.",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14–15: Help content integrity checks
// ---------------------------------------------------------------------------
describe("HELP_ARTICLES integrity", () => {
  it("all articles have unique slugs", () => {
    const slugs = HELP_ARTICLES.map(a => a.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("all articles belong to a valid topicId", () => {
    const validTopicIds = new Set(HELP_TOPICS.map(t => t.id));
    for (const article of HELP_ARTICLES) {
      expect(validTopicIds.has(article.topicId)).toBe(true);
    }
  });
});
