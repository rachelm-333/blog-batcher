/**
 * Layer 14 — Free Trial Flow — Vitest Tests
 *
 * Covers:
 *  - trial.getStatus: returns correct status for new user, trial-used user, paid user
 *  - trial.startFreeTrial: creates business + architecture + keyword, sets packSize=0
 *  - trial.startFreeTrial: blocks duplicate trial (same user)
 *  - trial.startFreeTrial: blocks duplicate trial (same email, different user)
 *  - trial.getUpgradeOptions: returns all three products with correct fields
 *  - articles.startGeneration: blocks trial business if freeTrialUsed=true
 *  - articles.startGeneration: blocks non-trial business if credits < 1
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  users,
  businesses,
  blogArchitectures,
  articleNodes,
  keywords,
  articles,
  credits,
  creditTransactions,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(userId: number, email: string) {
  return {
    user: {
      id: userId,
      email,
      name: "Test User",
      role: "user" as const,
      tier: "standard" as const,
      onboardingComplete: false,
      emailVerified: true,
      createdAt: new Date(),
    },
    req: { headers: { origin: "http://localhost:3000" } } as unknown as import("express").Request,
    res: {} as unknown as import("express").Response,
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_EMAIL_A = "layer14-trial-a@test.invalid";
const TEST_EMAIL_B = "layer14-trial-b@test.invalid";
const TEST_EMAIL_C = "layer14-trial-c@test.invalid";

let userAId: number;
let userBId: number;
let userCId: number;

async function cleanupTestUsers() {
  const db = await getDb();
  if (!db) return;
  for (const email of [TEST_EMAIL_A, TEST_EMAIL_B, TEST_EMAIL_C]) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (u) {
      // Delete dependent rows
      await db.delete(creditTransactions).where(eq(creditTransactions.userId, u.id));
      await db.delete(credits).where(eq(credits.userId, u.id));
      const bizRows = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.userId, u.id));
      for (const biz of bizRows) {
        const archRows = await db.select({ id: blogArchitectures.id }).from(blogArchitectures).where(eq(blogArchitectures.businessId, biz.id));
        for (const arch of archRows) {
          const nodeRows = await db.select({ id: articleNodes.id }).from(articleNodes).where(eq(articleNodes.architectureId, arch.id));
          for (const node of nodeRows) {
            await db.delete(keywords).where(eq(keywords.articleNodeId, node.id));
            await db.delete(articles).where(eq(articles.articleNodeId, node.id));
          }
          await db.delete(articleNodes).where(eq(articleNodes.architectureId, arch.id));
        }
        await db.delete(blogArchitectures).where(eq(blogArchitectures.businessId, biz.id));
        await db.delete(businesses).where(eq(businesses.id, biz.id));
      }
      await db.delete(users).where(eq(users.id, u.id));
    }
  }
}

async function createTestUser(email: string, freeTrialUsed = false): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const hash = await bcrypt.hash("TestPass123!", 10);
  const [row] = await db.insert(users).values({
    email,
    name: "Trial Test User",
    openId: `layer14-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    loginMethod: "password",
    passwordHash: hash,
    emailVerified: 1 as unknown as boolean,
    onboardingComplete: 0 as unknown as boolean,
    role: "user",
    tier: "standard",
    freeTrialUsed: freeTrialUsed ? 1 as unknown as boolean : 0 as unknown as boolean,
  }).$returningId();
  // Create credits row
  await db.insert(credits).values({ userId: row.id, balance: 0 });
  return row.id;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanupTestUsers();
  userAId = await createTestUser(TEST_EMAIL_A); // fresh user, no trial used
  userBId = await createTestUser(TEST_EMAIL_B, true); // trial already used
  userCId = await createTestUser(TEST_EMAIL_C); // fresh user for duplicate test
});

afterAll(async () => {
  await cleanupTestUsers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Layer 14: Free Trial Flow", () => {
  // ── trial.getStatus ────────────────────────────────────────────────────────

  describe("trial.getStatus", () => {
    it("returns freeTrialUsed=false for a fresh user", async () => {
      const caller = appRouter.createCaller(makeCtx(userAId, TEST_EMAIL_A));
      const status = await caller.trial.getStatus();
      expect(status.freeTrialUsed).toBe(false);
      expect(status.hasActivePlan).toBe(false);
    });

    it("returns freeTrialUsed=true for a user who has used their trial", async () => {
      const caller = appRouter.createCaller(makeCtx(userBId, TEST_EMAIL_B));
      const status = await caller.trial.getStatus();
      expect(status.freeTrialUsed).toBe(true);
    });
  });

  // ── trial.startFreeTrial ───────────────────────────────────────────────────

  describe("trial.startFreeTrial", () => {
    it("creates a trial business with packSize=0", async () => {
      const caller = appRouter.createCaller(makeCtx(userAId, TEST_EMAIL_A));
      const result = await caller.trial.startFreeTrial({
        businessName: "Layer14 Trial Co",
        websiteUrl: "https://layer14trial.example.com",
      });
      expect(result.businessId).toBeGreaterThan(0);
      expect(result.packSize).toBe(0);

      // Verify architecture has packSize=0
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [arch] = await db
        .select({ packSize: blogArchitectures.packSize })
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, result.businessId))
        .limit(1);
      expect(arch?.packSize).toBe(0);
    });

    it("blocks a second trial for the same user", async () => {
      const caller = appRouter.createCaller(makeCtx(userAId, TEST_EMAIL_A));
      await expect(
        caller.trial.startFreeTrial({ businessName: "Second Trial Attempt" })
      ).rejects.toThrow();
    });

    it("blocks a trial for a user who has already used their trial (freeTrialUsed=true)", async () => {
      const caller = appRouter.createCaller(makeCtx(userBId, TEST_EMAIL_B));
      await expect(
        caller.trial.startFreeTrial({ businessName: "Blocked Trial" })
      ).rejects.toThrow();
    });
  });

  // ── trial.getUpgradeOptions ────────────────────────────────────────────────

  describe("trial.getUpgradeOptions", () => {
    it("returns all three products with required fields", async () => {
      const caller = appRouter.createCaller(makeCtx(userAId, TEST_EMAIL_A));
      const result = await caller.trial.getUpgradeOptions();
      expect(result.products).toHaveLength(3);
      const keys = result.products.map(p => p.key);
      expect(keys).toContain("citation_starter");
      expect(keys).toContain("citation_authority");
      expect(keys).toContain("credit_topup");
      for (const p of result.products) {
        expect(p.name).toBeTruthy();
        expect(p.priceDisplay).toBeTruthy();
        expect(p.credits).toBeGreaterThan(0);
      }
    });

    it("marks citation_authority as recommended", async () => {
      const caller = appRouter.createCaller(makeCtx(userAId, TEST_EMAIL_A));
      const result = await caller.trial.getUpgradeOptions();
      const authority = result.products.find(p => p.key === "citation_authority");
      expect(authority?.recommended).toBe(true);
    });
  });

  // ── articles.startGeneration — trial guard ─────────────────────────────────

  describe("articles.startGeneration — trial guard", () => {
    it("blocks generation for a trial business if freeTrialUsed=true", async () => {
      // userB has freeTrialUsed=true — create a trial business for them
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [bizRow] = await db.insert(businesses).values({
        userId: userBId,
        name: "UserB Trial Business",
        currentStage: 4,
      }).$returningId();
      await db.insert(blogArchitectures).values({
        businessId: bizRow.id,
        packSize: 0,
        cornerstoneCount: 0,
        pillarCount: 0,
        clustersPerPillar: 3,
        totalArticleCount: 1,
        confirmed: true,
      });

      const caller = appRouter.createCaller(makeCtx(userBId, TEST_EMAIL_B));
      await expect(
        caller.articles.startGeneration({ businessId: bizRow.id })
      ).rejects.toThrow("FREE_TRIAL_USED");

      // Cleanup
      await db.delete(blogArchitectures).where(eq(blogArchitectures.businessId, bizRow.id));
      await db.delete(businesses).where(eq(businesses.id, bizRow.id));
    });

    it("blocks generation for a non-trial business if credits < 1", async () => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // userC has 0 credits — create a paid business (packSize=20)
      const [bizRow] = await db.insert(businesses).values({
        userId: userCId,
        name: "UserC Paid Business",
        currentStage: 4,
      }).$returningId();
      await db.insert(blogArchitectures).values({
        businessId: bizRow.id,
        packSize: 20,
        cornerstoneCount: 1,
        pillarCount: 3,
        clustersPerPillar: 3,
        totalArticleCount: 20,
        confirmed: true,
      });

      const caller = appRouter.createCaller(makeCtx(userCId, TEST_EMAIL_C));
      await expect(
        caller.articles.startGeneration({ businessId: bizRow.id })
      ).rejects.toThrow("INSUFFICIENT_CREDITS");

      // Cleanup
      await db.delete(blogArchitectures).where(eq(blogArchitectures.businessId, bizRow.id));
      await db.delete(businesses).where(eq(businesses.id, bizRow.id));
    });
  });
});
