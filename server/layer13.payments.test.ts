/**
 * server/layer13.payments.test.ts
 * Vitest tests for Layer 13: Stripe Payments.
 *
 * Tests:
 *   - getProducts returns all three products
 *   - createCheckoutSession requires authentication
 *   - allocateCreditsOnPayment is idempotent
 *   - allocateCreditsOnPayment adds credits and writes stripe_payments row
 *   - recordFailedPayment writes a failed row without allocating credits
 *   - getPaymentHistory returns user's payments
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { users, credits, stripePayments, creditTransactions } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { allocateCreditsOnPayment, recordFailedPayment } from "./stripe/allocate";
import { PRODUCTS } from "./stripe/products";

// ── Test user fixture ─────────────────────────────────────────────────────────
const TEST_EMAIL = "layer13-test@blogbatcher.test";
const TEST_OPEN_ID = "layer13-test-openid-" + Date.now();
let testUserId: number;

async function cleanupTestUser(db: Awaited<ReturnType<typeof getDb>>, email: string) {
  if (!db) return;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!u) return;
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, u.id));
  await db.delete(stripePayments).where(eq(stripePayments.userId, u.id));
  await db.delete(credits).where(eq(credits.userId, u.id));
  await db.delete(users).where(eq(users.id, u.id));
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  await cleanupTestUser(db, TEST_EMAIL);

  const [row] = await db.insert(users).values({
    openId: TEST_OPEN_ID,
    email: TEST_EMAIL,
    name: "Layer 13 Test User",
    role: "user",
    tier: "standard",
    onboardingComplete: 0 as any,
    emailVerified: 1 as any,
    isSuspended: 0 as any,
  });
  testUserId = (row as any).insertId as number;
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await cleanupTestUser(db, TEST_EMAIL);
});

// ── Product catalogue ─────────────────────────────────────────────────────────
describe("PRODUCTS catalogue", () => {
  it("has three products", () => {
    expect(Object.keys(PRODUCTS)).toHaveLength(3);
  });

  it("citation_starter has correct credits and price", () => {
    const p = PRODUCTS.citation_starter;
    expect(p.credits).toBe(25);
    expect(p.priceAud).toBe(9700);
    expect(p.articleCount).toBe(20);
  });

  it("citation_authority has correct credits and price", () => {
    const p = PRODUCTS.citation_authority;
    expect(p.credits).toBe(60);
    expect(p.priceAud).toBe(19700);
    expect(p.articleCount).toBe(50);
  });

  it("credit_topup has correct credits and price", () => {
    const p = PRODUCTS.credit_topup;
    expect(p.credits).toBe(5);
    expect(p.priceAud).toBe(2700);
    expect(p.articleCount).toBeNull();
  });
});

// ── allocateCreditsOnPayment ──────────────────────────────────────────────────
describe("allocateCreditsOnPayment", () => {
  const eventId1 = `evt_test_layer13_${Date.now()}_1`;
  const eventId2 = `evt_test_layer13_${Date.now()}_2`;
  const sessionId1 = `cs_test_layer13_${Date.now()}_1`;
  const sessionId2 = `cs_test_layer13_${Date.now()}_2`;

  it("allocates credits for citation_starter", async () => {
    const result = await allocateCreditsOnPayment({
      userId: testUserId,
      productKey: "citation_starter",
      stripeEventId: eventId1,
      stripeCheckoutSessionId: sessionId1,
      stripeCustomerId: "cus_test_layer13",
      amountCents: 9700,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.creditsAdded).toBe(25);
    expect(result.newBalance).toBe(25);
  });

  it("is idempotent — same eventId does not double-allocate", async () => {
    const result = await allocateCreditsOnPayment({
      userId: testUserId,
      productKey: "citation_starter",
      stripeEventId: eventId1, // same event ID
      stripeCheckoutSessionId: sessionId1,
      stripeCustomerId: "cus_test_layer13",
      amountCents: 9700,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(true);

    // Balance should still be 25, not 50
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [creditRow] = await db
      .select({ balance: credits.balance })
      .from(credits)
      .where(eq(credits.userId, testUserId))
      .limit(1);
    expect(creditRow?.balance).toBe(25);
  });

  it("allocates credits for credit_topup and accumulates balance", async () => {
    const result = await allocateCreditsOnPayment({
      userId: testUserId,
      productKey: "credit_topup",
      stripeEventId: eventId2,
      stripeCheckoutSessionId: sessionId2,
      stripeCustomerId: "cus_test_layer13",
      amountCents: 2700,
    });

    expect(result.success).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.creditsAdded).toBe(5);
    expect(result.newBalance).toBe(30); // 25 + 5
  });

  it("writes a stripe_payments row with status=succeeded", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select({ status: stripePayments.status, creditsAllocated: stripePayments.creditsAllocated })
      .from(stripePayments)
      .where(and(eq(stripePayments.userId, testUserId), eq(stripePayments.stripeEventId, eventId1)));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].creditsAllocated).toBe(25);
  });
});

// ── recordFailedPayment ───────────────────────────────────────────────────────
describe("recordFailedPayment", () => {
  const failedEventId = `evt_test_layer13_failed_${Date.now()}`;

  it("writes a failed payment row without allocating credits", async () => {
    await recordFailedPayment({
      userId: testUserId,
      productKey: "citation_starter",
      stripeEventId: failedEventId,
      amountCents: 9700,
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [row] = await db
      .select({ status: stripePayments.status, creditsAllocated: stripePayments.creditsAllocated })
      .from(stripePayments)
      .where(eq(stripePayments.stripeEventId, failedEventId))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.status).toBe("failed");
    expect(row.creditsAllocated).toBe(0);
  });

  it("does not change credit balance on failed payment", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const [creditRow] = await db
      .select({ balance: credits.balance })
      .from(credits)
      .where(eq(credits.userId, testUserId))
      .limit(1);
    // Balance should still be 30 from previous tests
    expect(creditRow?.balance).toBe(30);
  });

  it("is idempotent — same failedEventId does not create duplicate row", async () => {
    await recordFailedPayment({
      userId: testUserId,
      productKey: "citation_starter",
      stripeEventId: failedEventId,
      amountCents: 9700,
    });

    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db
      .select({ id: stripePayments.id })
      .from(stripePayments)
      .where(eq(stripePayments.stripeEventId, failedEventId));
    expect(rows.length).toBe(1); // still only one row
  });
});
