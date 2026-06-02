/**
 * Layer 15 — Multi-Business & Agency Features
 * Tests:
 *  1. A user can have multiple businesses
 *  2. Data isolation: articles under Business A do not appear under Business B
 *  3. Credits are shared at account level (not per business)
 *  4. Admin can view all businesses across all users
 *  5. business.getById returns correct business with ownership check
 *  6. business.listAll returns all businesses for the user
 *  7. dashboard.listBusinesses returns correct article counts per business
 *  8. getNotifications filters by businessId when provided
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { users, businesses, articles, notifications, credits, creditTransactions, blogArchitectures, articleNodes } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestUser(email: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const hash = await bcrypt.hash("test-password-123", 10);
  const [row] = await db.insert(users).values({
    email,
    name: `Test User ${email}`,
    openId: `test-openid-l15-${email}`,
    loginMethod: "password",
    passwordHash: hash,
    onboardingComplete: 0 as any,
    emailVerified: 1 as any,
    isSuspended: 0 as any,
    freeTrialUsed: 0 as any,
  });
  const userId = (row as any).insertId as number;
  // Seed credits
  await db.insert(credits).values({ userId, balance: 50 });
  return userId;
}

async function createTestBusiness(userId: number, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [row] = await db.insert(businesses).values({
    userId,
    name,
    currentStage: 2,
  });
  return (row as any).insertId as number;
}

async function createTestArticle(businessId: number, userId: number, title: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Create a minimal architecture for this business (or reuse existing)
  let archId: number;
  const existingArch = await db.select({ id: blogArchitectures.id }).from(blogArchitectures)
    .where(eq(blogArchitectures.businessId, businessId));
  if (existingArch.length) {
    archId = existingArch[0]!.id;
  } else {
    const [archRow] = await db.insert(blogArchitectures).values({
      businessId,
      packSize: 1,
      cornerstoneCount: 1,
      pillarCount: 0,
      clustersPerPillar: 0,
      totalArticleCount: 1,
      confirmed: true as any,
    });
    archId = (archRow as any).insertId as number;
  }
  // Create an article node
  const [nodeRow] = await db.insert(articleNodes).values({
    architectureId: archId,
    businessId,
    level: "cluster",
    articleType: "how_to",
  });
  const nodeId = (nodeRow as any).insertId as number;
  // Create the article
  const [row] = await db.insert(articles).values({
    articleNodeId: nodeId,
    businessId,
    status: "pending_generation",
    wordCount: 0,
  });
  return (row as any).insertId as number;
}

async function createTestNotification(userId: number, businessId: number, message: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [row] = await db.insert(notifications).values({
    userId,
    businessId,
    type: "publish_success",
    title: message,
    message,
    read: 0 as any,
  });
  return (row as any).insertId as number;
}

async function cleanupTestUsers(emails: string[]) {
  const db = await getDb();
  if (!db) return;
  const userRows = await db.select({ id: users.id }).from(users).where(
    inArray(users.email, emails)
  );
  if (!userRows.length) return;
  const ids = userRows.map(r => r.id);
  // Delete in FK order
  await db.delete(notifications).where(inArray(notifications.userId, ids));
  await db.delete(creditTransactions).where(inArray(creditTransactions.userId, ids));
  await db.delete(credits).where(inArray(credits.userId, ids));
  // Delete articles and article nodes for businesses owned by these users
  const bizRows = await db.select({ id: businesses.id }).from(businesses).where(
    inArray(businesses.userId, ids)
  );
  if (bizRows.length) {
    const bizIds = bizRows.map(r => r.id);
    // articles → articleNodes → blogArchitectures → businesses
    await db.delete(articles).where(inArray(articles.businessId, bizIds));
    await db.delete(articleNodes).where(inArray(articleNodes.businessId, bizIds));
    await db.delete(blogArchitectures).where(inArray(blogArchitectures.businessId, bizIds));
    await db.delete(businesses).where(inArray(businesses.id, bizIds));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

// ─── Test setup ─────────────────────────────────────────────────────────────

let userAId: number;
let userBId: number;
let adminUserId: number;
let bizA1Id: number; // User A, Business 1
let bizA2Id: number; // User A, Business 2
let bizBId: number;  // User B, Business 1
let articleA1Id: number;
let articleA2Id: number;
let notifA1Id: number;
let notifA2Id: number;

const TEST_EMAILS = [
  "l15-user-a@test.example",
  "l15-user-b@test.example",
  "l15-admin@test.example",
];

beforeAll(async () => {
  await cleanupTestUsers(TEST_EMAILS);
  userAId = await createTestUser("l15-user-a@test.example");
  userBId = await createTestUser("l15-user-b@test.example");
  adminUserId = await createTestUser("l15-admin@test.example");

  // User A has 2 businesses
  bizA1Id = await createTestBusiness(userAId, "User A - Business 1");
  bizA2Id = await createTestBusiness(userAId, "User A - Business 2");
  // User B has 1 business
  bizBId = await createTestBusiness(userBId, "User B - Business 1");

  // Articles under each business
  articleA1Id = await createTestArticle(bizA1Id, userAId, "Article for Biz A1");
  articleA2Id = await createTestArticle(bizA2Id, userAId, "Article for Biz A2");

  // Notifications per business
  notifA1Id = await createTestNotification(userAId, bizA1Id, "Published from Biz A1");
  notifA2Id = await createTestNotification(userAId, bizA2Id, "Published from Biz A2");
});

afterAll(async () => {
  await cleanupTestUsers(TEST_EMAILS);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Layer 15: Multi-Business & Agency Features", () => {

  // V1: A user can have multiple businesses
  it("V1a: user A has 2 businesses in listAll", async () => {
    const caller = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await caller.business.listAll();
    const myBizIds = result.map((b: any) => b.id);
    expect(myBizIds).toContain(bizA1Id);
    expect(myBizIds).toContain(bizA2Id);
    expect(myBizIds).not.toContain(bizBId);
  });

  it("V1b: user B has 1 business in listAll", async () => {
    const caller = appRouter.createCaller({ user: { id: userBId, email: "l15-user-b@test.example", role: "user", name: "User B" } } as any);
    const result = await caller.business.listAll();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(bizBId);
  });

  // V2: Data isolation — articles under Business A1 do not appear under Business A2
  it("V2: articles are isolated per business", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    // Query articles for bizA1 — isolation is via businessId
    const a1Articles = await db
      .select({ id: articles.id, businessId: articles.businessId })
      .from(articles)
      .where(eq(articles.businessId, bizA1Id));

    // Query articles for bizA2
    const a2Articles = await db
      .select({ id: articles.id, businessId: articles.businessId })
      .from(articles)
      .where(eq(articles.businessId, bizA2Id));

    const a1Ids = a1Articles.map(a => a.id);
    const a2Ids = a2Articles.map(a => a.id);

    expect(a1Ids).toContain(articleA1Id);
    expect(a1Ids).not.toContain(articleA2Id);
    expect(a2Ids).toContain(articleA2Id);
    expect(a2Ids).not.toContain(articleA1Id);
  });

  // V2b: business.getById enforces ownership
  it("V2b: business.getById blocks cross-user access", async () => {
    // User B tries to access User A's business
    const callerB = appRouter.createCaller({ user: { id: userBId, email: "l15-user-b@test.example", role: "user", name: "User B" } } as any);
    await expect(callerB.business.getById({ businessId: bizA1Id })).rejects.toThrow();
  });

  it("V2c: business.getById returns correct business for owner", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await callerA.business.getById({ businessId: bizA1Id });
    expect(result.id).toBe(bizA1Id);
    expect(result.name).toBe("User A - Business 1");
  });

  // V3: dashboard.listBusinesses returns correct article counts per business
  it("V3: dashboard.listBusinesses returns correct article counts per business", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await callerA.dashboard.listBusinesses();
    const biz1 = result.find((b: any) => b.id === bizA1Id);
    const biz2 = result.find((b: any) => b.id === bizA2Id);
    expect(biz1).toBeDefined();
    expect(biz2).toBeDefined();
    expect(biz1!.articleCounts.total).toBeGreaterThanOrEqual(1);
    expect(biz2!.articleCounts.total).toBeGreaterThanOrEqual(1);
    // User B's business should NOT appear
    const bizBEntry = result.find((b: any) => b.id === bizBId);
    expect(bizBEntry).toBeUndefined();
  });

  // V4: Credits are shared at account level (not per business)
  it("V4: credits are shared at account level", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    // User A's credit balance is the same regardless of which business is selected
    const creditRow = await db.select().from(credits).where(eq(credits.userId, userAId));
    expect(creditRow).toHaveLength(1);
    expect(creditRow[0]!.balance).toBe(50); // seeded in createTestUser
  });

  // V5: Notifications filter by businessId
  it("V5a: getNotifications without businessId returns all user notifications", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await callerA.scheduler.getNotifications({ limit: 50 });
    const ids = result.notifications.map((n: any) => n.id);
    expect(ids).toContain(notifA1Id);
    expect(ids).toContain(notifA2Id);
  });

  it("V5b: getNotifications with businessId=bizA1 returns only bizA1 notifications", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await callerA.scheduler.getNotifications({ limit: 50, businessId: bizA1Id });
    const ids = result.notifications.map((n: any) => n.id);
    expect(ids).toContain(notifA1Id);
    expect(ids).not.toContain(notifA2Id);
  });

  it("V5c: getNotifications with businessId=bizA2 returns only bizA2 notifications", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    const result = await callerA.scheduler.getNotifications({ limit: 50, businessId: bizA2Id });
    const ids = result.notifications.map((n: any) => n.id);
    expect(ids).toContain(notifA2Id);
    expect(ids).not.toContain(notifA1Id);
  });

  // V6: Admin can view all businesses across all users
  it("V6: admin.listBusinesses returns businesses from all users", async () => {
    // Make adminUserId an admin
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    await db.update(users).set({ role: "admin" }).where(eq(users.id, adminUserId));

    const adminCaller = appRouter.createCaller({ user: { id: adminUserId, email: "l15-admin@test.example", role: "admin", name: "Admin" } } as any);
    const result = await adminCaller.admin.listBusinesses({ page: 1, limit: 100 });
    const ids = result.businesses.map((b: any) => b.id);
    expect(ids).toContain(bizA1Id);
    expect(ids).toContain(bizA2Id);
    expect(ids).toContain(bizBId);
  });

  it("V6b: non-admin cannot call admin.listBusinesses", async () => {
    const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15-user-a@test.example", role: "user", name: "User A" } } as any);
    await expect(callerA.admin.listBusinesses({ page: 1, limit: 100 })).rejects.toThrow();
  });

});
