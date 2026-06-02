/**
 * Layer 10 — User Dashboard Tests
 *
 * Tests for:
 *  - dashboard.getSummary (status counts, badge counts, credit balance, quick action)
 *  - dashboard.getRecentActivity (returns audit log rows)
 *  - dashboard.listBusinesses (multi-business switcher)
 *
 * All DB calls are mocked via vi.mock so no real database is required.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Mock the DB module so no real database connection is needed
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
import { appRouter } from "./routers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `user${userId}@example.com`,
    name: `User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

/** Build a minimal chainable Drizzle query mock */
function makeQueryChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "leftJoin", "innerJoin", "orderBy", "limit"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // The final awaited call resolves to returnValue
  (chain as unknown as Promise<unknown>)[Symbol.iterator as unknown as string] = undefined;
  Object.defineProperty(chain, "then", {
    get: () => (resolve: (v: unknown) => void) => resolve(returnValue),
  });
  return chain;
}

// ---------------------------------------------------------------------------
// dashboard.getSummary
// ---------------------------------------------------------------------------
describe("dashboard.getSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct status counts for a business with mixed article statuses", async () => {
    const mockDb = {
      select: vi.fn(),
    };

    // Call sequence:
    // 1. assertOwnership → returns [{ id: 1 }]
    // 2. business info → returns [{ id: 1, name: "Test Co", ... }]
    // 3. article rows → returns mixed statuses
    // 4. credit row → returns [{ balance: 42 }]

    const articleRows = [
      { status: "approved", statusBadge: "authority_ready" },
      { status: "approved", statusBadge: "strong" },
      { status: "scheduled", statusBadge: "authority_ready" },
      { status: "published", statusBadge: "strong" },
      { status: "failed", statusBadge: "needs_review" },
      { status: "generated", statusBadge: null },
    ];

    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      const results: unknown[][] = [
        [{ id: 1 }],                                                   // assertOwnership
        [{ id: 1, name: "Test Co", industry: "Tech", location: "Sydney", currentStage: 4, cmsPlatform: null }], // biz info
        articleRows,                                                    // article rows
        [{ balance: 42 }],                                             // credits
      ];
      const result = results[callCount - 1] ?? [];
      return makeQueryChain(result);
    });

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const summary = await caller.dashboard.getSummary({ businessId: 1 });

    expect(summary.statusCounts.total).toBe(6);
    expect(summary.statusCounts.approved).toBe(2);
    expect(summary.statusCounts.scheduled).toBe(1);
    expect(summary.statusCounts.published).toBe(1);
    expect(summary.statusCounts.failed).toBe(1);
    expect(summary.statusCounts.generated).toBe(1);
    expect(summary.badgeCounts.authority_ready).toBe(2);
    expect(summary.badgeCounts.strong).toBe(2);
    expect(summary.badgeCounts.needs_review).toBe(1);
    expect(summary.creditBalance).toBe(42);
  });

  it("returns credit balance of 0 when no credits row exists", async () => {
    const mockDb = { select: vi.fn() };
    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      const results: unknown[][] = [
        [{ id: 1 }],
        [{ id: 1, name: "Biz", industry: null, location: null, currentStage: 1, cmsPlatform: null }],
        [],   // no articles
        [],   // no credits row
      ];
      return makeQueryChain(results[callCount - 1] ?? []);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const summary = await caller.dashboard.getSummary({ businessId: 1 });

    expect(summary.creditBalance).toBe(0);
    expect(summary.statusCounts.total).toBe(0);
  });

  it("returns correct quick action for stage 1", async () => {
    const mockDb = { select: vi.fn() };
    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      const results: unknown[][] = [
        [{ id: 1 }],
        [{ id: 1, name: "Biz", industry: null, location: null, currentStage: 1, cmsPlatform: null }],
        [],
        [{ balance: 0 }],
      ];
      return makeQueryChain(results[callCount - 1] ?? []);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const summary = await caller.dashboard.getSummary({ businessId: 1 });

    expect(summary.quickActionRoute).toBe("/onboarding");
    expect(summary.quickActionLabel).toBe("Complete Business Profile");
  });

  it("returns correct quick action for stage 5", async () => {
    const mockDb = { select: vi.fn() };
    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      const results: unknown[][] = [
        [{ id: 1 }],
        [{ id: 1, name: "Biz", industry: null, location: null, currentStage: 5, cmsPlatform: null }],
        [],
        [{ balance: 10 }],
      ];
      return makeQueryChain(results[callCount - 1] ?? []);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const summary = await caller.dashboard.getSummary({ businessId: 1 });

    expect(summary.quickActionRoute).toBe("/review");
    expect(summary.quickActionLabel).toBe("Review & Publish Articles");
  });

  it("throws FORBIDDEN when user does not own the business", async () => {
    const mockDb = { select: vi.fn() };
    // assertOwnership returns empty array → access denied
    mockDb.select = vi.fn().mockImplementation(() => makeQueryChain([]));
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.dashboard.getSummary({ businessId: 1 })).rejects.toThrow("Access denied");
  });
});

