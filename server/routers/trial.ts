/**
 * Layer 14 — Free Trial Flow
 *
 * Procedures:
 *  trial.getStatus          — returns trial state and plan context for the current user
 *  trial.startFreeTrial     — creates a free-trial business + architecture (1 cluster article)
 *  trial.getUpgradeOptions  — returns product catalogue with trial context for the upgrade prompt
 *
 * Trial rules (from Master Scope §9):
 *  - 1 cluster article generated at full 16-point Authority Standard quality
 *  - No credit card required
 *  - Limited to 1 free trial per account (email verified)
 *  - After generating their free article: user can read it, see the status badge, see all metadata
 *  - To publish, download, or export: must purchase a pack
 *  - Conversion prompt shown after free article is generated
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  articles,
  blogArchitectures,
  businesses,
  credits,
  keywords,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { PRODUCTS } from "../stripe/products";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the user's current trial and plan state.
 */
async function getUserTrialState(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

  const [user] = await db
    .select({ freeTrialUsed: users.freeTrialUsed, tier: users.tier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [creditRow] = await db
    .select({ balance: credits.balance })
    .from(credits)
    .where(eq(credits.userId, userId))
    .limit(1);

  return {
    freeTrialUsed: user?.freeTrialUsed ?? false,
    tier: user?.tier ?? "standard",
    creditBalance: creditRow?.balance ?? 0,
    hasActivePlan: (creditRow?.balance ?? 0) > 0,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export const trialRouter = router({
  /**
   * Returns the user's trial status and plan context.
   * Used by the dashboard and upgrade prompt to decide what to show.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const state = await getUserTrialState(ctx.user.id);

    // Check if the user has a trial business
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const trialBiz = await db
      .select({ id: businesses.id, currentStage: businesses.currentStage })
      .from(businesses)
      .innerJoin(blogArchitectures, eq(blogArchitectures.businessId, businesses.id))
      .where(
        and(
          eq(businesses.userId, ctx.user.id),
          eq(blogArchitectures.packSize, 0),
        )
      )
      .limit(1);

    let trialArticleStatus: string | null = null;
    if (trialBiz.length > 0) {
      const [trialArticle] = await db
        .select({ status: articles.status, isFreeTrial: articles.isFreeTrial })
        .from(articles)
        .where(and(eq(articles.businessId, trialBiz[0].id), eq(articles.isFreeTrial, true)))
        .limit(1);
      trialArticleStatus = trialArticle?.status ?? null;
    }

    return {
      freeTrialUsed: state.freeTrialUsed,
      hasActivePlan: state.hasActivePlan,
      creditBalance: state.creditBalance,
      tier: state.tier,
      trialBusinessId: trialBiz[0]?.id ?? null,
      trialArticleStatus,
    };
  }),

  /**
   * Creates a free-trial business and architecture (packSize=0, 1 cluster node).
   * Advances the business to Stage 4 so generation can start immediately.
   *
   * Blocked if:
   *  - freeTrialUsed=true (already used their trial)
   *  - User already has a trial business
   */
  startFreeTrial: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1).max(255),
        websiteUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Check trial abuse
      const [user] = await db
        .select({ freeTrialUsed: users.freeTrialUsed })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (user?.freeTrialUsed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You have already used your free trial. Purchase a plan to continue generating articles.",
        });
      }

      // Check if a trial business already exists
      const existingTrial = await db
        .select({ id: businesses.id })
        .from(businesses)
        .innerJoin(blogArchitectures, eq(blogArchitectures.businessId, businesses.id))
        .where(
          and(
            eq(businesses.userId, ctx.user.id),
            eq(blogArchitectures.packSize, 0),
          )
        )
        .limit(1);

      if (existingTrial.length > 0) {
        // Return the existing trial business instead of creating a new one
        return { businessId: existingTrial[0].id, alreadyExists: true };
      }

      // Create the trial business
      const [bizResult] = await db.insert(businesses).values({
        userId: ctx.user.id,
        name: input.businessName,
        websiteUrl: input.websiteUrl ?? null,
        currentStage: 4, // Skip straight to Stage 4 (generation ready)
        isTestBusiness: false,
      });
      const businessId = Number((bizResult as any)[0]?.insertId ?? (bizResult as any).insertId);

      // Create a minimal trial architecture (packSize=0, 1 cluster)
      const [archResult] = await db.insert(blogArchitectures).values({
        businessId,
        packSize: 0, // 0 = free trial
        cornerstoneCount: 0,
        pillarCount: 0,
        clustersPerPillar: 1,
        totalArticleCount: 1,
        confirmed: true, // auto-confirmed
      });
      const architectureId = Number((archResult as any)[0]?.insertId ?? (archResult as any).insertId);

      // Create the single cluster article node
      const [nodeResult] = await db.insert(articleNodes).values({
        businessId,
        architectureId,
        level: "cluster",
        articleType: "how_to",
        sortOrder: 0,
      });
      const nodeId = Number((nodeResult as any)[0]?.insertId ?? (nodeResult as any).insertId);

      // Create a placeholder keyword for the cluster node
      await db.insert(keywords).values({
        businessId,
        articleNodeId: nodeId,
        primaryKeyword: `${input.businessName} guide`,
        keywordApproved: true,
        paaApproved: true,
      });

      // Mark trial as used immediately — prevents duplicate trials before generation completes
      await db.update(users).set({ freeTrialUsed: true }).where(eq(users.id, ctx.user.id));

      return { businessId, architectureId, nodeId, packSize: 0, alreadyExists: false };
    }),

  /**
   * Returns the product catalogue with trial context.
   * Used by the upgrade prompt modal.
   */
  getUpgradeOptions: protectedProcedure.query(async ({ ctx }) => {
    const state = await getUserTrialState(ctx.user.id);

    const products = Object.values(PRODUCTS).map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      priceAud: p.priceAud,
      priceDisplay: `$${(p.priceAud / 100).toFixed(0)} AUD`,
      credits: p.credits,
      articleCount: p.articleCount,
      tier: p.tier,
      recommended: p.key === "citation_authority",
    }));

    return {
      products,
      freeTrialUsed: state.freeTrialUsed,
      creditBalance: state.creditBalance,
      hasActivePlan: state.hasActivePlan,
      message: state.freeTrialUsed
        ? "Your free trial article is ready. Purchase a plan to unlock the full workflow — keyword research, architecture, and all articles."
        : "Start with a free trial article to see the quality before you commit.",
    };
  }),

  /**
   * Marks the free trial as used for the current user.
   * Called by the generation pipeline after the trial article is successfully generated.
   * Internal — not called directly by the frontend.
   */
  markTrialUsed: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    await db
      .update(users)
      .set({ freeTrialUsed: true })
      .where(eq(users.id, ctx.user.id));

    return { success: true };
  }),
});
