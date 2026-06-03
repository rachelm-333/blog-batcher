import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { architectureRouter } from "./routers/architecture";
import { authRouter } from "./routers/auth";
import { businessRouter } from "./routers/business";
import { keywordsRouter } from "./routers/keywords";
import { articlesRouter } from "./routers/articles";
import { scheduleRouter } from "./routers/schedule";
import { integrationsRouter } from "./routers/integrations";
import { schedulerRouter } from "./routers/scheduler";
import { dashboardRouter } from "./routers/dashboard";
import { supportRouter } from "./routers/support";
import { adminRouter } from "./routers/admin";
import { paymentsRouter } from "./routers/payments";
import { trialRouter } from "./routers/trial";
import { keywordSeedsRouter } from "./routers/keywordSeeds";

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

  // ─── Layer 8: CMS Integrations ────────────────────────────────────────────
  // WordPress, Wix, Zapier connection management.
  // All procedures live in server/routers/integrations.ts
  integrations: integrationsRouter,

  // ─── Layer 9: Scheduling & Automation ────────────────────────────────────
  // Heartbeat job management, audit log, in-app notifications.
  // All procedures live in server/routers/scheduler.ts
  scheduler: schedulerRouter,

  // ─── Layer 10: User Dashboard ─────────────────────────────────────────────
  // Dashboard summary, recent activity, multi-business switcher.
  // All procedures live in server/routers/dashboard.ts
  dashboard: dashboardRouter,

  // ─── Layer 11: Support Centre ─────────────────────────────────────────────
  // Help articles search, article viewer, contact form.
  // All procedures live in server/routers/support.ts
  support: supportRouter,

  // ─── Layer 12: Admin Panel ─────────────────────────────────────────────────
  // User management, business overview, revenue, error log, API costs, impersonation.
  // All procedures live in server/routers/admin.ts
  admin: adminRouter,

  // ─── Layer 13: Payments (Stripe) ─────────────────────────────────────────
  // One-time checkout sessions, payment history, product catalogue.
  // All procedures live in server/routers/payments.ts
  // Webhook handler lives at POST /api/stripe/webhook → server/stripe/webhook.ts
  payments: paymentsRouter,

  // ─── Layer 14: Free Trial Flow ────────────────────────────────────────────
  // Trial status, start free trial, upgrade options.
  // All procedures live in server/routers/trial.ts
  trial: trialRouter,

  // ─── Layer 15: Keyword Seeds ──────────────────────────────────────────────
  // AI-suggested seed keywords + DataForSEO pool search (Stage 1 Step 9).
  // All procedures live in server/routers/keywordSeeds.ts
  keywordSeeds: keywordSeedsRouter,
});

export type AppRouter = typeof appRouter;