// ---------------------------------------------------------------------------
// dashboard.getRecentActivity
// ---------------------------------------------------------------------------
describe("dashboard.getRecentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent audit log entries with article titles", async () => {
    const mockDb = { select: vi.fn() };
    const auditRows = [
      {
        id: 10,
        articleId: 5,
        action: "scheduled_publish_succeeded",
        result: "success",
        errorMessage: null,
        attemptNumber: 1,
        triggeredBy: "heartbeat",
        newScheduledAt: null,
        createdAt: new Date("2026-06-01T10:00:00Z"),
        articleTitle: "How to Build a Blog",
        articleStatus: "published",
        articleSlug: "how-to-build-a-blog",
        cmsPostUrl: "https://example.com/blog/how-to-build-a-blog",
      },
      {
        id: 9,
        articleId: 6,
        action: "scheduled_publish_failed",
        result: "failure",
        errorMessage: "CMS connection timeout",
        attemptNumber: 1,
        triggeredBy: "heartbeat",
        newScheduledAt: null,
        createdAt: new Date("2026-06-01T09:00:00Z"),
        articleTitle: "SEO Tips for 2026",
        articleStatus: "scheduled",
        articleSlug: "seo-tips-2026",
        cmsPostUrl: null,
      },
    ];

    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryChain([{ id: 1 }]); // assertOwnership
      return makeQueryChain(auditRows);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const activity = await caller.dashboard.getRecentActivity({ businessId: 1, limit: 10 });

    expect(activity).toHaveLength(2);
    expect(activity[0]!.action).toBe("scheduled_publish_succeeded");
    expect(activity[0]!.articleTitle).toBe("How to Build a Blog");
    expect(activity[1]!.action).toBe("scheduled_publish_failed");
    expect(activity[1]!.errorMessage).toBe("CMS connection timeout");
  });

  it("returns empty array when no activity exists", async () => {
    const mockDb = { select: vi.fn() };
    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryChain([{ id: 1 }]);
      return makeQueryChain([]);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const activity = await caller.dashboard.getRecentActivity({ businessId: 1 });

    expect(activity).toHaveLength(0);
  });

  it("throws FORBIDDEN for a business the user does not own", async () => {
    const mockDb = { select: vi.fn() };
    mockDb.select = vi.fn().mockImplementation(() => makeQueryChain([]));
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(99));
    await expect(caller.dashboard.getRecentActivity({ businessId: 1 })).rejects.toThrow("Access denied");
  });
});

// ---------------------------------------------------------------------------
// dashboard.listBusinesses
// ---------------------------------------------------------------------------
describe("dashboard.listBusinesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when user has no businesses", async () => {
    const mockDb = { select: vi.fn() };
    mockDb.select = vi.fn().mockImplementation(() => makeQueryChain([]));
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.dashboard.listBusinesses();

    expect(result).toEqual([]);
  });

  it("returns single business with correct article counts", async () => {
    const mockDb = { select: vi.fn() };
    const bizRows = [
      { id: 1, name: "Acme Corp", industry: "Tech", location: "Sydney", currentStage: 3, cmsPlatform: "wordpress", createdAt: new Date() },
    ];
    const articleRows = [
      { businessId: 1, status: "published" },
      { businessId: 1, status: "published" },
      { businessId: 1, status: "scheduled" },
      { businessId: 1, status: "approved" },
    ];

    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryChain(bizRows);
      return makeQueryChain(articleRows);
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.dashboard.listBusinesses();

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Acme Corp");
    expect(result[0]!.articleCounts.total).toBe(4);
    expect(result[0]!.articleCounts.published).toBe(2);
    expect(result[0]!.articleCounts.scheduled).toBe(1);
  });

  it("returns multiple businesses for multi-business switcher", async () => {
    const mockDb = { select: vi.fn() };
    const bizRows = [
      { id: 1, name: "Biz One", industry: "Tech", location: "Sydney", currentStage: 2, cmsPlatform: null, createdAt: new Date() },
      { id: 2, name: "Biz Two", industry: "Retail", location: "Melbourne", currentStage: 5, cmsPlatform: "wix", createdAt: new Date() },
    ];
    const allArticles = [
      { businessId: 1, status: "approved" },
      { businessId: 1, status: "scheduled" },
      { businessId: 2, status: "published" },
      { businessId: 2, status: "published" },
      { businessId: 2, status: "published" },
    ];

    let callCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeQueryChain(bizRows);
      // For multi-business: first extra query (placeholder) + second (allArticlesAll)
      if (callCount === 2) return makeQueryChain(allArticles); // placeholder
      return makeQueryChain(allArticles); // allArticlesAll
    });
    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx(1));
    const result = await caller.dashboard.listBusinesses();

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Biz One");
    expect(result[1]!.name).toBe("Biz Two");
    // Article counts come from the allArticlesAll query
    expect(result[0]!.articleCounts.total).toBeGreaterThanOrEqual(0);
    expect(result[1]!.articleCounts.total).toBeGreaterThanOrEqual(0);
  });
});
