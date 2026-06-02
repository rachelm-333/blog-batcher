/**
 * server/stripe/allocate.ts
 * Idempotent credit allocation on successful Stripe payment.
 *
 * Called from the webhook handler when checkout.session.completed fires.
 * Guards against double-processing using the Stripe event ID.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  credits,
  creditTransactions,
  stripePayments,
} from "../../drizzle/schema";
import { getProduct, ProductKey } from "./products";

export interface AllocationResult {
  success: boolean;
  alreadyProcessed: boolean;
  newBalance?: number;
  creditsAdded?: number;
}

/**
 * Allocate credits for a successful Stripe checkout session.
 * Idempotent — safe to call multiple times with the same eventId.
 */
export async function allocateCreditsOnPayment({
  userId,
  productKey,
  stripeEventId,
  stripeCheckoutSessionId,
  stripeCustomerId,
  amountCents,
  receiptUrl,
}: {
  userId: number;
  productKey: ProductKey;
  stripeEventId: string;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string | null;
  amountCents: number;
  receiptUrl?: string | null;
}): Promise<AllocationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const product = getProduct(productKey);

  // ── Idempotency check ────────────────────────────────────────────────────
  const existing = await db
    .select({ id: stripePayments.id })
    .from(stripePayments)
    .where(eq(stripePayments.stripeEventId, stripeEventId))
    .limit(1);

  if (existing.length > 0) {
    return { success: true, alreadyProcessed: true };
  }

  // ── Get current balance before adding credits ─────────────────────────────
  const [existingCredit] = await db
    .select({ balance: credits.balance })
    .from(credits)
    .where(eq(credits.userId, userId))
    .limit(1);

  const balanceBefore = existingCredit?.balance ?? 0;
  const balanceAfter = balanceBefore + product.credits;

  // ── Write stripe_payments row ────────────────────────────────────────────
  const [paymentRow] = await db.insert(stripePayments).values({
    userId,
    stripeCheckoutSessionId,
    stripeCustomerId: stripeCustomerId ?? undefined,
    stripeEventId,
    status: "succeeded",
    amountCents,
    currency: "aud",
    product: productKey === "citation_starter"
      ? "pack_20"
      : productKey === "citation_authority"
        ? "pack_50"
        : "credit_top_up",
    creditsAllocated: product.credits,
    receiptUrl: receiptUrl ?? undefined,
  });

  const paymentId = (paymentRow as any).insertId as number;

  // ── Add credits to user's balance ────────────────────────────────────────
  await db
    .insert(credits)
    .values({ userId, balance: product.credits })
    .onDuplicateKeyUpdate({
      set: { balance: sql`balance + ${product.credits}` },
    });

  // ── Write credit_transaction ─────────────────────────────────────────────
  await db.insert(creditTransactions).values({
    userId,
    delta: product.credits,
    balanceAfter,
    reason: productKey === "credit_topup" ? "top_up" : "pack_purchase",
    stripePaymentId: paymentId,
  });

  // ── Update user tier and stripeCustomerId ─────────────────────────────────
  if (product.tier) {
    await db
      .update(users)
      .set({
        tier: product.tier,
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
      })
      .where(eq(users.id, userId));
  } else if (stripeCustomerId) {
    await db
      .update(users)
      .set({ stripeCustomerId })
      .where(eq(users.id, userId));
  }

  return {
    success: true,
    alreadyProcessed: false,
    newBalance: balanceAfter,
    creditsAdded: product.credits,
  };
}

/**
 * Record a failed payment — no credits allocated.
 */
export async function recordFailedPayment({
  userId,
  productKey,
  stripeEventId,
  stripeCheckoutSessionId,
  stripeCustomerId,
  amountCents,
}: {
  userId: number;
  productKey: ProductKey;
  stripeEventId: string;
  stripeCheckoutSessionId?: string;
  stripeCustomerId?: string;
  amountCents: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Idempotency check
  const existing = await db
    .select({ id: stripePayments.id })
    .from(stripePayments)
    .where(eq(stripePayments.stripeEventId, stripeEventId))
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(stripePayments).values({
    userId,
    stripeCheckoutSessionId: stripeCheckoutSessionId ?? undefined,
    stripeCustomerId: stripeCustomerId ?? undefined,
    stripeEventId,
    status: "failed",
    amountCents,
    currency: "aud",
    product: productKey === "citation_starter"
      ? "pack_20"
      : productKey === "citation_authority"
        ? "pack_50"
        : "credit_top_up",
    creditsAllocated: 0,
  });
}
