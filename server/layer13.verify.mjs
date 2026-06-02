/**
 * server/layer13.verify.mjs
 * Layer 13: Stripe Payments — verification script.
 *
 * V1: getProducts returns all 3 products with correct prices/credits
 * V2: createCheckoutSession requires authentication (unauthenticated call returns UNAUTHORIZED)
 * V3: allocateCreditsOnPayment allocates correct credits for each product
 * V4: allocateCreditsOnPayment is idempotent (same eventId does not double-allocate)
 * V5: recordFailedPayment writes a failed row without allocating credits
 * V6: getPaymentHistory returns the user's payments
 *
 * Run: npx tsx server/layer13.verify.mjs
 */
import { appRouter } from "./routers.js";
import { getDb } from "./db.js";
import { users, credits, stripePayments, creditTransactions } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { allocateCreditsOnPayment, recordFailedPayment } from "./stripe/allocate.js";
import { PRODUCTS } from "./stripe/products.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ── Test user fixture ─────────────────────────────────────────────────────────
const TEST_EMAIL = "layer13-verify@blogbatcher.test";
const TEST_OPEN_ID = "layer13-verify-openid-" + Date.now();
let testUserId;

async function cleanupTestUser(db) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (!rows.length) return;
  const uid = rows[0].id;
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, uid));
  await db.delete(stripePayments).where(eq(stripePayments.userId, uid));
  await db.delete(credits).where(eq(credits.userId, uid));
  await db.delete(users).where(eq(users.id, uid));
}

// ── V1: Product catalogue ─────────────────────────────────────────────────────
async function v1_products() {
  console.log("\n📦 V1: Product catalogue");
  const publicCaller = appRouter.createCaller({ user: null, req: {}, res: {} });
  const products = await publicCaller.payments.getProducts();
  check("Returns 3 products", products.length === 3);
  check("citation_starter has priceAud=9700", products.find(p => p.key === "citation_starter")?.priceAud === 9700);
  check("citation_authority has priceAud=19700", products.find(p => p.key === "citation_authority")?.priceAud === 19700);
  check("credit_topup has priceAud=2700", products.find(p => p.key === "credit_topup")?.priceAud === 2700);
  check("citation_starter has 25 credits", products.find(p => p.key === "citation_starter")?.credits === 25);
  check("citation_authority has 60 credits", products.find(p => p.key === "citation_authority")?.credits === 60);
  check("credit_topup has 5 credits", products.find(p => p.key === "credit_topup")?.credits === 5);
}

// ── V2: Auth guard ────────────────────────────────────────────────────────────
async function v2_authGuard() {
  console.log("\n🔐 V2: Auth guard");
  const publicCaller = appRouter.createCaller({ user: null, req: {}, res: {} });
  let blocked = false;
  try {
    await publicCaller.payments.createCheckoutSession({
      productKey: "citation_starter",
      origin: "https://example.com",
    });
  } catch (err) {
    if (err.code === "UNAUTHORIZED") blocked = true;
  }
  check("Unauthenticated createCheckoutSession returns UNAUTHORIZED", blocked);

  let historyBlocked = false;
  try {
    await publicCaller.payments.getPaymentHistory();
  } catch (err) {
    if (err.code === "UNAUTHORIZED") historyBlocked = true;
  }
  check("Unauthenticated getPaymentHistory returns UNAUTHORIZED", historyBlocked);
}

// ── V3: Credit allocation ─────────────────────────────────────────────────────
async function v3_allocation(db) {
  console.log("\n💳 V3: Credit allocation");

  const eventId = `evt_test_v3_${Date.now()}`;
  const sessionId = `cs_test_v3_${Date.now()}`;

  const result = await allocateCreditsOnPayment({
    userId: testUserId,
    productKey: "citation_starter",
    stripeEventId: eventId,
    stripeCheckoutSessionId: sessionId,
    stripeCustomerId: "cus_test_v3",
    amountCents: 9700,
  });

  check("allocateCreditsOnPayment returns success=true", result.success === true);
  check("alreadyProcessed=false on first call", result.alreadyProcessed === false);
  check("creditsAdded=25 for citation_starter", result.creditsAdded === 25);
  check("newBalance=25", result.newBalance === 25);

  // Verify DB
  const [creditRow] = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, testUserId)).limit(1);
  check("DB credit balance is 25", creditRow?.balance === 25);

  // Verify stripe_payments row
  const [payRow] = await db.select({ status: stripePayments.status, creditsAllocated: stripePayments.creditsAllocated })
    .from(stripePayments).where(eq(stripePayments.stripeEventId, eventId)).limit(1);
  check("stripe_payments row status=succeeded", payRow?.status === "succeeded");
  check("stripe_payments creditsAllocated=25", payRow?.creditsAllocated === 25);
}

