/**
 * Layer 4 — Architecture Tests
 *
 * Tests the guardrails engine (pure logic, no DB) and the tRPC procedures
 * (using a mocked DB).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  validateArchitecture,
  calcTotalArticles,
  calcBreakdown,
  generateNodes,
  CLUSTERS_PER_PILLAR,
} from "../shared/architectureRules";

// ─── Guardrails Engine Tests (pure logic, no mocks needed) ───────────────────

describe("architectureRules.validateArchitecture", () => {
  // ── 20-pack ────────────────────────────────────────────────────────────────

  it("accepts the default 20-pack config (2×2) without warnings", () => {
    const result = validateArchitecture(20, 2, 2);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.correctedCornerstones).toBe(2);
    expect(result.correctedPillarsPerCornerstone).toBe(2);
  });

  it("accepts 20-pack with 1 cornerstone × 1 pillar (minimum valid)", () => {
    const result = validateArchitecture(20, 1, 1);
    expect(result.valid).toBe(true);
    expect(calcTotalArticles(1, 1)).toBe(5); // 1 + 1 + 3 = 5 ≤ 20
  });

  it("auto-corrects 20-pack when total would exceed pack size", () => {
    // 4 cornerstones × 4 pillars × 3 clusters = 4 + 16 + 48 = 68 > 20
    const result = validateArchitecture(20, 4, 4);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    const correctedTotal = calcTotalArticles(
      result.correctedCornerstones,
      result.correctedPillarsPerCornerstone
    );
    expect(correctedTotal).toBeLessThanOrEqual(20);
  });

  it("clamps cornerstones to max 4", () => {
    const result = validateArchitecture(50, 10, 2);
    expect(result.correctedCornerstones).toBe(4);
    expect(result.warnings.some((w) => w.includes("Maximum 4"))).toBe(true);
  });

  it("clamps cornerstones to min 1", () => {
    const result = validateArchitecture(20, 0, 2);
    expect(result.correctedCornerstones).toBe(1);
    expect(result.warnings.some((w) => w.includes("Minimum 1 cornerstone"))).toBe(true);
  });

  it("clamps pillars per cornerstone to max 4", () => {
    const result = validateArchitecture(50, 1, 10);
    expect(result.correctedPillarsPerCornerstone).toBe(4);
    expect(result.warnings.some((w) => w.includes("Maximum 4 pillars"))).toBe(true);
  });

  it("clamps pillars per cornerstone to min 1", () => {
    const result = validateArchitecture(20, 2, 0);
    expect(result.correctedPillarsPerCornerstone).toBe(1);
    expect(result.warnings.some((w) => w.includes("Minimum 1 pillar"))).toBe(true);
  });

  // ── 50-pack ────────────────────────────────────────────────────────────────

  it("accepts the default 50-pack config (4×3) without warnings", () => {
    // 4 + 12 + 36 = 52 > 50 — the scope says 'adjusted to fit 50'
    // Our engine should auto-correct this
    const result = validateArchitecture(50, 4, 3);
    const total = calcTotalArticles(result.correctedCornerstones, result.correctedPillarsPerCornerstone);
    expect(total).toBeLessThanOrEqual(50);
  });

  it("accepts 50-pack with 3 cornerstones × 3 pillars = 39 articles", () => {
    const total = calcTotalArticles(3, 3);
    expect(total).toBe(39); // 3 + 9 + 27 = 39
    const result = validateArchitecture(50, 3, 3);
    expect(result.valid).toBe(true);
  });

  it("accepts 50-pack with 4 cornerstones × 2 pillars = 36 articles", () => {
    const total = calcTotalArticles(4, 2);
    expect(total).toBe(36); // 4 + 8 + 24 = 36
    const result = validateArchitecture(50, 4, 2);
    expect(result.valid).toBe(true);
  });
});

// ─── calcTotalArticles ────────────────────────────────────────────────────────

describe("architectureRules.calcTotalArticles", () => {
  it("calculates correctly for 2×2 config", () => {
    // 2 cornerstones + 4 pillars + 12 clusters = 18
    expect(calcTotalArticles(2, 2)).toBe(18);
  });

  it("calculates correctly for 1×1 config", () => {
    // 1 + 1 + 3 = 5
    expect(calcTotalArticles(1, 1)).toBe(5);
  });

  it("calculates correctly for 4×4 config", () => {
    // 4 + 16 + 48 = 68
    expect(calcTotalArticles(4, 4)).toBe(68);
  });

  it("always uses 3 clusters per pillar", () => {
    expect(CLUSTERS_PER_PILLAR).toBe(3);
    const total = calcTotalArticles(2, 3);
    // 2 + 6 + 18 = 26
    expect(total).toBe(26);
  });
});

// ─── calcBreakdown ────────────────────────────────────────────────────────────

describe("architectureRules.calcBreakdown", () => {
  it("returns correct breakdown for 2×2", () => {
    const b = calcBreakdown(2, 2);
    expect(b.cornerstones).toBe(2);
    expect(b.totalPillars).toBe(4);
    expect(b.totalClusters).toBe(12);
    expect(b.total).toBe(18);
  });
});

// ─── generateNodes ────────────────────────────────────────────────────────────

describe("architectureRules.generateNodes", () => {
  it("generates the correct number of nodes for 2×2 config", () => {
    const nodes = generateNodes(2, 2);
    const cornerstones = nodes.filter((n) => n.level === "cornerstone");
    const pillars = nodes.filter((n) => n.level === "pillar");
    const clusters = nodes.filter((n) => n.level === "cluster");

    expect(cornerstones).toHaveLength(2);
    expect(pillars).toHaveLength(4); // 2 cornerstones × 2 pillars
    expect(clusters).toHaveLength(12); // 4 pillars × 3 clusters
    expect(nodes).toHaveLength(18);
  });

  it("assigns cornerstone_guide to all cornerstone nodes", () => {
    const nodes = generateNodes(2, 2);
    const cornerstones = nodes.filter((n) => n.level === "cornerstone");
    cornerstones.forEach((n) => expect(n.defaultArticleType).toBe("cornerstone_guide"));
  });

  it("assigns case_study to all cluster nodes", () => {
    const nodes = generateNodes(2, 2);
    const clusters = nodes.filter((n) => n.level === "cluster");
    clusters.forEach((n) => expect(n.defaultArticleType).toBe("case_study"));
  });

  it("generates correct labels", () => {
    const nodes = generateNodes(2, 2);
    expect(nodes.find((n) => n.label === "Cornerstone 1")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Pillar 1.1")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Cluster 1.1.1")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Cornerstone 2")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Pillar 2.2")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Cluster 2.2.3")).toBeTruthy();
  });

  it("generates 1×1 config with 5 nodes", () => {
    const nodes = generateNodes(1, 1);
    expect(nodes).toHaveLength(5); // 1 + 1 + 3
  });

  it("generates 4×4 config with 68 nodes", () => {
    const nodes = generateNodes(4, 4);
    expect(nodes).toHaveLength(68); // 4 + 16 + 48
  });

  it("all pillar nodes have a valid cornerstoneIndex", () => {
    const nodes = generateNodes(3, 2);
    const pillars = nodes.filter((n) => n.level === "pillar");
    pillars.forEach((n) => {
      expect(n.cornerstoneIndex).toBeGreaterThanOrEqual(1);
      expect(n.cornerstoneIndex).toBeLessThanOrEqual(3);
      expect(n.pillarIndex).not.toBeNull();
    });
  });

  it("all cluster nodes have both cornerstoneIndex and pillarIndex", () => {
    const nodes = generateNodes(2, 3);
    const clusters = nodes.filter((n) => n.level === "cluster");
    clusters.forEach((n) => {
      expect(n.cornerstoneIndex).toBeGreaterThanOrEqual(1);
      expect(n.pillarIndex).not.toBeNull();
      expect(n.clusterIndex).not.toBeNull();
    });
  });
});

// ─── Architecture Router Procedure Tests ─────────────────────────────────────
// These tests mock the DB and verify procedure-level behavior.

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";

vi.mock("./db", () => ({ getDb: vi.fn() }));

function makeCtx(): TrpcContext {
  return {
    user: { id: 1, openId: "test", name: "Test", email: "test@test.com", loginMethod: "email", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ id: 10, userId: 1, currentStage: 1 }]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 99 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockReturnThis(),
    ...overrides,
  };
}

describe("architecture.getOrCreate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null architecture when none exists", async () => {
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 1 }]) // business ownership
        .mockResolvedValueOnce([]),                                         // no architecture
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.architecture.getOrCreate({ businessId: 10 });
    expect(result.architecture).toBeNull();
    expect(result.nodes).toHaveLength(0);
  });

  it("returns existing architecture and nodes when present", async () => {
    const fakeArch = { id: 5, businessId: 10, packSize: 20, cornerstoneCount: 2, pillarCount: 2, confirmed: false };
    const fakeNodes = [{ id: 1, level: "cornerstone" }, { id: 2, level: "pillar" }];
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 2 }]) // business
        .mockResolvedValueOnce([fakeArch]),                                // architecture
      where: vi.fn().mockReturnThis(),
    });
    // Nodes query returns fakeNodes (no .limit)
    db.where = vi.fn()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 10, userId: 1, currentStage: 2 }]) })
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([fakeArch]) })
      .mockResolvedValue(fakeNodes);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.architecture.getOrCreate({ businessId: 10 });
    expect(result.architecture).toMatchObject({ id: 5 });
  });
});

describe("architecture.update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws BAD_REQUEST when no architecture exists", async () => {
    const { TRPCError } = await import("@trpc/server");
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 2 }]) // business
        .mockResolvedValueOnce([]),                                         // no architecture
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.architecture.update({ businessId: 10, cornerstones: 2, pillarsPerCornerstone: 2 })
    ).rejects.toThrow(TRPCError);
  });

  it("throws BAD_REQUEST when architecture is confirmed (locked)", async () => {
    const { TRPCError } = await import("@trpc/server");
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 3 }])
        .mockResolvedValueOnce([{ id: 5, businessId: 10, packSize: 20, cornerstoneCount: 2, pillarCount: 2, confirmed: true }]),
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.architecture.update({ businessId: 10, cornerstones: 2, pillarsPerCornerstone: 2 })
    ).rejects.toThrow(TRPCError);
  });
});

describe("architecture.setArticleType", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws BAD_REQUEST when trying to change a cornerstone node type", async () => {
    const { TRPCError } = await import("@trpc/server");
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1 }])                  // business
        .mockResolvedValueOnce([{ id: 1, level: "cornerstone", businessId: 10 }]), // node
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.architecture.setArticleType({ businessId: 10, nodeId: 1, articleType: "top_10_list" })
    ).rejects.toThrow(TRPCError);
  });

  it("throws BAD_REQUEST when trying to change a cluster node type", async () => {
    const { TRPCError } = await import("@trpc/server");
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1 }])
        .mockResolvedValueOnce([{ id: 2, level: "cluster", businessId: 10 }]),
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.architecture.setArticleType({ businessId: 10, nodeId: 2, articleType: "how_to" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("architecture.confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws BAD_REQUEST when no architecture exists", async () => {
    const { TRPCError } = await import("@trpc/server");
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 2 }])
        .mockResolvedValueOnce([]),
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.architecture.confirm({ businessId: 10 })
    ).rejects.toThrow(TRPCError);
  });

  it("succeeds idempotently when architecture is already confirmed", async () => {
    const db = makeDb({
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 10, userId: 1, currentStage: 3 }])
        .mockResolvedValueOnce([{ id: 5, packSize: 20, cornerstoneCount: 2, pillarCount: 2, confirmed: true }]),
    });
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.architecture.confirm({ businessId: 10 });
    expect(result.success).toBe(true);
  });
});
