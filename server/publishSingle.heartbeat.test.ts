/**
 * publishSingle.heartbeat.test.ts
 *
 * Proves that the publishSingle tRPC procedure creates a Heartbeat job
 * when scheduledAt is in the future. This is the regression test for the
 * bug where scheduled articles were left as Wix drafts forever because
 * no Heartbeat job was created to fire the publish call at the right time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createArticleHeartbeat } from "./schedulerService";

// ---------------------------------------------------------------------------
// Mock all external dependencies
// ---------------------------------------------------------------------------

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./schedulerService", async (importOriginal) => {
  const real = await importOriginal<typeof import("./schedulerService")>();
  return {
    ...real,
    createArticleHeartbeat: vi.fn().mockResolvedValue("heartbeat-task-uid-999"),
    cancelArticleHeartbeat: vi.fn().mockResolvedValue(undefined),
    rescheduleArticleHeartbeat: vi.fn().mockResolvedValue(undefined),
    executeScheduledPublish: vi.fn().mockResolvedValue({ success: true }),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./cmsPublisher", () => ({
  publishToWix: vi.fn().mockResolvedValue({ success: true, cmsPostId: "wix-draft-id-abc", cmsPostUrl: "" }),
  publishToWordPress: vi.fn().mockResolvedValue({ success: true, cmsPostId: "wp-post-123", cmsPostUrl: "https://example.com/post" }),
  publishToZapier: vi.fn().mockResolvedValue({ success: true, cmsPostId: null, cmsPostUrl: null }),
  decryptCredentials: vi.fn().mockReturnValue({
    apiKey: "test-api-key",
    siteId: "test-site-id",
    memberId: "test-member-id",
  }),
  encryptCredentials: vi.fn().mockReturnValue("encrypted"),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "ok" } }] }),
}));

vi.mock("./articleEngine", async (importOriginal) => {
  const real = await importOriginal<typeof import("./articleEngine")>();
  return { ...real };
});

import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDb(overrides: Record<string, unknown> = {}) {
  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateObj = { set: updateSet };
  updateSet.mockReturnValue({ where: updateWhere });

  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    leftJoin: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnValue(updateObj),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("publishSingle — Heartbeat job creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a Heartbeat job when scheduledAt is in the future (Wix)", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
    const futureMs = futureDate.getTime();

    // Build a mock DB that returns the article and integration data
    const mockDb = makeMockDb();
    const selectLimit = vi.fn();

    // We need to chain: select().from().leftJoin().leftJoin().where().limit()
    // and also: select().from().where().limit()
    // Use a counter to return different data on successive calls
    let callCount = 0;
    const mockWhere = vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: article lookup
          return [{
            id: 42,
            businessId: 7,
            status: "approved",
            title: "Test Article",
            bodyHtml: "<p>Body</p>",
            metaTitle: "Meta Title",
            metaDescription: "Meta description",
            focusKeyword: "test keyword",
            urlSlug: "test-article",
            schemaMarkup: null,
            scheduledPublishAt: null,
            level: "cluster",
            imageUrl: null,
            altText: null,
          }];
        }
        if (callCount === 2) {
          // Second call: business ownership check
          return [{ id: 7, userId: 1 }];
        }
        if (callCount === 3) {
          // Third call: integration credentials
          return [{ credentialsEncrypted: "encrypted-creds" }];
        }
        return [];
      }),
    }));

    const mockLeftJoin = vi.fn().mockReturnThis();
    const mockFrom = vi.fn().mockReturnValue({
      leftJoin: mockLeftJoin,
      where: mockWhere,
    });
    mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const db = {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      update: mockUpdate,
    };

    vi.mocked(getDb).mockResolvedValue(db as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    // Import the router procedure directly
    const { articlesRouter } = await import("./routers/articles");

    // Build a minimal tRPC caller context
    const ctx = {
      user: { id: 1, email: "test@test.com", name: "Test", role: "user" as const },
      req: {
        headers: {
          cookie: "app_session_id=test-session-token-abc",
        },
      },
    };

    // Call the procedure
    const caller = articlesRouter.createCaller(ctx as any);
    const result = await caller.publishSingle({
      articleId: 42,
      platform: "wix",
      publishAs: "live",
      scheduledAt: futureMs,
    });

    // The procedure should succeed and return "scheduled"
    expect(result.status).toBe("scheduled");

    // createArticleHeartbeat MUST have been called with the article ID and future date
    expect(createArticleHeartbeat).toHaveBeenCalledTimes(1);
    const [calledArticleId, calledDate, calledToken] = vi.mocked(createArticleHeartbeat).mock.calls[0];
    expect(calledArticleId).toBe(42);
    expect(calledDate.getTime()).toBeCloseTo(futureMs, -3); // within 1 second
    expect(typeof calledToken).toBe("string");
  });

  it("does NOT create a Heartbeat job when publishAs is live and no scheduledAt", async () => {
    let callCount = 0;
    const mockWhere = vi.fn().mockImplementation(() => ({
      // The batch-link-map query awaits where() directly (no .limit) → resolve to [].
      then: (resolve: (v: unknown[]) => unknown) => resolve([]),
      limit: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return [{
            id: 43,
            businessId: 7,
            batchNumber: 1,
            status: "approved",
            title: "Test Article",
            bodyHtml: "<p>Body</p>",
            metaTitle: "Meta Title",
            metaDescription: "Meta description",
            focusKeyword: "test keyword",
            urlSlug: "test-article",
            schemaMarkup: null,
            scheduledPublishAt: null,
            level: "cluster",
            imageUrl: null,
            altText: null,
          }];
        }
        if (callCount === 2) return [{ id: 7, userId: 1 }];
        if (callCount === 3) return [{ credentialsEncrypted: "encrypted-creds" }];
        return [];
      }),
    }));
    const mockLeftJoin = vi.fn().mockReturnThis();
    const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
    mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const db = {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    };
    vi.mocked(getDb).mockResolvedValue(db as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const { articlesRouter } = await import("./routers/articles");
    const ctx = {
      user: { id: 1, email: "test@test.com", name: "Test", role: "user" as const },
      req: { headers: { cookie: "app_session_id=test-session-token" } },
    };
    const caller = articlesRouter.createCaller(ctx as any);
    const result = await caller.publishSingle({
      articleId: 43,
      platform: "wix",
      publishAs: "live",
      // no scheduledAt
    });

    expect(result.status).toBe("published");
    // Heartbeat must NOT be called for immediate publish
    expect(createArticleHeartbeat).not.toHaveBeenCalled();
  });
});
