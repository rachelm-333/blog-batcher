/**
 * server/routers/scheduler.ts
 *
 * Layer 9 — Scheduling & Automation tRPC Router
 *
 * Procedures:
 *  scheduler.scheduleArticle  — create a Heartbeat job for a single article
 *  scheduler.cancelSchedule   — cancel a scheduled article's Heartbeat job
 *  scheduler.reschedule       — move a scheduled article to a new date
 *  scheduler.getSchedule      — list all scheduled articles for a business
 *  scheduler.getAuditLog      — return audit log entries for a business or article
 *  scheduler.getNotifications — return unread notifications for the current user
 *  scheduler.markNotificationRead — mark one notification as read
 *  scheduler.markAllRead      — mark all notifications for the user as read
 *  scheduler.simulatePublish  — (test/debug) directly invoke the publish logic
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  articles,
  articleNodes,
  businesses,
  publishAuditLog,
  notifications,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createArticleHeartbeat,
  cancelArticleHeartbeat,
  rescheduleArticleHeartbeat,
  writeAuditLog,
  executeScheduledPublish,
  dateToCron,
} from "../schedulerService";
import { COOKIE_NAME } from "../../shared/const";

// ---------------------------------------------------------------------------
// Helper: extract session token from tRPC context request
// ---------------------------------------------------------------------------
function getSessionToken(ctx: { req: { headers: { cookie?: string } } }): string {
  const cookieHeader = ctx.req.headers.cookie ?? "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  return cookies[COOKIE_NAME] ?? "";
}

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
  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found or access denied" });
  return db;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const schedulerRouter = router({
  /**
   * Schedule a single article for automated publishing.
   * Creates a Heartbeat job that fires at the article's scheduledPublishAt time.
   * If the article has no scheduledPublishAt, returns an error.
   */
  scheduleArticle: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await assertOwnership(ctx.user.id, 0); // ownership checked via article below

      const [row] = await db
        .select({
          id: articles.id,
          businessId: articles.businessId,
          title: articles.title,
          status: articles.status,
          scheduledPublishAt: articles.scheduledPublishAt,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
        })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      // Verify ownership via business
      const [biz] = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, row.businessId), eq(businesses.userId, ctx.user.id)))
        .limit(1);
      if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      if (!row.scheduledPublishAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Article has no scheduled publish date. Set a date first.",
        });
      }

      if (row.scheduledPublishAt <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scheduled publish date is in the past.",
        });
      }

      if (row.status !== "scheduled" && row.status !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Article must be in 'scheduled' or 'approved' status to schedule (current: ${row.status})`,
        });
      }

      // Cancel existing job if one exists
      if (row.scheduleCronTaskUid) {
        try {
          await cancelArticleHeartbeat(row.scheduleCronTaskUid, getSessionToken(ctx));
        } catch {
          // Ignore — job may already be gone
        }
      }

      // Create new Heartbeat job
      const sessionToken = getSessionToken(ctx);
      const taskUid = await createArticleHeartbeat(
        input.articleId,
        row.scheduledPublishAt,
        sessionToken
      );

      // Persist taskUid on article
      await db
        .update(articles)
        .set({
          status: "scheduled",
          scheduleCronTaskUid: taskUid,
          publishRetryCount: 0,
          retryScheduledAt: null,
        })
        .where(eq(articles.id, input.articleId));

      return { scheduled: true, taskUid, scheduledAt: row.scheduledPublishAt };
    }),

  /**
   * Cancel a scheduled article's Heartbeat job.
   * Article status is reset to 'approved'.
   */
  cancelSchedule: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select({
          id: articles.id,
          businessId: articles.businessId,
          title: articles.title,
          status: articles.status,
          scheduledPublishAt: articles.scheduledPublishAt,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
        })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      // Verify ownership
      const [biz] = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, row.businessId), eq(businesses.userId, ctx.user.id)))
        .limit(1);
      if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      // Cancel Heartbeat job if it exists
      if (row.scheduleCronTaskUid) {
        try {
          await cancelArticleHeartbeat(row.scheduleCronTaskUid, getSessionToken(ctx));
        } catch (err) {
          console.warn(`[Scheduler] Failed to delete heartbeat job ${row.scheduleCronTaskUid}:`, err);
        }
      }

      // Reset article status
      await db
        .update(articles)
        .set({
          status: "approved",
          scheduleCronTaskUid: null,
          retryScheduledAt: null,
          publishRetryCount: 0,
        })
        .where(eq(articles.id, input.articleId));

      // Write audit log
      await writeAuditLog({
        articleId: input.articleId,
        businessId: row.businessId,
        action: "schedule_cancelled",
        result: "cancelled",
        triggeredBy: "user",
      });

      return { cancelled: true };
    }),

  /**
   * Reschedule an article to a new publish date.
   * Updates the Heartbeat job cron expression and the article's scheduledPublishAt.
   */
  reschedule: protectedProcedure
    .input(
      z.object({
        articleId: z.number(),
        newScheduledAt: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      if (input.newScheduledAt <= new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "New scheduled date must be in the future" });
      }

      const [row] = await db
        .select({
          id: articles.id,
          businessId: articles.businessId,
          title: articles.title,
          status: articles.status,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
        })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      // Verify ownership
      const [biz] = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, row.businessId), eq(businesses.userId, ctx.user.id)))
        .limit(1);
      if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      const sessionToken = getSessionToken(ctx);
      let taskUid = row.scheduleCronTaskUid;

      if (taskUid) {
        // Update existing Heartbeat job
        try {
          await rescheduleArticleHeartbeat(taskUid, input.newScheduledAt, sessionToken);
        } catch {
          // If update fails, create a new job
          taskUid = null;
        }
      }

      if (!taskUid) {
        // Create a new Heartbeat job
        taskUid = await createArticleHeartbeat(input.articleId, input.newScheduledAt, sessionToken);
      }

      // Update article
      await db
        .update(articles)
        .set({
          scheduledPublishAt: input.newScheduledAt,
          scheduleCronTaskUid: taskUid,
          status: "scheduled",
          publishRetryCount: 0,
          retryScheduledAt: null,
        })
        .where(eq(articles.id, input.articleId));

      // Write audit log
      await writeAuditLog({
        articleId: input.articleId,
        businessId: row.businessId,
        action: "schedule_rescheduled",
        result: "rescheduled",
        triggeredBy: "user",
        newScheduledAt: input.newScheduledAt,
      });

      return { rescheduled: true, taskUid, newScheduledAt: input.newScheduledAt };
    }),

  /**
   * Return all scheduled/published articles for a business with their schedule info.
   */
  getSchedule: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await assertOwnership(ctx.user.id, input.businessId);

      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          urlSlug: articles.urlSlug,
          status: articles.status,
          scheduledPublishAt: articles.scheduledPublishAt,
          publishedAt: articles.publishedAt,
          cmsPostUrl: articles.cmsPostUrl,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
          retryScheduledAt: articles.retryScheduledAt,
          publishRetryCount: articles.publishRetryCount,
          errorMessage: articles.errorMessage,
          level: articleNodes.level,
          sortOrder: articleNodes.sortOrder,
        })
        .from(articles)
        .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            inArray(articles.status, ["scheduled", "published", "failed"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      return rows;
    }),

  /**
   * Return audit log entries for a business (or filtered by article).
   */
  getAuditLog: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        articleId: z.number().optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await assertOwnership(ctx.user.id, input.businessId);

      const conditions = [eq(publishAuditLog.businessId, input.businessId)];
      if (input.articleId) {
        conditions.push(eq(publishAuditLog.articleId, input.articleId));
      }

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
          articleTitle: articles.title,
        })
        .from(publishAuditLog)
        .leftJoin(articles, eq(articles.id, publishAuditLog.articleId))
        .where(and(...conditions))
        .orderBy(desc(publishAuditLog.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Return notifications for the current user (most recent first).
   */
  getNotifications: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().min(1).max(100).default(20),
        businessId: z.number().optional(), // optional: filter notifications to a specific business
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [eq(notifications.userId, ctx.user.id)];
      if (input.unreadOnly) {
        conditions.push(eq(notifications.read, false));
      }
      if (input.businessId) {
        conditions.push(eq(notifications.businessId, input.businessId));
      }

      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit);

      const unreadCount = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));

      return { notifications: rows, unreadCount: unreadCount.length };
    }),

  /**
   * Mark a single notification as read.
   */
  markNotificationRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(notifications)
        .set({ read: true })
        .where(
          and(
            eq(notifications.id, input.notificationId),
            eq(notifications.userId, ctx.user.id) // ensure ownership
          )
        );

      return { marked: true };
    }),

  /**
   * Mark all notifications for the current user as read.
   */
  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.userId, ctx.user.id));

      return { marked: true };
    }),

  /**
   * Auto-schedule all approved articles for a business with a cadence.
   * Assigns scheduledPublishAt = startDate + (index * intervalDays) days for each
   * approved article (sorted by sortOrder), then creates a Heartbeat job per article.
   * Articles already scheduled/published are skipped.
   */
  autoSchedule: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        startDate: z.date(),
        intervalDays: z.number().min(1).max(30),
        /** Preferred publish hour in 24-hour UTC (0–23). Defaults to 9. */
        publishHour: z.number().min(0).max(23).default(9),
        /** Preferred publish minute (0–59). Defaults to 0. */
        publishMinute: z.number().min(0).max(59).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await assertOwnership(ctx.user.id, input.businessId);

      if (input.startDate <= new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Start date must be in the future" });
      }

      // Load all approved articles for this business, sorted by node sort order
      const approvedArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          status: articles.status,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
          sortOrder: articleNodes.sortOrder,
        })
        .from(articles)
        .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            inArray(articles.status, ["approved"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      if (approvedArticles.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No approved articles found. Approve articles before auto-scheduling.",
        });
      }

      const sessionToken = getSessionToken(ctx);
      const scheduled: { articleId: number; scheduledAt: Date; taskUid: string }[] = [];
      const failed: { articleId: number; error: string }[] = [];

      for (let i = 0; i < approvedArticles.length; i++) {
        const article = approvedArticles[i];
        const scheduledAt = new Date(input.startDate);
        scheduledAt.setDate(scheduledAt.getDate() + i * input.intervalDays);
        // Set to the user's preferred publish hour + minute (UTC)
        scheduledAt.setUTCHours(input.publishHour, input.publishMinute, 0, 0);

        try {
          // Cancel existing Heartbeat job if one exists
          if (article.scheduleCronTaskUid) {
            try {
              await cancelArticleHeartbeat(article.scheduleCronTaskUid, sessionToken);
            } catch {
              // Ignore — job may already be gone
            }
          }

          // Create new Heartbeat job
          const taskUid = await createArticleHeartbeat(article.id, scheduledAt, sessionToken);

          // Update article with new schedule
          await db
            .update(articles)
            .set({
              status: "scheduled",
              scheduledPublishAt: scheduledAt,
              scheduleCronTaskUid: taskUid,
              publishRetryCount: 0,
              retryScheduledAt: null,
            })
            .where(eq(articles.id, article.id));

          // Write audit log
          await writeAuditLog({
            articleId: article.id,
            businessId: input.businessId,
            action: "schedule_rescheduled",
            result: "rescheduled",
            triggeredBy: "user",
            newScheduledAt: scheduledAt,
          });

          scheduled.push({ articleId: article.id, scheduledAt, taskUid });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failed.push({ articleId: article.id, error: msg });
          console.error(`[AutoSchedule] Failed to schedule article ${article.id}:`, err);
        }
      }

      return {
        scheduledCount: scheduled.length,
        failedCount: failed.length,
        scheduled,
        failed,
        firstPublishAt: scheduled[0]?.scheduledAt ?? null,
        lastPublishAt: scheduled[scheduled.length - 1]?.scheduledAt ?? null,
      };
    }),

  /**
   * Simulate a scheduled publish — directly invokes executeScheduledPublish.
   * Used for testing without waiting for a Heartbeat to fire.
   * The article must be in 'scheduled' status and have a scheduleCronTaskUid.
   */
  simulatePublish: protectedProcedure
    .input(
      z.object({
        articleId: z.number(),
        attemptNumber: z.number().min(1).max(2).default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select({
          id: articles.id,
          businessId: articles.businessId,
          scheduleCronTaskUid: articles.scheduleCronTaskUid,
        })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      // Verify ownership
      const [biz] = await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, row.businessId), eq(businesses.userId, ctx.user.id)))
        .limit(1);
      if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      const sessionToken = getSessionToken(ctx);

      const result = await executeScheduledPublish({
        articleId: input.articleId,
        taskUid: row.scheduleCronTaskUid ?? `simulated-${Date.now()}`,
        attemptNumber: input.attemptNumber,
        sessionToken,
      });

      return result;
    }),
});
