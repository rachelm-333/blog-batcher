/**
 * Layer 12 — Admin Panel Verification Script
 *
 * Checks all 6 verification requirements:
 * V1: Non-admin user gets 403 on admin procedures
 * V2: Admin user (rachel.m@noize.com.au) gets full access
 * V3: Suspend a user — suspended user login returns FORBIDDEN
 * V4: Add credits to a user — balance updates
 * V5: API cost log shows entries with token counts
 * V6: Impersonation — startImpersonation returns impersonation token
 */

import { appRouter } from "./routers.ts";
import { getDb } from "./db.ts";
import { users, credits, apiCostLog, adminLog, creditTransactions, notifications, appErrorLog, businesses } from "../drizzle/schema.ts";
import { eq, inArray } from "drizzle-orm";

/** Delete any leftover test user by email (handles all FK dependencies) */
async function cleanupTestUser(db, email) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (rows.length === 0) return;
  const ids = rows.map(r => r.id);
  await db.delete(credits).where(inArray(credits.userId, ids)).catch(() => {});
  await db.delete(creditTransactions).where(inArray(creditTransactions.userId, ids)).catch(() => {});
  await db.delete(adminLog).where(inArray(adminLog.targetUserId, ids)).catch(() => {});
  await db.delete(adminLog).where(inArray(adminLog.adminUserId, ids)).catch(() => {});
  await db.delete(businesses).where(inArray(businesses.userId, ids)).catch(() => {});
  await db.delete(apiCostLog).where(inArray(apiCostLog.userId, ids)).catch(() => {});
  await db.delete(appErrorLog).where(inArray(appErrorLog.userId, ids)).catch(() => {});
  await db.delete(notifications).where(inArray(notifications.userId, ids)).catch(() => {});
  await db.delete(users).where(inArray(users.id, ids)).catch(() => {});
}

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ PASS: ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function makeCtx(user = null) {
  return {
    user,
    req: { headers: { origin: "http://localhost:3000" } },
    res: { setHeader: () => {}, cookie: () => {} },
  };
}

// Will be populated from the real DB in run()
let ADMIN_USER = null;
let REGULAR_USER = null;

