/**
 * Layer 5 — Stage 3: SEO Keyword Research Tests
 *
 * Covers:
 *   - cannibalization engine (exact duplicate, semantic overlap, clean set)
 *   - keywords.getAll (returns empty array when no keywords assigned)
 *   - keywords.approveOne (marks a keyword as approved)
 *   - keywords.approveAll (blocks on cannibalization conflicts)
 *   - keywords.approvePAA (advances stage when all PAA approved)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkCannibalization } from "../shared/cannibalizationCheck";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Cannibalization engine tests (pure logic, no DB)
// ---------------------------------------------------------------------------

describe("cannibalizationCheck", () => {
  it("returns no conflicts for a clean set of distinct keywords", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "plumber Gold Coast" },
      { nodeId: 2, keyword: "emergency plumber Brisbane" },
      { nodeId: 3, keyword: "hot water system repair" },
      { nodeId: 4, keyword: "blocked drain Gold Coast" },
    ]);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects exact duplicate keywords (case-insensitive)", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "Gold Coast Plumber" },
      { nodeId: 2, keyword: "gold coast plumber" },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.type).toBe("exact_duplicate");
  });

  it("detects exact duplicate after punctuation removal", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "Gold Coast, Plumber" },
      { nodeId: 2, keyword: "Gold Coast Plumber" },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0]!.type).toBe("exact_duplicate");
  });

  it("detects semantic overlap (same tokens, different word order)", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "Gold Coast marketing agency" },
      { nodeId: 2, keyword: "marketing agency Gold Coast" },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts[0]!.type).toBe("semantic_overlap");
    expect(result.conflicts[0]!.nodeIdA).toBe(1);
    expect(result.conflicts[0]!.nodeIdB).toBe(2);
  });

  it("does NOT flag related but distinct keywords as overlap", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "growth agency Gold Coast" },
      { nodeId: 2, keyword: "marketing agency Gold Coast" },
    ]);
    // 'growth' vs 'marketing' differ — should not be flagged
    expect(result.hasConflicts).toBe(false);
  });

  it("detects multiple conflicts in a large set", () => {
    const result = checkCannibalization([
      { nodeId: 1, keyword: "plumber Gold Coast" },
      { nodeId: 2, keyword: "Gold Coast plumber" }, // overlap with 1
      { nodeId: 3, keyword: "emergency plumber" },
      { nodeId: 4, keyword: "emergency plumber" }, // exact dup with 3
      { nodeId: 5, keyword: "hot water system" },
    ]);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(2);
  });

  it("returns correct nodeIds in conflict pairs", () => {
    const result = checkCannibalization([
      { nodeId: 10, keyword: "Brisbane SEO agency" },
      { nodeId: 20, keyword: "SEO agency Brisbane" },
    ]);
    expect(result.conflicts[0]!.nodeIdA).toBe(10);
    expect(result.conflicts[0]!.nodeIdB).toBe(20);
    expect(result.conflicts[0]!.keywordA).toBe("Brisbane SEO agency");
    expect(result.conflicts[0]!.keywordB).toBe("SEO agency Brisbane");
  });

  it("handles single-keyword input with no conflicts", () => {
    const result = checkCannibalization([{ nodeId: 1, keyword: "plumber" }]);
    expect(result.hasConflicts).toBe(false);
  });

  it("handles empty input", () => {
    const result = checkCannibalization([]);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Keyword procedure tests (mocked DB)
// ---------------------------------------------------------------------------

type AuthUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthUser> = {}): TrpcContext {
  const user: AuthUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "email",
    role: "user",
    tier: "standard",
    onboardingComplete: false,
    emailVerified: true,
    passwordHash: null,
    emailVerificationToken: null,
    emailVerificationExpiry: null,
    passwordResetToken: null,
    passwordResetExpiry: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// Mock the DB module
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// Mock the API cost logger (keywords.ts now uses invokeLLMWithCost)
// Also mock the path as seen from server/routers/keywords.ts
vi.mock("../apiCostLogger", () => ({
  invokeLLMWithCost: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      "1": "plumber Gold Coast",
      "2": "emergency plumber Brisbane",
      "3": "hot water system repair",
    }) } }],
  }),
}));
vi.mock("./apiCostLogger", () => ({
  invokeLLMWithCost: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      "1": "plumber Gold Coast",
      "2": "emergency plumber Brisbane",
      "3": "hot water system repair",
    }) } }],
  }),
}));

import { getDb } from "./db";

const mockGetDb = vi.mocked(getDb);

function makeMockDb(overrides: Record<string, unknown> = {}) {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
  };

  return {
    select: vi.fn().mockReturnValue(chainable),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("keywords.getAll", () => {
  it("returns empty array when no keywords exist", async () => {
    const chainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    const mockDb = { select: vi.fn().mockReturnValue(chainable) };
    mockGetDb.mockResolvedValue(mockDb as ReturnType<typeof makeMockDb> as never);

    // Also mock business ownership check
    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
      innerJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    mockDb.select
      .mockReturnValueOnce(ownershipChainable) // ownership check
      .mockReturnValue(chainable); // keyword query

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.getAll({ businessId: 1 });
    expect(result).toEqual([]);
  });
});

describe("keywords.approveOne", () => {
  it("marks a keyword as approved", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue(ownershipChainable),
      update: mockUpdate,
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.approveOne({ businessId: 1, keywordId: 5 });
    expect(result).toEqual({ approved: true });
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe("keywords.approveAll", () => {
  it("throws BAD_REQUEST when cannibalization conflicts exist", async () => {
    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };

    // Return two conflicting keywords
    const kwChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 1, articleNodeId: 10, primaryKeyword: "Gold Coast plumber" },
        { id: 2, articleNodeId: 11, primaryKeyword: "plumber Gold Coast" },
      ]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(ownershipChainable)
        .mockReturnValue(kwChainable),
      update: mockUpdate,
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.keywords.approveAll({ businessId: 1 })).rejects.toThrow(
      /cannibalization/i
    );
  });

  it("approves all keywords when no conflicts exist", async () => {
    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };

    const kwChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 1, articleNodeId: 10, primaryKeyword: "plumber Gold Coast" },
        { id: 2, articleNodeId: 11, primaryKeyword: "emergency plumber Brisbane" },
        { id: 3, articleNodeId: 12, primaryKeyword: "hot water system repair" },
      ]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(ownershipChainable)
        .mockReturnValue(kwChainable),
      update: mockUpdate,
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.approveAll({ businessId: 1 });
    expect(result).toEqual({ approved: 3 });
  });
});

describe("keywords.approvePAA", () => {
  it("returns stageAdvanced=false when not all PAA approved", async () => {
    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    // Not all PAA approved — one still pending
    const paaChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { paaApproved: true },
        { paaApproved: false },
      ]),
    };

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(ownershipChainable)
        .mockReturnValue(paaChainable),
      update: mockUpdate,
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.approvePAA({
      businessId: 1,
      keywordId: 1,
      approvedQuestion: "What does a plumber do?",
    });
    expect(result.approved).toBe(true);
    expect(result.stageAdvanced).toBe(false);
  });

  it("returns stageAdvanced=true when all PAA approved", async () => {
    const ownershipChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const mockUpdate = vi.fn().mockReturnValue({ set: updateSet });

    // All PAA approved
    const paaChainable = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { paaApproved: true },
        { paaApproved: true },
      ]),
    };

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(ownershipChainable)
        .mockReturnValue(paaChainable),
      update: mockUpdate,
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.approvePAA({
      businessId: 1,
      keywordId: 1,
      approvedQuestion: "What does a plumber do?",
    });
    expect(result.approved).toBe(true);
    expect(result.stageAdvanced).toBe(true);
  });
});

describe("keywords.assignAll", () => {
  it("resolves and returns an assigned count (does not throw)", async () => {
    // All select() calls need from/where/limit chain
    const makeChainable = (resolvedValue: unknown) => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(resolvedValue),
    });

    const mockDb = {
      select: vi.fn()
        // 1st call: ownership check (assertBusinessOwnership) — returns [{ id: 1 }]
        .mockReturnValueOnce(makeChainable([{ id: 1 }]))
        // 2nd call: businesses fetch — returns full biz row
        .mockReturnValueOnce(makeChainable([{ id: 1, name: "Test Biz", keywordExclusions: null, uniqueValueProposition: null, serviceArea: null, location: null, industry: "Technology" }]))
        // 3rd call: brand voice fetch — returns null (optional)
        .mockReturnValueOnce(makeChainable([]))
        // 4th call: article nodes — .where() resolves directly (no .limit)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            { id: 1, level: "cornerstone", articleType: "cornerstone_guide", sortOrder: 0 },
            { id: 2, level: "pillar", articleType: "how_to", sortOrder: 1 },
            { id: 3, level: "cluster", articleType: "specialist_post", sortOrder: 2 },
          ]),
        })
        // 5th call: business services — .from().where().orderBy() resolves directly
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([{ name: "Pitch Deck Design" }, { name: "Investor Presentations" }]),
        })
        // 6th call: selected_keywords — .from().where().orderBy() resolves directly (empty = fall back to seeds)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([]),
        })
        // 7th call: keyword seeds — .from().where().orderBy() resolves directly (empty = no pool)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
    };
    mockGetDb.mockResolvedValue(mockDb as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywords.assignAll({ businessId: 1 });
    expect(result).toMatchObject({ assigned: expect.any(Number) });
  });
});
