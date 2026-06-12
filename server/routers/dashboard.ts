/**
 * server/routers/dashboard.ts
 *
 * Layer 10 — User Dashboard
 *
 * Procedures:
 *  dashboard.getSummary        — article status counts, stage, credit balance, business info
 *  dashboard.getRecentActivity — last 10 automated actions across all articles for a business
 *  dashboard.listBusinesses    — all businesses for the logged-in user (for multi-business switcher)
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articles,
  articleNodes,
  businesses,
  credits,
  publishAuditLog,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

// ---------------------------------------------------------------------------
// Helper: assert business ownership — returns the business row (including activeBatch)
// ---------------------------------------------------------------------------
async function assertOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [biz] = await db
    .select({ id: businesses.id, activeBatch: businesses.activeBatch })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  return biz;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const dashboardRouter = router({
  /**
   * Returns a full summary for the selected business:
   *  - Business name, industry, location, currentStage, activeBatch
   *  - Article status counts (total, by status, by statusBadge) — scoped to activeBatch
   *  - Credit balance for the user
   *  - Quick-action context (which stage to continue from)
   */
  getSummary: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const owned = await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Business info — include activeBatch
      const [biz] = await db
        .select({
          id: businesses.id,
          name: businesses.name,
          industry: businesses.industry,
          location: businesses.location,
          currentStage: businesses.currentStage,
          activeBatch: businesses.activeBatch,
          cmsPlatform: businesses.cmsPlatform,
        })
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      const activeBatch = owned.activeBatch ?? 1;

      // Article status counts — scoped to activeBatch via article_nodes join
      const articleRows = await db
        .select({
          status: articles.status,
          statusBadge: articles.statusBadge,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            eq(articleNodes.batchNumber, activeBatch)
          )
        );

      // Count by lifecycle status
      const statusCounts = {
        total: articleRows.length,
        pending_generation: 0,
        generating: 0,
        generated: 0,
        pending_approval: 0,
        approved: 0,
        scheduled: 0,
        published: 0,
        failed: 0,
        draft: 0,
      } as Record<string, number>;

      // Count by quality badge
      const badgeCounts = {
        authority_ready: 0,
        strong: 0,
        needs_review: 0,
      } as Record<string, number>;

      for (const row of articleRows) {
        if (row.status && row.status in statusCounts) {
          statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
        }
        if (row.statusBadge && row.statusBadge in badgeCounts) {
          badgeCounts[row.statusBadge] = (badgeCounts[row.statusBadge] ?? 0) + 1;
        }
      }

      // Credit balance
      const [creditRow] = await db
        .select({ balance: credits.balance })
        .from(credits)
        .where(eq(credits.userId, ctx.user.id))
        .limit(1);

      const creditBalance = creditRow?.balance ?? 0;

      // Determine quick-action context
      const stage = biz.currentStage ?? 1;
      const quickActionRoute = (() => {
        if (stage <= 1) return "/onboarding";
        if (stage === 2) return "/architecture";
        if (stage === 3) return "/keywords";
        if (stage === 4) return "/generate";
        if (stage === 5) return "/review";
        return "/publish";
      })();

      const quickActionLabel = (() => {
        if (stage <= 1) return "Complete Business Profile";
        if (stage === 2) return "Set Up Blog Architecture";
        if (stage === 3) return "Research Keywords";
        if (stage === 4) return "Generate Articles";
        if (stage === 5) return "Review & Publish Articles";
        return "Publish & Schedule Articles";
      })();

      return {
        business: biz,
        statusCounts,
        badgeCounts,
        creditBalance,
        quickActionRoute,
        quickActionLabel,
      };
    }),

  /**
   * Returns the last N automated publish actions for a business,
   * scoped to the active batch via the articles join.
   * Used for the Recent Activity feed on the dashboard.
   */
  getRecentActivity: protectedProcedure
    .input(z.object({ businessId: z.number(), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const owned = await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const activeBatch = owned.activeBatch ?? 1;

      const rows = await db
        .select({
          id: publishAuditLog.id,
          articleId: publishAuditLog.articleId,
          action: publishAuditLog.action,
          result: publishAuditLog.result,
          errorMessage: publishAuditLog.errorMessage,
          attemptNumber: publishAuditLog.attemptNumber,
          triggeredBy: publishAuditLog.triggeredBy,
          newScheduledAt: publishAuditLog.newScheduledAt,
          createdAt: publishAuditLog.createdAt,
          // Article info
          articleTitle: articles.title,
          articleStatus: articles.status,
          articleSlug: articles.urlSlug,
          cmsPostUrl: articles.cmsPostUrl,
        })
        .from(publishAuditLog)
        .leftJoin(articles, eq(articles.id, publishAuditLog.articleId))
        .leftJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(
          and(
            eq(publishAuditLog.businessId, input.businessId),
            eq(articleNodes.batchNumber, activeBatch)
          )
        )
        .orderBy(desc(publishAuditLog.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Returns all businesses owned by the logged-in user.
   * Used for the multi-business switcher dropdown.
   * Article counts are scoped to each business's activeBatch.
   */
  listBusinesses: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get all businesses for this user
      const bizRows = await db
        .select({
          id: businesses.id,
          name: businesses.name,
          industry: businesses.industry,
          location: businesses.location,
          currentStage: businesses.currentStage,
          activeBatch: businesses.activeBatch,
          cmsPlatform: businesses.cmsPlatform,
          createdAt: businesses.createdAt,
          websiteUrl: businesses.websiteUrl,
        })
        .from(businesses)
        .where(eq(businesses.userId, ctx.user.id))
        .orderBy(businesses.createdAt);

      if (!bizRows.length) return [];

      // Fetch article counts per business, scoped to each business's activeBatch
      // We join articles → article_nodes to filter by batchNumber
      const allArticlesAll = await db
        .select({
          businessId: articles.businessId,
          status: articles.status,
          batchNumber: articleNodes.batchNumber,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .innerJoin(businesses, and(
          eq(businesses.id, articles.businessId),
          eq(businesses.userId, ctx.user.id)
        ));

      // Build a map of activeBatch per business for fast lookup
      const activeBatchMap: Record<number, number> = {};
      for (const biz of bizRows) {
        activeBatchMap[biz.id] = biz.activeBatch ?? 1;
      }

      const countMap: Record<number, { total: number; published: number; scheduled: number }> = {};
      for (const row of allArticlesAll) {
        const bizActiveBatch = activeBatchMap[row.businessId] ?? 1;
        // Only count articles from the active batch
        if ((row.batchNumber ?? 1) !== bizActiveBatch) continue;
        if (!countMap[row.businessId]) {
          countMap[row.businessId] = { total: 0, published: 0, scheduled: 0 };
        }
        countMap[row.businessId]!.total++;
        if (row.status === "published") countMap[row.businessId]!.published++;
        if (row.status === "scheduled") countMap[row.businessId]!.scheduled++;
      }

      return bizRows.map(biz => ({
        ...biz,
        articleCounts: countMap[biz.id] ?? { total: 0, published: 0, scheduled: 0 },
      }));
    }),
});
