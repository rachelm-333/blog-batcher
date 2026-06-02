/**
 * server/routers/payments.ts
 * Layer 13: Stripe Payments tRPC router.
 *
 * Procedures:
 *   payments.getProducts         — list available products (public)
 *   payments.createCheckoutSession — create Stripe Checkout session (protected)
 *   payments.getPaymentHistory    — user's payment history (protected)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getStripe } from "../stripe/client";
import { PRODUCTS, ProductKey } from "../stripe/products";
import { stripePayments, users, credits } from "../../drizzle/schema";
import { getDb } from "../db";

export const paymentsRouter = router({
  // ── List available products ───────────────────────────────────────────────
  getProducts: publicProcedure.query(() => {
    return Object.values(PRODUCTS);
  }),

  // ── Create Stripe Checkout Session ───────────────────────────────────────
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        productKey: z.enum(["citation_starter", "citation_authority", "credit_topup"]),
        /** Frontend origin for success/cancel redirect URLs. */
        origin: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const product = PRODUCTS[input.productKey as ProductKey];

      if (!product) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid product key" });
      }

      // Look up or use existing Stripe customer ID
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [userRow] = await db
        .select({ stripeCustomerId: users.stripeCustomerId, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      let customerId = userRow?.stripeCustomerId ?? undefined;

      // Create or reuse Stripe customer
      if (!customerId && userRow?.email) {
        const customer = await stripe.customers.create({
          email: userRow.email,
          name: userRow.name ?? undefined,
          metadata: { user_id: ctx.user.id.toString() },
        });
        customerId = customer.id;
        // Persist immediately so concurrent requests don't create duplicates
        await db
          .update(users)
          .set({ stripeCustomerId: customerId })
          .where(eq(users.id, ctx.user.id));
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        customer_email: !customerId ? (userRow?.email ?? undefined) : undefined,
        line_items: [
          {
            price_data: {
              currency: "aud",
              unit_amount: product.priceAud,
              product_data: {
                name: product.name,
                description: product.description,
              },
            },
            quantity: 1,
          },
        ],
        // GST via Stripe Tax (automatic_tax)
        automatic_tax: { enabled: true },
        // Pre-fill customer details
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          product_key: input.productKey,
          customer_email: userRow?.email ?? "",
          customer_name: userRow?.name ?? "",
        },
        // Allow promo codes
        allow_promotion_codes: true,
        // Billing address collection (needed for GST)
        billing_address_collection: "required",
        // Redirect URLs
        success_url: `${input.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.origin}/payment-cancelled`,
        // Invoice / receipt
        invoice_creation: { enabled: true },
      });

      if (!session.url) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe did not return a checkout URL" });
      }

      return { checkoutUrl: session.url, sessionId: session.id };
    }),

  // ── Payment history ───────────────────────────────────────────────────────
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const rows = await db
      .select({
        id: stripePayments.id,
        status: stripePayments.status,
        amountCents: stripePayments.amountCents,
        currency: stripePayments.currency,
        product: stripePayments.product,
        creditsAllocated: stripePayments.creditsAllocated,
        receiptUrl: stripePayments.receiptUrl,
        stripeCheckoutSessionId: stripePayments.stripeCheckoutSessionId,
        createdAt: stripePayments.createdAt,
      })
      .from(stripePayments)
      .where(eq(stripePayments.userId, ctx.user.id))
      .orderBy(desc(stripePayments.createdAt))
      .limit(50);

    return rows.map((row) => ({
      ...row,
      amountAud: (row.amountCents / 100).toFixed(2),
      productLabel:
        row.product === "pack_20"
          ? "Citation Starter — 20 Articles"
          : row.product === "pack_50"
            ? "Citation Authority — 50 Articles"
            : "Credit Top-Up — 5 Credits",
    }));
  }),

  // ── Get credit balance for sidebar display ──────────────────────────────────
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [row] = await db
      .select({ balance: credits.balance })
      .from(credits)
      .where(eq(credits.userId, ctx.user.id))
      .limit(1);
    return { balance: row?.balance ?? 0 };
  }),

  // ── Get session details after redirect (for success page) ─────────────────
  getCheckoutSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const stripe = getStripe();
      try {
        const session = await stripe.checkout.sessions.retrieve(input.sessionId);
        // Verify this session belongs to the current user
        if (session.client_reference_id !== ctx.user.id.toString()) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Session does not belong to this user" });
        }
        return {
          status: session.payment_status,
          amountTotal: session.amount_total,
          currency: session.currency,
          productKey: session.metadata?.product_key as ProductKey | undefined,
        };
      } catch (err: any) {
        if (err.code === "FORBIDDEN") throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not retrieve session" });
      }
    }),
});
