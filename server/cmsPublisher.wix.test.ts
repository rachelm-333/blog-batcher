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

// ---------------------------------------------------------------------------
// htmlToRicos: nested wrapper div/section flattening tests
// These tests catch the bug where content wrapped in <div> or <section> tags
// was silently dropped because the non-greedy regex couldn't match nested blocks.
// ---------------------------------------------------------------------------
describe("Wix htmlToRicos — nested wrapper flattening", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  function getNodes(calls: { url: string; body: unknown }[]): unknown[] {
    const createCall = calls.find(c => c.url.includes("/draft-posts") && !c.url.includes("/publish"));
    if (!createCall) return [];
    const body = createCall.body as Record<string, unknown>;
    const richContent = ((body.draftPost as Record<string, unknown>).richContent as Record<string, unknown>);
    return (richContent?.nodes as unknown[]) ?? [];
  }

  function allText(nodes: unknown[]): string {
    return nodes.map((n: unknown) => {
      const children = ((n as Record<string, unknown>).nodes as unknown[]) ?? [];
      return children.map((c: unknown) => {
        const td = (c as Record<string, unknown>).textData as Record<string, unknown> | undefined;
        return td?.text ?? "";
      }).join("");
    }).join(" ");
  }

  it("NESTED DIV: paragraphs inside a wrapper <div> are not dropped", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await publishToWix(CREDS, makeArticle({
      bodyHtml: `<div class="wrapper"><p>First paragraph.</p><p>Second paragraph.</p></div>`,
    }));
    const text = allText(getNodes(calls));
    expect(text).toContain("First paragraph");
    expect(text).toContain("Second paragraph");
  });

  it("NESTED SECTION: headings and paragraphs inside <section> are not dropped", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await publishToWix(CREDS, makeArticle({
      bodyHtml: `<section><h2>Section Heading</h2><p>Section body text.</p></section>`,
    }));
    const nodes = getNodes(calls);
    const headings = nodes.filter((n: unknown) => (n as Record<string, unknown>).type === "HEADING");
    const headingText = allText(headings);
    expect(headingText).toContain("Section Heading");
  });

  it("DEEPLY NESTED: content inside div > section > p is not dropped", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await publishToWix(CREDS, makeArticle({
      bodyHtml: `<div><section><p>Deep content here.</p></section></div>`,
    }));
    const text = allText(getNodes(calls));
    expect(text).toContain("Deep content here");
  });

  it("FAQ SECTION: FAQ block with h2 + multiple p tags inside a div is fully preserved", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await publishToWix(CREDS, makeArticle({
      bodyHtml: `<div class="faq"><h2>FAQ</h2><p>Q: What is this?</p><p>A: This is a test.</p><p>Q: Why does it matter?</p><p>A: Content must not be dropped.</p></div>`,
    }));
    const text = allText(getNodes(calls));
    expect(text).toContain("What is this");
    expect(text).toContain("This is a test");
    expect(text).toContain("Why does it matter");
    expect(text).toContain("Content must not be dropped");
  });
});

// ---------------------------------------------------------------------------
// FAQ faq-item div pattern — the exact format used in generated articles
// ---------------------------------------------------------------------------
describe("Wix htmlToRicos — faq-item div pattern (real article format)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

  function getNodes(calls: { url: string; body: unknown }[]): unknown[] {
    const createCall = calls.find(c => c.url.includes("/draft-posts") && !c.url.includes("/publish"));
    if (!createCall) return [];
    const body = createCall.body as Record<string, unknown>;
    const richContent = ((body.draftPost as Record<string, unknown>).richContent as Record<string, unknown>);
    return (richContent?.nodes as unknown[]) ?? [];
  }

  it("FAQ-ITEM DIV: each faq-item div is fully unwrapped and its Q&A paragraphs preserved", async () => {
    const { mockFetch, calls } = setupFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await publishToWix(CREDS, makeArticle({
      bodyHtml: [
        "<h2>Frequently Asked Questions</h2>",
        '<div class="faq-item"><hr><p><strong>Q: What is the first step?</strong></p><p>A: The first step is to plan carefully.</p></div>',
        '<div class="faq-item"><hr><p><strong>Q: How long does it take?</strong></p><p>A: It typically takes three to six months.</p></div>',
        '<div class="faq-item"><hr><p><strong>Q: Is it worth the effort?</strong></p><p>A: Yes, the results speak for themselves.</p></div>',
      ].join(""),
    }));
    const allNodeText = JSON.stringify(getNodes(calls));
    expect(allNodeText).toContain("What is the first step");
    expect(allNodeText).toContain("plan carefully");
    expect(allNodeText).toContain("How long does it take");
    expect(allNodeText).toContain("three to six months");
    expect(allNodeText).toContain("Is it worth the effort");
    expect(allNodeText).toContain("results speak for themselves");
  });
});
