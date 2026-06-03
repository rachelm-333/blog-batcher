/**
 * Tests for keywordSeeds router
 * Covers: getAll, save, suggest
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mock DB (factory pattern avoids hoisting issues) ─────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("./apiCostLogger", () => ({
  invokeLLMWithCost: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ seeds: ["pitch deck design", "investor presentation", "startup pitch deck"] }) } }],
  }),
}));

// ── Mock DataForSEO ───────────────────────────────────────────────────────────
vi.mock("./dataforseo", () => ({
  getKeywordSuggestions: vi.fn().mockResolvedValue([
    { keyword: "pitch deck design", monthlySearchVolume: 1200, competitionLevel: "medium", cpc: 3.5 },
    { keyword: "pitch deck consultant", monthlySearchVolume: 800, competitionLevel: "low", cpc: 2.1 },
  ]),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { getDb } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const mockGetDb = vi.mocked(getDb);

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

// Helper: build a chainable select mock that resolves to a value
function makeChainable(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedValue),
    orderBy: vi.fn().mockResolvedValue(resolvedValue),
  };
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// keywordSeeds.getAll
// ---------------------------------------------------------------------------
describe("keywordSeeds.getAll", () => {
  it("returns seeds for owned business", async () => {
    const seeds = [
      { id: 1, businessId: 1, keyword: "pitch deck design", sortOrder: 0 },
    ];
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(makeChainable([{ id: 1 }]))  // ownership check
        .mockReturnValueOnce(makeChainable(seeds)),         // seed fetch
    };
    mockGetDb.mockResolvedValue(db as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywordSeeds.getAll({ businessId: 1 });
    expect(result).toEqual(seeds);
  });

  it("throws FORBIDDEN for non-owner", async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce(makeChainable([])), // empty = not owner
    };
    mockGetDb.mockResolvedValue(db as never);

    const caller = appRouter.createCaller(makeCtx({ id: 99 }));
    await expect(caller.keywordSeeds.getAll({ businessId: 1 })).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// keywordSeeds.save
// ---------------------------------------------------------------------------
describe("keywordSeeds.save", () => {
  it("saves seeds and returns count", async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn().mockResolvedValue(undefined);

    const db = {
      select: vi.fn().mockReturnValueOnce(makeChainable([{ id: 1 }])), // ownership
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };
    mockGetDb.mockResolvedValue(db as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywordSeeds.save({
      businessId: 1,
      seeds: ["pitch deck design", "investor presentation"],
    });
    expect(result.saved).toBe(2);
    expect(insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "pitch deck design", sortOrder: 0 }),
        expect.objectContaining({ keyword: "investor presentation", sortOrder: 1 }),
      ])
    );
  });

  it("rejects more than 10 seeds at the input validation level", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const tooMany = Array.from({ length: 11 }, (_, i) => `seed ${i}`);
    await expect(caller.keywordSeeds.save({ businessId: 1, seeds: tooMany })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// keywordSeeds.suggest
// ---------------------------------------------------------------------------
describe("keywordSeeds.suggest", () => {
  it("returns AI-suggested seeds based on business profile", async () => {
    const db = {
      select: vi.fn()
        // 1: ownership check
        .mockReturnValueOnce(makeChainable([{ id: 1 }]))
        // 2: business profile
        .mockReturnValueOnce(makeChainable([{
          id: 1, name: "The Startup Deck", industry: "Consulting",
          location: "Gold Coast", serviceArea: null, uniqueValueProposition: "Best pitch decks",
          keywordExclusions: null,
        }]))
        // 3: services
        .mockReturnValueOnce(makeChainable([
          { name: "Pitch Deck Design" },
          { name: "Investor Presentations" },
        ]))
        // 4: brand voice
        .mockReturnValueOnce(makeChainable([{ finalVoiceBrief: "Professional and confident." }])),
    };
    mockGetDb.mockResolvedValue(db as never);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.keywordSeeds.suggest({ businessId: 1 });
    expect(result.seeds).toBeInstanceOf(Array);
    expect(result.seeds.length).toBeGreaterThan(0);
    expect(result.seeds.length).toBeLessThanOrEqual(10);
    // All seeds should be non-empty strings
    for (const seed of result.seeds) {
      expect(typeof seed).toBe("string");
      expect(seed.length).toBeGreaterThan(0);
    }
  });
});
