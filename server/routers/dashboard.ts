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
// Helper: assert business ownership
// ---------------------------------------------------------------------------
async function assertOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [biz] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const dashboardRouter = router({
  /**
   * Returns a full summary for the selected business:
   *  - Business name, industry, location, currentStage
   *  - Article status counts (total, by status, by statusBadge)
   *  - Credit balance for the user
   *  - Quick-action context (which stage to continue from)
   */
  getSummary: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Business info
      const [biz] = await db
        .select({
          id: businesses.id,
          name: businesses.name,
          industry: businesses.industry,
          location: businesses.location,
          currentStage: businesses.currentStage,
          cmsPlatform: businesses.cmsPlatform,
        })
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      // Article status counts — fetch all articles for this business
      const articleRows = await db
        .select({
          status: articles.status,
          statusBadge: articles.statusBadge,
        })
        .from(articles)
        .where(eq(articles.businessId, input.businessId));

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
   * Returns the last 10 automated publish actions for a business.
   * Sourced from publish_audit_log joined to articles for the title.
   * Used for the Recent Activity feed on the dashboard.
   */
  getRecentActivity: protectedProcedure
    .input(z.object({ businessId: z.number(), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

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
        .where(eq(publishAuditLog.businessId, input.businessId))
        .orderBy(desc(publishAuditLog.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Returns all businesses owned by the logged-in user.
   * Used for the multi-business switcher dropdown.
   * Includes article counts per business for display.
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
          cmsPlatform: businesses.cmsPlatform,
          createdAt: businesses.createdAt,
          websiteUrl: businesses.websiteUrl,
        })
        .from(businesses)
        .where(eq(businesses.userId, ctx.user.id))
        .orderBy(businesses.createdAt);

      if (!bizRows.length) return [];

      // Fetch article counts for all businesses owned by this user in a single JOIN query
      const countMap: Record<number, { total: number; published: number; scheduled: number }> = {};
      const allArticlesAll = await db
        .select({ businessId: articles.businessId, status: articles.status })
        .from(articles)
        .innerJoin(businesses, and(
          eq(businesses.id, articles.businessId),
          eq(businesses.userId, ctx.user.id)
        ));
      for (const row of allArticlesAll) {
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
