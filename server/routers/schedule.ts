/**
 * Schedule router — Layer 7 publishing schedule management.
 *
 * Procedures:
 *  schedule.save    — upsert the publishing cadence + startDate + publishHour for a business/batch
 *  schedule.get     — return current schedule with calculated publish dates per article (active batch)
 *  schedule.confirm — lock schedule, set scheduledPublishAt on each article (active batch)
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { articles, articleNodes, businesses, schedules } from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

// ---------------------------------------------------------------------------
// Helper: assert business ownership — returns activeBatch
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
  return { db, activeBatch: biz.activeBatch ?? 1 };
}

// ---------------------------------------------------------------------------
// Helper: calculate publish dates from cadence + startDate + publishHour (UTC)
// ---------------------------------------------------------------------------
type Cadence =
  | "every_day"
  | "every_2_days"
  | "every_3_days"
  | "once_per_week"
  | "twice_per_week";

function cadenceToDays(cadence: Cadence): number {
  switch (cadence) {
    case "every_day": return 1;
    case "every_2_days": return 2;
    case "every_3_days": return 3;
    case "once_per_week": return 7;
    case "twice_per_week": return 4; // ~3.5 days, rounded to 4
    default: return 7;
  }
}

export function calculatePublishDates(
  articleIds: number[],
  cadence: Cadence,
  startDate: Date,
  publishHour = 9,
  publishMinute = 0
): { articleId: number; publishDate: Date }[] {
  const intervalDays = cadenceToDays(cadence);
  return articleIds.map((id, index) => {
    const publishDate = new Date(startDate);
    publishDate.setDate(publishDate.getDate() + index * intervalDays);
    publishDate.setUTCHours(publishHour, publishMinute, 0, 0);
    return { articleId: id, publishDate };
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const scheduleRouter = router({
  /**
   * Upsert the publishing cadence + startDate + publishHour for a business/batch.
   * Each batch gets its own schedule row (businessId + batchNumber unique).
   */
  save: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        cadence: z.enum([
          "every_day",
          "every_2_days",
          "every_3_days",
          "once_per_week",
          "twice_per_week",
        ]),
        startDate: z.date(),
        /** Preferred publish hour in 24-hour UTC (0–23). Defaults to 9 (9am UTC). */
        publishHour: z.number().min(0).max(23).default(9),
        /** Preferred publish minute (0, 15, 30, 45). Defaults to 0. */
        publishMinute: z.number().min(0).max(59).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, activeBatch } = await assertOwnership(ctx.user.id, input.businessId);

      // Upsert schedule for this business + batch
      const existing = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.businessId, input.businessId),
            eq(schedules.batchNumber, activeBatch)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(schedules)
          .set({
            cadence: input.cadence,
            startDate: input.startDate,
            publishHour: input.publishHour,
            publishMinute: input.publishMinute,
            confirmed: false,
          })
          .where(
            and(
              eq(schedules.businessId, input.businessId),
              eq(schedules.batchNumber, activeBatch)
            )
          );
      } else {
        await db.insert(schedules).values({
          businessId: input.businessId,
          batchNumber: activeBatch,
          cadence: input.cadence,
          startDate: input.startDate,
          publishHour: input.publishHour,
          publishMinute: input.publishMinute,
          confirmed: false,
        });
      }

      return { saved: true };
    }),

  /**
   * Return current schedule with calculated publish dates per article.
   * Only returns articles from the active batch.
   */
  get: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { db, activeBatch } = await assertOwnership(ctx.user.id, input.businessId);

      const [schedule] = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.businessId, input.businessId),
            eq(schedules.batchNumber, activeBatch)
          )
        )
        .limit(1);

      // Get approved articles in publish order (cornerstone → pillar → cluster)
      // scoped to the active batch via article_nodes.batchNumber
      const approvedArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          urlSlug: articles.urlSlug,
          status: articles.status,
          scheduledPublishAt: articles.scheduledPublishAt,
          level: articleNodes.level,
          sortOrder: articleNodes.sortOrder,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            eq(articleNodes.batchNumber, activeBatch),
            inArray(articles.status, ["approved", "scheduled", "published"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      if (!schedule || !schedule.cadence || !schedule.startDate) {
        return {
          schedule: schedule ?? null,
          articlesWithDates: approvedArticles.map(a => ({
            ...a,
            calculatedPublishDate: null,
          })),
        };
      }

      const publishHour = schedule.publishHour ?? 9;
      const publishMinute = schedule.publishMinute ?? 0;
      const dates = calculatePublishDates(
        approvedArticles.map(a => a.id),
        schedule.cadence as Cadence,
        schedule.startDate,
        publishHour,
        publishMinute
      );

      const dateMap = new Map(dates.map(d => [d.articleId, d.publishDate]));

      return {
        schedule,
        articlesWithDates: approvedArticles.map(a => ({
          ...a,
          calculatedPublishDate: dateMap.get(a.id) ?? null,
        })),
      };
    }),

  /**
   * Lock the schedule — set scheduledPublishAt on each approved article.
   * Only operates on articles from the active batch.
   */
  confirm: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { db, activeBatch } = await assertOwnership(ctx.user.id, input.businessId);

      const [schedule] = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.businessId, input.businessId),
            eq(schedules.batchNumber, activeBatch)
          )
        )
        .limit(1);

      if (!schedule || !schedule.cadence || !schedule.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please save a cadence and start date before confirming.",
        });
      }

      // Get approved articles in order — scoped to active batch
      const approvedArticles = await db
        .select({ id: articles.id, sortOrder: articleNodes.sortOrder })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            eq(articleNodes.batchNumber, activeBatch),
            inArray(articles.status, ["approved", "scheduled"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      if (approvedArticles.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No approved articles to schedule.",
        });
      }

      const publishHour = schedule.publishHour ?? 9;
      const publishMinute = schedule.publishMinute ?? 0;
      const dates = calculatePublishDates(
        approvedArticles.map(a => a.id),
        schedule.cadence as Cadence,
        schedule.startDate,
        publishHour,
        publishMinute
      );

      // Update each article with its scheduled publish date
      await Promise.all(
        dates.map(({ articleId, publishDate }) =>
          db
            .update(articles)
            .set({ status: "scheduled", scheduledPublishAt: publishDate })
            .where(eq(articles.id, articleId))
        )
      );

      // Mark schedule as confirmed
      await db
        .update(schedules)
        .set({ confirmed: true })
        .where(
          and(
            eq(schedules.businessId, input.businessId),
            eq(schedules.batchNumber, activeBatch)
          )
        );

      return { confirmed: true, scheduledCount: dates.length };
    }),
});
