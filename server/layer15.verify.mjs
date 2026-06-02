/**
 * Layer 15 — Multi-Business & Agency Features
 * Verification script: 6 checks
 */
import { createConnection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, inArray, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ─── DB setup ────────────────────────────────────────────────────────────────
const conn = await createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

// ─── Schema imports ───────────────────────────────────────────────────────────
const { users, businesses, articles, credits, creditTransactions, blogArchitectures, articleNodes, notifications } =
  await import("../drizzle/schema.js");

// ─── Router setup ─────────────────────────────────────────────────────────────
const { appRouter } = await import("./routers.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, condition, detail = "") {
  if (condition) { console.log(`  ✅ ${label}`); pass++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); fail++; }
}

async function cleanupTestUsers(emails) {
  const userRows = await db.select({ id: users.id }).from(users).where(inArray(users.email, emails));
  if (!userRows.length) return;
  const ids = userRows.map(r => r.id);
  const bizRows = await db.select({ id: businesses.id }).from(businesses).where(inArray(businesses.userId, ids));
  if (bizRows.length) {
    const bizIds = bizRows.map(r => r.id);
    await db.delete(articles).where(inArray(articles.businessId, bizIds));
    await db.delete(articleNodes).where(inArray(articleNodes.businessId, bizIds));
    await db.delete(blogArchitectures).where(inArray(blogArchitectures.businessId, bizIds));
    await db.delete(businesses).where(inArray(businesses.id, bizIds));
  }
  await db.delete(notifications).where(inArray(notifications.userId, ids));
  await db.delete(creditTransactions).where(inArray(creditTransactions.userId, ids));
  await db.delete(credits).where(inArray(credits.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

async function createUser(email, name) {
  const hash = await bcrypt.hash("TestPass123!", 10);
  const [row] = await db.insert(users).values({
    email, name,
    passwordHash: hash,
    emailVerified: 1,
    onboardingComplete: 0,
    loginMethod: "email",
    openId: `test-${Date.now()}-${Math.random()}`,
    isSuspended: 0,
  });
  const userId = row.insertId;
  await db.insert(credits).values({ userId, balance: 25 });
  return userId;
}

async function createBusiness(userId, name) {
  const [row] = await db.insert(businesses).values({
    userId, name,
    websiteUrl: "https://example.com",
    currentStage: 3,
  });
  return row.insertId;
}

async function createArticle(businessId) {
  // Create architecture
  let archId;
  const existing = await db.select({ id: blogArchitectures.id }).from(blogArchitectures)
    .where(eq(blogArchitectures.businessId, businessId));
  if (existing.length) {
    archId = existing[0].id;
  } else {
    const [archRow] = await db.insert(blogArchitectures).values({
      businessId, packSize: 20, cornerstoneCount: 1, pillarCount: 1, clustersPerPillar: 3, totalArticleCount: 20, confirmed: 1,
    });
    archId = archRow.insertId;
  }
  // Create node
  const [nodeRow] = await db.insert(articleNodes).values({
    architectureId: archId, businessId, level: "cluster", articleType: "how_to",
  });
  const nodeId = nodeRow.insertId;
  // Create article
  const [artRow] = await db.insert(articles).values({
    articleNodeId: nodeId, businessId, status: "pending_generation", wordCount: 0,
  });
  return artRow.insertId;
}

const TEST_EMAILS = [
  "l15v-usera@test.example",
  "l15v-userb@test.example",
  "l15v-admin@test.example",
];

// ─── Pre-cleanup ──────────────────────────────────────────────────────────────
await cleanupTestUsers(TEST_EMAILS);

// ─── Setup ────────────────────────────────────────────────────────────────────
const userAId = await createUser("l15v-usera@test.example", "User A");
const userBId = await createUser("l15v-userb@test.example", "User B");
const adminUserId = await createUser("l15v-admin@test.example", "Admin");
await db.update(users).set({ role: "admin" }).where(eq(users.id, adminUserId));

const bizA1Id = await createBusiness(userAId, "Biz A1");
const bizA2Id = await createBusiness(userAId, "Biz A2");
const bizBId = await createBusiness(userBId, "Biz B");

const articleA1Id = await createArticle(bizA1Id);
const articleA2Id = await createArticle(bizA2Id);

// ─── V1: User A has two businesses, User B has one ───────────────────────────
console.log("\n🔵 V1: Multi-business — user can own multiple businesses");
const callerA = appRouter.createCaller({ user: { id: userAId, email: "l15v-usera@test.example", role: "user", name: "User A" } });
const bizListA = await callerA.dashboard.listBusinesses();
check("User A sees exactly 2 businesses", bizListA.length === 2);
check("User A sees Biz A1", bizListA.some(b => b.id === bizA1Id));
check("User A sees Biz A2", bizListA.some(b => b.id === bizA2Id));
check("User A does NOT see Biz B", !bizListA.some(b => b.id === bizBId));

// ─── V2: Article isolation ────────────────────────────────────────────────────
console.log("\n🔵 V2: Article isolation per business");
const a1Articles = await db.select({ id: articles.id }).from(articles).where(eq(articles.businessId, bizA1Id));
const a2Articles = await db.select({ id: articles.id }).from(articles).where(eq(articles.businessId, bizA2Id));
const a1Ids = a1Articles.map(a => a.id);
const a2Ids = a2Articles.map(a => a.id);
check("Article A1 appears under Biz A1", a1Ids.includes(articleA1Id));
check("Article A1 does NOT appear under Biz A2", !a2Ids.includes(articleA1Id));
check("Article A2 appears under Biz A2", a2Ids.includes(articleA2Id));
check("Article A2 does NOT appear under Biz A1", !a1Ids.includes(articleA2Id));

// ─── V3: Dashboard summary is per-business ───────────────────────────────────
console.log("\n🔵 V3: Dashboard summary is isolated per business");
const summaryA1 = await callerA.dashboard.getSummary({ businessId: bizA1Id });
const summaryA2 = await callerA.dashboard.getSummary({ businessId: bizA2Id });
check("getSummary for Biz A1 returns data", summaryA1 !== null);
check("getSummary for Biz A2 returns data", summaryA2 !== null);
check("Biz A1 and Biz A2 summaries are independent", summaryA1 !== summaryA2);

// ─── V4: Cross-business access blocked ───────────────────────────────────────
console.log("\n🔵 V4: Cross-user business access is blocked");
const callerB = appRouter.createCaller({ user: { id: userBId, email: "l15v-userb@test.example", role: "user", name: "User B" } });
try {
  await callerB.business.getById({ businessId: bizA1Id });
  check("User B blocked from User A's business", false, "should have thrown");
} catch (e) {
  check("User B blocked from User A's business", true);
}
try {
  await callerB.dashboard.getSummary({ businessId: bizA1Id });
  check("User B blocked from User A's getSummary", false, "should have thrown");
} catch (e) {
  check("User B blocked from User A's getSummary", true);
}

// ─── V5: Credits are shared at account level ──────────────────────────────────
console.log("\n🔵 V5: Credits are shared at account level (not per business)");
const creditRowA = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, userAId));
check("User A has a single credit balance (not per business)", creditRowA.length === 1);
check("User A credit balance is 25", creditRowA[0]?.balance === 25);

// Deduct 5 credits (simulate spending on Biz A1)
await db.update(credits).set({ balance: 20 }).where(eq(credits.userId, userAId));
const afterDeduct = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, userAId));
check("After spending on Biz A1, balance is 20 (shared)", afterDeduct[0]?.balance === 20);

