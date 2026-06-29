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
  // Blog CREATION is hard-set to a minimum 1 cornerstone × 3 pillars × 5 clusters
  // = 19 articles. No single-post or pillar-only mode.

  // ── 20-pack ────────────────────────────────────────────────────────────────

  it("accepts the minimum 1×3×5 = 19 config without warnings", () => {
    const result = validateArchitecture(20, 1, 3);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.correctedCornerstones).toBe(1);
    expect(result.correctedPillarsPerCornerstone).toBe(3);
    expect(result.correctedClustersPerPillar).toBe(5);
    expect(calcTotalArticles(1, 3)).toBe(19); // 1 + 3 + 15 = 19 ≤ 20
  });

  it("clamps cornerstones up to the minimum of 1", () => {
    const result = validateArchitecture(20, 0, 3);
    expect(result.correctedCornerstones).toBe(1);
    expect(result.warnings.some((w) => w.includes("Minimum 1 cornerstone"))).toBe(true);
  });

  it("clamps pillars per cornerstone up to the minimum of 3", () => {
    const result = validateArchitecture(20, 1, 1);
    expect(result.correctedPillarsPerCornerstone).toBe(3);
    expect(result.warnings.some((w) => w.includes("Minimum 3 pillar"))).toBe(true);
  });

  it("clamps clusters per pillar up to the minimum of 5", () => {
    const result = validateArchitecture(null, 1, 3, 2);
    expect(result.correctedClustersPerPillar).toBe(5);
  });

  it("auto-corrects 20-pack when total would exceed pack size", () => {
    // 2 cornerstones × 3 pillars × 5 clusters = 2 + 6 + 30 = 38 > 20
    const result = validateArchitecture(20, 2, 3);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    const correctedTotal = calcTotalArticles(
      result.correctedCornerstones,
      result.correctedPillarsPerCornerstone
    );
    expect(correctedTotal).toBeLessThanOrEqual(20);
    expect(correctedTotal).toBeGreaterThanOrEqual(19); // never drops below the floor
  });

  it("clamps cornerstones to max 4 (no pack constraint)", () => {
    const result = validateArchitecture(null, 10, 3);
    expect(result.correctedCornerstones).toBe(4);
    expect(result.warnings.some((w) => w.includes("Maximum 4"))).toBe(true);
  });

  it("clamps pillars per cornerstone to max 4 (no pack constraint)", () => {
    const result = validateArchitecture(null, 1, 10);
    expect(result.correctedPillarsPerCornerstone).toBe(4);
    expect(result.warnings.some((w) => w.includes("Maximum 4 pillars"))).toBe(true);
  });

  it("clamps clusters per pillar to max 8", () => {
    const result = validateArchitecture(null, 1, 3, 20);
    expect(result.correctedClustersPerPillar).toBe(8);
  });

  // ── 50-pack ────────────────────────────────────────────────────────────────

  it("accepts 50-pack with 2 cornerstones × 3 pillars = 38 articles", () => {
    const total = calcTotalArticles(2, 3);
    expect(total).toBe(38); // 2 + 6 + 30 = 38
    const result = validateArchitecture(50, 2, 3);
    expect(result.valid).toBe(true);
  });

  it("accepts 50-pack with 2 cornerstones × 4 pillars = 50 articles", () => {
    const total = calcTotalArticles(2, 4);
    expect(total).toBe(50); // 2 + 8 + 40 = 50
    const result = validateArchitecture(50, 2, 4);
    expect(result.valid).toBe(true);
  });

  it("auto-corrects 50-pack when total would exceed pack size", () => {
    // 4 × 4 × 5 = 4 + 16 + 80 = 100 > 50
    const result = validateArchitecture(50, 4, 4);
    const total = calcTotalArticles(
      result.correctedCornerstones,
      result.correctedPillarsPerCornerstone
    );
    expect(total).toBeLessThanOrEqual(50);
    expect(total).toBeGreaterThanOrEqual(19);
  });
});

// ─── calcTotalArticles ────────────────────────────────────────────────────────

describe("architectureRules.calcTotalArticles", () => {
  it("calculates correctly for 2×2 config (default 5 clusters)", () => {
    // 2 cornerstones + 4 pillars + 20 clusters = 26
    expect(calcTotalArticles(2, 2)).toBe(26);
  });

  it("calculates correctly for 1×1 config (default 5 clusters)", () => {
    // 1 + 1 + 5 = 7
    expect(calcTotalArticles(1, 1)).toBe(7);
  });

  it("calculates correctly for 4×4 config (default 5 clusters)", () => {
    // 4 + 16 + 80 = 100
    expect(calcTotalArticles(4, 4)).toBe(100);
  });

  it("defaults to 5 clusters per pillar", () => {
    expect(CLUSTERS_PER_PILLAR).toBe(5);
    const total = calcTotalArticles(2, 3);
    // 2 + 6 + 30 = 38
    expect(total).toBe(38);
  });

  it("calculates correctly with an explicit 2 clusters per pillar", () => {
    // 2 cornerstones + 6 pillars + 12 clusters = 20
    expect(calcTotalArticles(2, 3, 2)).toBe(20);
  });

  it("calculates correctly with 5 clusters per pillar (max)", () => {
    // 2 cornerstones + 6 pillars + 30 clusters = 38
    expect(calcTotalArticles(2, 3, 5)).toBe(38);
  });

  it("calculates correctly for pillar-only mode: 1 pillar, 0 clusters = 1 article", () => {
    expect(calcTotalArticles(0, 1, 0)).toBe(1);
  });

  it("calculates correctly for pillar-only mode: 2 pillars, 3 clusters each = 8 articles", () => {
    expect(calcTotalArticles(0, 2, 3)).toBe(8);
  });

  it("calculates correctly for pillar-only mode: 4 pillars, 5 clusters each = 24 articles", () => {
    expect(calcTotalArticles(0, 4, 5)).toBe(24);
  });
});

