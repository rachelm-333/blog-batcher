/**
 * server/stripe/webhook.ts
 * Express route handler for Stripe webhooks.
 *
 * MUST be registered BEFORE express.json() in server/_core/index.ts
 * so that the raw body is available for signature verification.
 */
import { Request, Response } from "express";
import Stripe from "stripe";
import { getStripe } from "./client";
import { allocateCreditsOnPayment, recordFailedPayment } from "./allocate";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ProductKey } from "./products";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    return;
  }

  // ── Test event detection (required by Stripe integration checklist) ───────
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    res.json({ verified: true });
    return;
  }

  console.log(`[Stripe Webhook] Event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutSessionCompleted(event);
        break;
      }
      case "payment_intent.payment_failed": {
        await handlePaymentFailed(event);
        break;
      }
      default:
        // Unhandled event — acknowledge receipt
        break;
    }
    res.json({ received: true });
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  const userId = parseInt(session.metadata?.user_id ?? "0");
  const productKey = session.metadata?.product_key as ProductKey | undefined;

  if (!userId || !productKey) {
    console.error("[Stripe Webhook] Missing user_id or product_key in session metadata", session.metadata);
    return;
  }

  // Verify user exists
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    console.error(`[Stripe Webhook] User ${userId} not found`);
    return;
  }

  // Retrieve receipt URL from the payment intent's charge
  let receiptUrl: string | null = null;
  try {
    if (session.payment_intent) {
      const stripe = getStripe();
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent as string, {
        expand: ["latest_charge"],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      receiptUrl = charge?.receipt_url ?? null;
    }
  } catch (err) {
    console.warn("[Stripe Webhook] Could not retrieve receipt URL:", err);
  }

  const result = await allocateCreditsOnPayment({
    userId,
    productKey,
    stripeEventId: event.id,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: session.customer as string | null,
    amountCents: session.amount_total ?? 0,
    receiptUrl,
  });

  if (result.alreadyProcessed) {
    console.log(`[Stripe Webhook] Event ${event.id} already processed — skipping`);
  } else {
    console.log(`[Stripe Webhook] Allocated ${result.creditsAdded} credits to user ${userId}. New balance: ${result.newBalance}`);
  }
}

// ── payment_intent.payment_failed ─────────────────────────────────────────────

async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;

  const userId = parseInt(pi.metadata?.user_id ?? "0");
  const productKey = pi.metadata?.product_key as ProductKey | undefined;

  if (!userId || !productKey) {
    // Not all payment intents will have our metadata — that's OK
    return;
  }

  await recordFailedPayment({
    userId,
    productKey,
    stripeEventId: event.id,
    stripeCustomerId: pi.customer as string | undefined,
    amountCents: pi.amount,
  });

  console.log(`[Stripe Webhook] Recorded failed payment for user ${userId}`);
}
