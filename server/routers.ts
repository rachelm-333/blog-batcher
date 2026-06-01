import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { architectureRouter } from "./routers/architecture";
import { authRouter } from "./routers/auth";
import { businessRouter } from "./routers/business";
import { keywordsRouter } from "./routers/keywords";
import { articlesRouter } from "./routers/articles";
import { scheduleRouter } from "./routers/schedule";

export const appRouter = router({
  // Framework system procedures (heartbeat, notifications, etc.)
  system: systemRouter,

  // ─── Layer 2: Auth ────────────────────────────────────────────────────────
  // Email+password registration, verification, login, logout, password reset.
  // All procedures live in server/routers/auth.ts
  auth: authRouter,

  // ─── Layer 3: Stage 1 — Business Profile & Website Scrape ─────────────────
  // All procedures live in server/routers/business.ts
  business: businessRouter,

  // ─── Layer 4: Stage 2 — Blog Architecture ─────────────────────────────
  // Pack selection, guardrails engine, article type assignment, confirm.
  // All procedures live in server/routers/architecture.ts
  architecture: architectureRouter,

  // ─── Layer 5: Stage 3 — SEO Keyword Research ──────────────────────────
  // DataForSEO integration, keyword assignment, PAA, cannibalization check.
  // All procedures live in server/routers/keywords.ts
  keywords: keywordsRouter,

  // ─── Layer 6: Stage 4 — Article Generation ──────────────────────────────
  // Batch generation, progress polling, single article view, regenerate.
  // All procedures live in server/routers/articles.ts
  articles: articlesRouter,

  // ─── Layer 7: Stage 5 — Review, Approve, Publish & Schedule ─────────────
  // Publishing schedule management: save cadence, get dates, confirm.
  // All procedures live in server/routers/schedule.ts
  schedule: scheduleRouter,

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
