import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authRouter } from "./routers/auth";

export const appRouter = router({
  // Framework system procedures (heartbeat, notifications, etc.)
  system: systemRouter,

  // ─── Layer 2: Auth ────────────────────────────────────────────────────────
  // Email+password registration, verification, login, logout, password reset.
  // All procedures live in server/routers/auth.ts
  auth: authRouter,

  // ─── STRIPE PLACEHOLDER ───────────────────────────────────────────────────
  // Layer 3 (Stripe) will be wired here once Auth is fully verified.
  //
  // When ready, add:
  //   payments: paymentsRouter,
  //
  // The paymentsRouter will handle:
  //   - payments.createCheckoutSession  → Stripe Checkout for 20/50-article packs
  //   - payments.getPortalUrl           → Stripe Customer Portal
  //   - payments.history                → User's payment history
  //
  // Webhook handler (not a tRPC route) lives at:
  //   POST /api/stripe/webhook          → server/stripe/webhook.ts
  //
  // On successful payment:
  //   - credits table updated with pack credits (20 or 50)
  //   - user tier set to 'standard'
  //   - Stages 2–4 unlocked
  // ─────────────────────────────────────────────────────────────────────────
});

export type AppRouter = typeof appRouter;