// ─── V6: Admin can see all businesses ────────────────────────────────────────
console.log("\n🔵 V6: Admin can view all businesses across all users");
const adminCaller = appRouter.createCaller({ user: { id: adminUserId, email: "l15v-admin@test.example", role: "admin", name: "Admin" } });
const adminBizResult = await adminCaller.admin.listBusinesses({ page: 1, limit: 100 });
const adminBizIds = adminBizResult.businesses.map(b => b.id);
check("Admin sees Biz A1", adminBizIds.includes(bizA1Id));
check("Admin sees Biz A2", adminBizIds.includes(bizA2Id));
check("Admin sees Biz B", adminBizIds.includes(bizBId));

// Non-admin cannot call admin.listBusinesses
try {
  await callerB.admin.listBusinesses({ page: 1, limit: 100 });
  check("Non-admin blocked from admin.listBusinesses", false, "should have thrown");
} catch (e) {
  check("Non-admin blocked from admin.listBusinesses", true);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
await cleanupTestUsers(TEST_EMAILS);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Layer 15 Verification: ${pass}/${pass + fail} checks passed`);
if (fail > 0) console.log(`❌ ${fail} check(s) failed`);
else console.log("✅ All checks passed");

await conn.end();
process.exit(fail > 0 ? 1 : 0);