// ── V4: Idempotency ───────────────────────────────────────────────────────────
async function v4_idempotency(db) {
  console.log("\n🔁 V4: Idempotency");

  // Use the same event ID from V3 (already processed)
  const eventId = `evt_test_v3_${Date.now() - 1000}`; // approximate — use a fresh one
  const sessionId = `cs_test_v4_${Date.now()}`;

  // First call
  const r1 = await allocateCreditsOnPayment({
    userId: testUserId,
    productKey: "credit_topup",
    stripeEventId: eventId,
    stripeCheckoutSessionId: sessionId,
    stripeCustomerId: "cus_test_v4",
    amountCents: 2700,
  });
  check("First call: alreadyProcessed=false", r1.alreadyProcessed === false);
  check("First call: creditsAdded=5", r1.creditsAdded === 5);

  // Second call with same eventId
  const r2 = await allocateCreditsOnPayment({
    userId: testUserId,
    productKey: "credit_topup",
    stripeEventId: eventId,
    stripeCheckoutSessionId: sessionId,
    stripeCustomerId: "cus_test_v4",
    amountCents: 2700,
  });
  check("Second call: alreadyProcessed=true", r2.alreadyProcessed === true);

  // Balance should be 25 + 5 = 30
  const [creditRow] = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, testUserId)).limit(1);
  check("Balance is 30 (not 35 — no double allocation)", creditRow?.balance === 30);
}

// ── V5: Failed payment ────────────────────────────────────────────────────────
async function v5_failedPayment(db) {
  console.log("\n❌ V5: Failed payment");

  const failedEventId = `evt_test_failed_${Date.now()}`;
  await recordFailedPayment({
    userId: testUserId,
    productKey: "citation_starter",
    stripeEventId: failedEventId,
    amountCents: 9700,
  });

  const [row] = await db.select({ status: stripePayments.status, creditsAllocated: stripePayments.creditsAllocated })
    .from(stripePayments).where(eq(stripePayments.stripeEventId, failedEventId)).limit(1);
  check("Failed payment row exists with status=failed", row?.status === "failed");
  check("Failed payment creditsAllocated=0", row?.creditsAllocated === 0);

  // Balance should still be 30
  const [creditRow] = await db.select({ balance: credits.balance }).from(credits).where(eq(credits.userId, testUserId)).limit(1);
  check("Balance unchanged at 30 after failed payment", creditRow?.balance === 30);

  // Idempotency for failed payment
  await recordFailedPayment({
    userId: testUserId,
    productKey: "citation_starter",
    stripeEventId: failedEventId,
    amountCents: 9700,
  });
  const rows = await db.select({ id: stripePayments.id }).from(stripePayments).where(eq(stripePayments.stripeEventId, failedEventId));
  check("Failed payment idempotent (only 1 row)", rows.length === 1);
}

// ── V6: Payment history ───────────────────────────────────────────────────────
async function v6_history(db) {
  console.log("\n📋 V6: Payment history");

  const userCaller = appRouter.createCaller({
    user: { id: testUserId, email: TEST_EMAIL, name: "Test", role: "user", tier: "standard", isSuspended: false },
    req: {},
    res: {},
  });

  const history = await userCaller.payments.getPaymentHistory();
  check("getPaymentHistory returns array", Array.isArray(history));
  check("History has at least 2 entries (from V3 and V4)", history.length >= 2);
  check("Each entry has amountAud field", history.every(h => typeof h.amountAud === "string"));
  check("Each entry has productLabel field", history.every(h => typeof h.productLabel === "string"));
  check("Each entry has status field", history.every(h => typeof h.status === "string"));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Layer 13: Stripe Payments — Verification ===\n");

  const db = await getDb();
  if (!db) {
    console.error("❌ Database unavailable");
    process.exit(1);
  }

  // Setup test user
  await cleanupTestUser(db);
  const [row] = await db.insert(users).values({
    openId: TEST_OPEN_ID,
    email: TEST_EMAIL,
    name: "Layer 13 Verify User",
    role: "user",
    tier: "standard",
    onboardingComplete: 0,
    emailVerified: 1,
    isSuspended: 0,
  });
  testUserId = row.insertId;

  try {
    await v1_products();
    await v2_authGuard();
    await v3_allocation(db);
    await v4_idempotency(db);
    await v5_failedPayment(db);
    await v6_history(db);
  } finally {
    await cleanupTestUser(db);
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  }
}

main().catch(err => {
  console.error("Verification script error:", err);
  process.exit(1);
});