// ─── calcBreakdown ────────────────────────────────────────────────────────────

describe("architectureRules.calcBreakdown", () => {
  it("returns correct breakdown for 2×2 (default 5 clusters)", () => {
    const b = calcBreakdown(2, 2);
    expect(b.cornerstones).toBe(2);
    expect(b.totalPillars).toBe(4);
    expect(b.totalClusters).toBe(20);
    expect(b.total).toBe(26);
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
    expect(clusters).toHaveLength(20); // 4 pillars × 5 clusters
    expect(nodes).toHaveLength(26);
  });

  it("assigns cornerstone_guide to all cornerstone nodes", () => {
    const nodes = generateNodes(2, 2);
    const cornerstones = nodes.filter((n) => n.level === "cornerstone");
    cornerstones.forEach((n) => expect(n.defaultArticleType).toBe("cornerstone_guide"));
  });

  it("assigns specialist_post to all cluster nodes", () => {
    const nodes = generateNodes(2, 2);
    const clusters = nodes.filter((n) => n.level === "cluster");
    clusters.forEach((n) => expect(n.defaultArticleType).toBe("specialist_post"));
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

  it("generates 1×1 config with 7 nodes", () => {
    const nodes = generateNodes(1, 1);
    expect(nodes).toHaveLength(7); // 1 + 1 + 5
  });

  it("generates 4×4 config with 100 nodes", () => {
    const nodes = generateNodes(4, 4);
    expect(nodes).toHaveLength(100); // 4 + 16 + 80
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

  it("all cluster nodes have both cornerstoneIndex and pillarIndex (full hierarchy)", () => {
    const nodes = generateNodes(2, 3);
    const clusters = nodes.filter((n) => n.level === "cluster");
    clusters.forEach((n) => {
      expect(n.cornerstoneIndex).toBeGreaterThanOrEqual(1);
      expect(n.pillarIndex).not.toBeNull();
      expect(n.clusterIndex).not.toBeNull();
    });
  });

  // ── Pillar-only mode (cornerstones = 0) ──────────────────────────────────

  it("generates 1 pillar node for cornerstones=0, pillars=1, clusters=0", () => {
    const nodes = generateNodes(0, 1, 0);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].level).toBe("pillar");
    expect(nodes[0].cornerstoneIndex).toBe(0);
    expect(nodes[0].pillarIndex).toBe(1);
  });

  it("generates correct nodes for cornerstones=0, pillars=2, clusters=3", () => {
    const nodes = generateNodes(0, 2, 3);
    const pillars = nodes.filter((n) => n.level === "pillar");
    const clusters = nodes.filter((n) => n.level === "cluster");
    expect(pillars).toHaveLength(2);
    expect(clusters).toHaveLength(6); // 2 pillars × 3 clusters
    expect(nodes).toHaveLength(8);
    // All nodes have cornerstoneIndex=0
    nodes.forEach((n) => expect(n.cornerstoneIndex).toBe(0));
    // Clusters are parented to pillars
    clusters.forEach((n) => expect(n.pillarIndex).not.toBeNull());
  });

  it("generates correct labels for pillar-only mode", () => {
    const nodes = generateNodes(0, 2, 2);
    expect(nodes.find((n) => n.label === "Pillar 1")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Pillar 2")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Cluster 1.1")).toBeTruthy();
    expect(nodes.find((n) => n.label === "Cluster 2.2")).toBeTruthy();
  });

  it("generates 0 nodes for cornerstones=0, pillars=0, clusters=0 (edge case)", () => {
    const nodes = generateNodes(0, 0, 0);
    expect(nodes).toHaveLength(0);
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
    // confirm now calls regenerateNodes which does select().from().where() (no .limit).
    // where() calls that are awaited directly must return a Promise resolving to an array.
    // where() calls followed by .limit() must return an object with a limit mock.
    const fakeArch = { id: 5, packSize: 20, cornerstoneCount: 1, pillarCount: 3, clustersPerPillar: 5, confirmed: true };
    const db = makeDb({});
    db.where = vi.fn()
      // 1. assertBusinessOwnership → .limit()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{ id: 10, userId: 1, currentStage: 3, activeBatch: 1 }]) })
      // 2. select arch → .limit()
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([fakeArch]) })
      // 3. update blogArchitectures.set({totalArticleCount}) → update().set().where()
      .mockResolvedValueOnce(undefined)
      // 4. regenerateNodes: select existingNodes → awaited directly (no .limit)
      .mockResolvedValueOnce([])
      // 5. regenerateNodes: delete articleNodes → delete().where()
      .mockResolvedValueOnce(undefined)
      // 6. regenerateNodes: re-query insertedCornerstones → awaited directly
      .mockResolvedValueOnce([])
      // 7. regenerateNodes: re-query insertedPillars → awaited directly
      .mockResolvedValueOnce([])
      // 8. update blogArchitectures.set({confirmed:true}) → update().set().where()
      .mockResolvedValueOnce(undefined)
      // 9. currentStage=3 so no businesses update (skipped)
      // 10. select freshNodes after regenerate → awaited directly
      .mockResolvedValueOnce([]);
    vi.mocked(getDb).mockResolvedValue(db as any);

    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.architecture.confirm({ businessId: 10 });
    expect(result.success).toBe(true);
  });
});