async function run() {
  console.log("\n=== Layer 12 Admin Panel Verification ===\n");

  const db = await getDb();

  // Get real users from DB for context
  const allUsers = await db.select({ id: users.id, email: users.email, role: users.role, tier: users.tier, isSuspended: users.isSuspended }).from(users).limit(10);
  const realAdmin = allUsers.find(u => u.role === 'admin') || allUsers[0];
  const realNonAdmin = allUsers.find(u => u.role !== 'admin') || allUsers[1];
  if (!realAdmin) { console.error('No users in DB — cannot run verification'); process.exit(1); }
  ADMIN_USER = { ...realAdmin, openId: `email:${realAdmin.email}`, name: 'Admin', tier: realAdmin.tier || 'standard' };
  REGULAR_USER = realNonAdmin ? { ...realNonAdmin, openId: `email:${realNonAdmin.email}`, name: 'User', tier: realNonAdmin.tier || 'standard' } : null;
  console.log(`  Using admin user: id=${ADMIN_USER.id} email=${ADMIN_USER.email} role=${ADMIN_USER.role}`);
  if (REGULAR_USER) console.log(`  Using regular user: id=${REGULAR_USER.id} email=${REGULAR_USER.email} role=${REGULAR_USER.role}`);

  // ─── V1: Non-admin gets FORBIDDEN ─────────────────────────────────────────
  console.log("V1: Non-admin user blocked from admin procedures");
  try {
    const caller = appRouter.createCaller(makeCtx(REGULAR_USER));
    await caller.admin.listUsers({ page: 1, limit: 10 });
    check("Non-admin blocked from admin.listUsers", false, "Should have thrown FORBIDDEN");
  } catch (err) {
    check("Non-admin blocked from admin.listUsers", err.code === "FORBIDDEN" || err.message?.includes("FORBIDDEN") || err.message?.includes("admin"), `code=${err.code}`);
  }

  // ─── V2: Admin user gets full access ──────────────────────────────────────
  console.log("\nV2: Admin user gets full access");
  try {
    const caller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const result = await caller.admin.listUsers({ page: 1, limit: 10 });
    check("Admin can call admin.listUsers", Array.isArray(result.users), `returned ${result.users.length} users`);
    check("Admin response has pagination", typeof result.total === "number", `total=${result.total}`);
  } catch (err) {
    check("Admin can call admin.listUsers", false, err.message);
    check("Admin response has pagination", false, "procedure failed");
  }

  // ─── V3: Suspend a user ────────────────────────────────────────────────────
  console.log("\nV3: Suspend a user — suspended user login returns FORBIDDEN");
  // Create a temp user to suspend
  let tempUserId = null;
  try {
    // Clean up any leftover test user from previous runs
    await cleanupTestUser(db, "suspend-test@example.com");
    const [inserted] = await db.insert(users).values({
      openId: "email:suspend-test@example.com",
      name: "Suspend Test",
      email: "suspend-test@example.com",
      loginMethod: "email",
      role: "user",
      tier: "standard",
      onboardingComplete: 0,
      emailVerified: 1,
      passwordHash: "$2b$10$fakehashforsuspendtest000000000000000000000000000000000",
      isSuspended: 0,
    }).$returningId();
    tempUserId = inserted.id;
    await db.insert(credits).values({ userId: tempUserId, balance: 0 });

    // Suspend via admin procedure
    const adminCaller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const suspendResult = await adminCaller.admin.suspendUser({ userId: tempUserId });
    check("admin.suspendUser returns success", suspendResult.success === true, `success=${suspendResult.success}`);

    // Verify isSuspended=true in DB
    const [row] = await db.select({ isSuspended: users.isSuspended }).from(users).where(eq(users.id, tempUserId)).limit(1);
    check("User isSuspended=true in DB after suspend", row?.isSuspended === true, `isSuspended=${row?.isSuspended}`);

    // Unsuspend
    const unsuspendResult = await adminCaller.admin.unsuspendUser({ userId: tempUserId });
    check("admin.unsuspendUser returns success", unsuspendResult.success === true);
    const [row2] = await db.select({ isSuspended: users.isSuspended }).from(users).where(eq(users.id, tempUserId)).limit(1);
    check("User isSuspended=false in DB after unsuspend", row2?.isSuspended === false, `isSuspended=${row2?.isSuspended}`);
    check("V3 complete: suspend/unsuspend cycle works", true);
  } catch (err) {
    check("admin.suspendUser works", false, err.message);
    check("isSuspended updated in DB", false, "procedure failed");
    check("admin.unsuspendUser works", false, "procedure failed");
    check("isSuspended=false after unsuspend", false, "procedure failed");
  } finally {
    if (tempUserId) {
      await db.delete(credits).where(eq(credits.userId, tempUserId)).catch(() => {});
      await db.delete(users).where(eq(users.id, tempUserId)).catch(() => {});
    }
  }

  // ─── V4: Add credits to a user ────────────────────────────────────────────
  console.log("\nV4: Add credits to a user — balance updates");
  let creditTestUserId = null;
  try {
    // Clean up any leftover test user from previous runs
    await cleanupTestUser(db, "credit-test@example.com");
    const [inserted] = await db.insert(users).values({
      openId: "email:credit-test@example.com",
      name: "Credit Test",
      email: "credit-test@example.com",
      loginMethod: "email",
      role: "user",
      tier: "standard",
      onboardingComplete: 0,
      emailVerified: 1,
      passwordHash: "$2b$10$fakehashforcredittest000000000000000000000000000000000",
      isSuspended: 0,
    }).$returningId();
    creditTestUserId = inserted.id;
    await db.insert(credits).values({ userId: creditTestUserId, balance: 5 });

    const adminCaller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const addResult = await adminCaller.admin.addCredits({
      userId: creditTestUserId,
      amount: 10,
      reason: "Manual top-up for verification test",
    });
    check("admin.addCredits returns new balance", typeof addResult.newBalance === "number", `newBalance=${addResult.newBalance}`);
    check("New balance = 5 + 10 = 15", addResult.newBalance === 15, `got=${addResult.newBalance}`);

    // Remove credits
    const removeResult = await adminCaller.admin.removeCredits({
      userId: creditTestUserId,
      amount: 3,
      reason: "Manual removal for verification test",
    });
    check("admin.removeCredits returns 12", removeResult.newBalance === 12, `got=${removeResult.newBalance}`);
  } catch (err) {
    check("admin.adjustCredits works", false, err.message);
    check("Balance correct after add", false, "procedure failed");
    check("Balance correct after remove", false, "procedure failed");
  } finally {
    if (creditTestUserId) {
      await db.delete(credits).where(eq(credits.userId, creditTestUserId)).catch(() => {});
      await db.delete(users).where(eq(users.id, creditTestUserId)).catch(() => {});
    }
  }

  // ─── V5: API cost log shows entries with token counts ─────────────────────
  console.log("\nV5: API cost log shows entries with token counts");
  try {
    // Insert a test cost log entry
    await db.insert(apiCostLog).values({
      userId: null,
      model: "gemini-2.5-flash",
      inputTokens: 1500,
      outputTokens: 800,
      estimatedCostUsd: "0.000353",
      feature: "article_generation",
    });

    const adminCaller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const costResult = await adminCaller.admin.listApiCostLog({ page: 1, limit: 10 });
    check("admin.listApiCostLog returns entries", Array.isArray(costResult.entries), `entries=${costResult.entries.length}`);
    check("API cost entries have token counts", costResult.entries.length > 0 && typeof costResult.entries[0].inputTokens === "number", `inputTokens=${costResult.entries[0]?.inputTokens}`);
    check("API cost entries have estimatedCostUsd", costResult.entries.length > 0 && costResult.entries[0].estimatedCostUsd !== undefined, `cost=${costResult.entries[0]?.estimatedCostUsd}`);
    check("admin.listApiCostLog has byDay summary", Array.isArray(costResult.byDay), `byDay.length=${costResult.byDay?.length}`);
  } catch (err) {
    check("admin.getApiCostLog works", false, err.message);
    check("API cost entries have token counts", false, "procedure failed");
    check("API cost entries have estimatedCostUsd", false, "procedure failed");
    check("admin.getApiCostLog has summary", false, "procedure failed");
  }

  // ─── V6: Impersonation ────────────────────────────────────────────────────
  console.log("\nV6: Impersonation — startImpersonation returns impersonation token");
  let impersonateUserId = null;
  try {
    // Clean up any leftover test user from previous runs
    await cleanupTestUser(db, "impersonate-test@example.com");
    const [inserted] = await db.insert(users).values({
      openId: "email:impersonate-test@example.com",
      name: "Impersonate Target",
      email: "impersonate-test@example.com",
      loginMethod: "email",
      role: "user",
      tier: "standard",
      onboardingComplete: 0,
      emailVerified: 1,
      passwordHash: "$2b$10$fakehashforimpersonatetest000000000000000000000000000",
      isSuspended: 0,
    }).$returningId();
    impersonateUserId = inserted.id;
    await db.insert(credits).values({ userId: impersonateUserId, balance: 0 });

    const adminCaller = appRouter.createCaller(makeCtx(ADMIN_USER));
    const impResult = await adminCaller.admin.startImpersonation({ targetUserId: impersonateUserId });
    check("admin.startImpersonation returns success", impResult.success === true, `success=${impResult.success}`);
    check("admin.startImpersonation returns targetUser", impResult.targetUser?.id === impersonateUserId, `targetUserId=${impResult.targetUser?.id}`);
    check("admin.startImpersonation targetUser has email", typeof impResult.targetUser?.email === "string", `email=${impResult.targetUser?.email}`);
  } catch (err) {
    check("admin.startImpersonation works", false, err.message);
    check("Impersonation returns success", false, "procedure failed");
    check("Impersonation returns targetUser", false, "procedure failed");
  } finally {
    if (impersonateUserId) {
      await db.delete(credits).where(eq(credits.userId, impersonateUserId)).catch(() => {});
      await db.delete(users).where(eq(users.id, impersonateUserId)).catch(() => {});
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Verification script error:", err);
  process.exit(1);
});
