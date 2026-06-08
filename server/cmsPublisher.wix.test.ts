/**
 * cmsPublisher.wix.test.ts
 *
 * Proves that publishToWix does NOT call the /publish endpoint when
 * scheduledPublishAt is in the future. This is the regression test for the
 * bug where scheduled Wix posts were publishing immediately.
 *
 * Strategy: mock globalThis.fetch so we can assert exactly which URLs were
 * called and how many times.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishToWix } from "./cmsPublisher";
import type { ArticlePayload, WixCredentials } from "./cmsPublisher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CREDS: WixCredentials = {
  apiKey: "test-api-key",
  siteId: "test-site-id",
  memberId: "test-member-id",
};

function makeArticle(overrides: Partial<ArticlePayload> = {}): ArticlePayload {
  return {
    title: "Test Article",
    bodyHtml: "<p>Hello world</p>",
    metaTitle: "Test Meta Title",
    metaDescription: "Test meta description for SEO.",
    focusKeyword: "test keyword",
    urlSlug: "test-article",
    schemaMarkup: null,
    imageUrl: null,
    imageAltText: null,
    scheduledPublishAt: null,
    level: "cluster",
    publishAsDraft: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

type FetchCall = { url: string; method: string; body: unknown };

function setupFetchMock(draftId = "draft-post-abc123") {
  const calls: FetchCall[] = [];

  const mockFetch = vi.fn(async (url: string, opts: RequestInit = {}) => {
    calls.push({
      url,
      method: (opts.method ?? "GET").toUpperCase(),
      body: opts.body ? JSON.parse(opts.body as string) : null,
    });

    // Media import endpoint
    if (url.includes("/media/files/import")) {
      return new Response(
        JSON.stringify({ file: { id: "media-id-123", operationStatus: "READY" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    // Media status polling
    if (url.includes("/media/files/") && !url.includes("import")) {
      return new Response(
        JSON.stringify({ file: { id: "media-id-123", operationStatus: "READY" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    // Draft post creation
    if (url.includes("/draft-posts") && !url.includes("/publish")) {
      return new Response(
        JSON.stringify({ draftPost: { id: draftId } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    // Publish endpoint
    if (url.includes("/publish")) {
      return new Response(
        JSON.stringify({ post: { id: "published-post-123", url: "https://example.wixsite.com/post" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

  return { mockFetch, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("publishToWix — scheduling behaviour", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("LIVE: calls /publish when scheduledPublishAt is null", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const article = makeArticle({ scheduledPublishAt: null });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0].method).toBe("POST");
  });

  it("LIVE: calls /publish when scheduledPublishAt is in the past", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const article = makeArticle({ scheduledPublishAt: pastDate });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    expect(publishCalls).toHaveLength(1);
  });

  it("SCHEDULED: does NOT call /publish when scheduledPublishAt is in the future", async () => {
    const { mockFetch, calls } = setupFetchMock("draft-scheduled-xyz");
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    const article = makeArticle({ scheduledPublishAt: futureDate });
    const result = await publishToWix(CREDS, article);

    // Must succeed
    expect(result.success).toBe(true);
    // Must return the draft ID (not a published post ID)
    expect(result.cmsPostId).toBe("draft-scheduled-xyz");
    // Must NOT have called the /publish endpoint at all
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    expect(publishCalls).toHaveLength(0);
  });

  it("SCHEDULED: returns empty cmsPostUrl when scheduledPublishAt is in the future", async () => {
    const { mockFetch } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week from now
    const article = makeArticle({ scheduledPublishAt: futureDate });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    expect(result.cmsPostUrl).toBe("");
  });

  it("DRAFT: does NOT call /publish when publishAsDraft is true", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const article = makeArticle({ publishAsDraft: true, scheduledPublishAt: null });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    expect(publishCalls).toHaveLength(0);
  });

  it("DRAFT+SCHEDULED: does NOT call /publish when both publishAsDraft and future scheduledPublishAt are set", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const article = makeArticle({ publishAsDraft: true, scheduledPublishAt: futureDate });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    expect(publishCalls).toHaveLength(0);
  });

  it("SCHEDULED: still creates the draft post even when not publishing immediately", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const article = makeArticle({ scheduledPublishAt: futureDate });
    await publishToWix(CREDS, article);

    // Draft creation must have been called
    const draftCalls = calls.filter(c => c.url.includes("/draft-posts") && !c.url.includes("/publish"));
    expect(draftCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("HEARTBEAT: calls /publish when scheduledPublishAt is in the past (simulates Heartbeat firing)", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // Heartbeat fires after the scheduled time — date is now in the past
    const pastScheduledDate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    const article = makeArticle({ scheduledPublishAt: pastScheduledDate });
    const result = await publishToWix(CREDS, article);

    expect(result.success).toBe(true);
    const publishCalls = calls.filter(c => c.url.includes("/publish"));
    // Heartbeat path: /publish MUST be called
    expect(publishCalls).toHaveLength(1);
  });

  it("PUBLISH BODY: memberId is included in the /publish request body", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const article = makeArticle({ scheduledPublishAt: null });
    await publishToWix(CREDS, article);

    const publishCall = calls.find(c => c.url.includes("/publish"));
    expect(publishCall).toBeDefined();
    // memberId MUST be in the body — Wix Blog v3 /publish requires it
    expect((publishCall!.body as any).memberId).toBe(CREDS.memberId);
  });
});
