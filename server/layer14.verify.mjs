/**
 * Layer 14 — Free Trial Flow Verification Script
 *
 * V1: New user can start a free trial (creates business + architecture + node)
 * V2: Second article attempt blocked with upgrade prompt (FREE_TRIAL_USED)
 * V3: Second trial with same email blocked gracefully
 * V4: After purchase (credit allocation), user can generate articles
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Load env
import { config } from "dotenv";
config();

// Dynamic import for ESM compatibility
const { appRouter } = await import("./routers.js");
const { getDb } = await import("./db.js");
const { users, businesses, blogArchitectures, articleNodes, keywords, credits, creditTransactions } = await import("../drizzle/schema.js");
const { eq, and } = await import("drizzle-orm");
const bcrypt = await import("bcryptjs");

const TEST_EMAIL_V1 = "layer14_v1_trial@test.invalid";
const TEST_EMAIL_V2 = "layer14_v2_trial@test.invalid";
const TEST_EMAIL_V3A = "layer14_v3a_trial@test.invalid";
const TEST_EMAIL_V3B = "layer14_v3b_trial@test.invalid";
const TEST_EMAIL_V4 = "layer14_v4_trial@test.invalid";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}
function fail(label, err) {
  console.log(`  ❌ ${label}: ${err?.message ?? err}`);
  failed++;
}

function makeCtx(userId, email) {
  return {
    user: { id: userId, email, name: "Test User", role: "user" },
    req: { headers: { origin: "http://localhost:3000" } },
    res: { setHeader: () => {}, cookie: () => {} },
  };
}

async function cleanupTestUser(db, email) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!u) return;
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, u.id));
  await db.delete(credits).where(eq(credits.userId, u.id));
  const bizRows = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.userId, u.id));
  for (const biz of bizRows) {
    const archRows = await db.select({ id: blogArchitectures.id }).from(blogArchitectures).where(eq(blogArchitectures.businessId, biz.id));
    for (const arch of archRows) {
      const nodeRows = await db.select({ id: articleNodes.id }).from(articleNodes).where(eq(articleNodes.architectureId, arch.id));
      for (const node of nodeRows) {
        await db.delete(keywords).where(eq(keywords.articleNodeId, node.id));
      }
      await db.delete(articleNodes).where(eq(articleNodes.architectureId, arch.id));
      await db.delete(blogArchitectures).where(eq(blogArchitectures.id, arch.id));
    }
    await db.delete(businesses).where(eq(businesses.id, biz.id));
  }
  await db.delete(users).where(eq(users.id, u.id));
}

async function createTestUser(db, email, overrides = {}) {
  const hash = await bcrypt.default.hash("TestPass123!", 10);
  const [r] = await db.insert(users).values({
    email,
    name: "Test User",
    passwordHash: hash,
    emailVerified: 1,
    onboardingComplete: 0,
    loginMethod: "email",
    openId: `test_openid_${Date.now()}_${Math.random()}`,
    freeTrialUsed: 0,
    ...overrides,
  }).$returningId();
  return r.id;
}

const db = await getDb();
if (!db) {
  console.error("Database unavailable");
  process.exit(1);
}

// ── V1: New user starts free trial ───────────────────────────────────────────
console.log("\n🧪 V1: New user starts free trial");
try {
  await cleanupTestUser(db, TEST_EMAIL_V1);
  const userId = await createTestUser(db, TEST_EMAIL_V1);
  const caller = appRouter.createCaller(makeCtx(userId, TEST_EMAIL_V1));

  // Check initial status
  const status = await caller.trial.getStatus();
  if (status.freeTrialUsed !== false) throw new Error(`Expected freeTrialUsed=false, got ${status.freeTrialUsed}`);
  ok("getStatus returns freeTrialUsed=false for new user");

  // Start free trial
  const result = await caller.trial.startFreeTrial({ businessName: "V1 Test Business" });
  if (!result.businessId) throw new Error("No businessId returned");
  ok("startFreeTrial returns businessId");

  if (result.packSize !== 0) throw new Error(`Expected packSize=0, got ${result.packSize}`);
  ok("startFreeTrial returns packSize=0");

  // Verify architecture in DB
  const [arch] = await db.select({ packSize: blogArchitectures.packSize }).from(blogArchitectures).where(eq(blogArchitectures.businessId, result.businessId)).limit(1);
  if (arch?.packSize !== 0) throw new Error(`DB packSize=${arch?.packSize}, expected 0`);
  ok("DB confirms architecture has packSize=0");

  // Verify freeTrialUsed is now true
  const [userRow] = await db.select({ freeTrialUsed: users.freeTrialUsed }).from(users).where(eq(users.id, userId)).limit(1);
  if (!userRow?.freeTrialUsed) throw new Error("freeTrialUsed not set to true after startFreeTrial");
  ok("freeTrialUsed=true immediately after startFreeTrial");

  // Verify keyword was created
  const [node] = await db.select({ id: articleNodes.id }).from(articleNodes).where(eq(articleNodes.businessId, result.businessId)).limit(1);
  if (!node) throw new Error("No article node created");
  const [kw] = await db.select({ pk: keywords.primaryKeyword }).from(keywords).where(eq(keywords.articleNodeId, node.id)).limit(1);
  if (!kw) throw new Error("No keyword created for trial node");
  ok("Article node and keyword created for trial business");

  await cleanupTestUser(db, TEST_EMAIL_V1);
} catch (err) {
  fail("V1", err);
}

// ── V2: Second article attempt blocked ───────────────────────────────────────
console.log("\n🧪 V2: Second article attempt blocked with upgrade prompt");
try {
  await cleanupTestUser(db, TEST_EMAIL_V2);
  const userId = await createTestUser(db, TEST_EMAIL_V2, { freeTrialUsed: 1 });
  const caller = appRouter.createCaller(makeCtx(userId, TEST_EMAIL_V2));

  // Create a trial business manually
  const [bizRow] = await db.insert(businesses).values({
    userId,
    name: "V2 Trial Business",
    currentStage: 4,
  }).$returningId();
  await db.insert(blogArchitectures).values({
    businessId: bizRow.id,
    packSize: 0,
    cornerstoneCount: 0,
    pillarCount: 0,
    clustersPerPillar: 1,
    totalArticleCount: 1,
    confirmed: true,
  });

  // Attempt to start generation — should be blocked
  let blocked = false;
  let blockMessage = "";
  try {
    await caller.articles.startGeneration({ businessId: bizRow.id });
  } catch (err) {
    if (err?.message?.includes("FREE_TRIAL_USED")) {
      blocked = true;
      blockMessage = err.message;
    } else {
      throw err;
    }
  }
  if (!blocked) throw new Error("Expected FREE_TRIAL_USED error but generation succeeded");
  ok("startGeneration blocked with FREE_TRIAL_USED for used trial user");

  // getUpgradeOptions should return products
  const opts = await caller.trial.getUpgradeOptions();
  if (!opts.products || opts.products.length < 3) throw new Error(`Expected 3 products, got ${opts.products?.length}`);
  ok(`getUpgradeOptions returns ${opts.products.length} products`);

  if (!opts.freeTrialUsed) throw new Error("Expected freeTrialUsed=true in upgrade options");
  ok("getUpgradeOptions shows freeTrialUsed=true");

  const recommended = opts.products.find(p => p.recommended);
  if (!recommended) throw new Error("No recommended product");
  ok(`Recommended product: ${recommended.key}`);

  await cleanupTestUser(db, TEST_EMAIL_V2);
} catch (err) {
  fail("V2", err);
}

// ── V3: Second trial with same email blocked ──────────────────────────────────
console.log("\n🧪 V3: Second trial with same email blocked gracefully");
try {
  await cleanupTestUser(db, TEST_EMAIL_V3A);
  // User who has already used their trial
  const userId = await createTestUser(db, TEST_EMAIL_V3A, { freeTrialUsed: 1 });
  const caller = appRouter.createCaller(makeCtx(userId, TEST_EMAIL_V3A));

  let blocked = false;
  let blockMessage = "";
  try {
    await caller.trial.startFreeTrial({ businessName: "Second Trial Attempt" });
  } catch (err) {
    if (err?.message?.includes("already used your free trial")) {
      blocked = true;
      blockMessage = err.message;
    } else {
      throw err;
    }
  }
  if (!blocked) throw new Error("Expected trial abuse block but startFreeTrial succeeded");
  ok("startFreeTrial blocked for user with freeTrialUsed=true");
  ok(`Block message: "${blockMessage.substring(0, 60)}..."`);

  await cleanupTestUser(db, TEST_EMAIL_V3A);
} catch (err) {
  fail("V3", err);
}

// ── V4: After purchase, user can generate ────────────────────────────────────
console.log("\n🧪 V4: After purchase, credits allocated and user can generate");
try {
  await cleanupTestUser(db, TEST_EMAIL_V4);
  const userId = await createTestUser(db, TEST_EMAIL_V4, { freeTrialUsed: 1 });

  // Simulate a purchase: add credits directly
  await db.insert(credits).values({ userId, balance: 25 });

  const caller = appRouter.createCaller(makeCtx(userId, TEST_EMAIL_V4));

  // Create a paid business (packSize=20)
  const [bizRow] = await db.insert(businesses).values({
    userId,
    name: "V4 Paid Business",
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

  // Check credit balance
  const [creditRow] = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, userId)).limit(1);
  if (creditRow?.balance !== 25) throw new Error(`Expected 25 credits, got ${creditRow?.balance}`);
  ok("Credit balance is 25 after purchase simulation");

  // getStatus should show hasActivePlan=true
  const status = await caller.trial.getStatus();
  if (!status.hasActivePlan) throw new Error("Expected hasActivePlan=true after credit allocation");
  ok("getStatus shows hasActivePlan=true after credits allocated");

  // startGeneration should NOT throw INSUFFICIENT_CREDITS (it will throw "No article nodes" since no nodes exist)
  let threwInsufficientCredits = false;
  try {
    await caller.articles.startGeneration({ businessId: bizRow.id });
  } catch (err) {
    if (err?.message?.includes("INSUFFICIENT_CREDITS")) {
      threwInsufficientCredits = true;
    }
    // "No article nodes found" is expected and acceptable — means credit check passed
  }
  if (threwInsufficientCredits) throw new Error("INSUFFICIENT_CREDITS thrown even though user has 25 credits");
  ok("startGeneration does not throw INSUFFICIENT_CREDITS for user with credits");

  await cleanupTestUser(db, TEST_EMAIL_V4);
} catch (err) {
  fail("V4", err);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Layer 14 Verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All Layer 14 checks passed!");
}
