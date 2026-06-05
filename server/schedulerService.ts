/**
 * server/schedulerService.ts
 *
 * Layer 9 — Scheduling & Automation
 *
 * Shared publish logic used by:
 *   - The Heartbeat callback handler (/api/scheduled/publish-article)
 *   - The scheduler tRPC router (schedule.scheduleArticle, cancel, reschedule)
 *
 * This module is the single source of truth for:
 *   - Executing a scheduled publish (with retry logic)
 *   - Writing to publish_audit_log
 *   - Creating in-app notifications
 *   - Creating / deleting / updating Heartbeat jobs
 */

import { eq, and } from "drizzle-orm";
import {
  articles,
  articleNodes,
  articleImages,
  integrations,
  businesses,
  publishAuditLog,
  notifications,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  publishToWordPress,
  publishToWix,
  publishToZapier,
  decryptCredentials,
  type ArticlePayload,
} from "./cmsPublisher";
import { createHeartbeatJob, deleteHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { notifyOwner } from "./_core/notification";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledPublishContext {
  articleId: number;
  /** Heartbeat task UID that triggered this publish (for lookup). */
  taskUid: string;
  /** 1 = first attempt, 2 = retry */
  attemptNumber: number;
  /** Session token for Heartbeat SDK calls (owner session from heartbeat). */
  sessionToken: string;
}

export interface ScheduledPublishResult {
  success: boolean;
  cmsPostUrl?: string;
  error?: string;
  retryScheduled?: boolean;
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

export async function writeAuditLog(params: {
  articleId: number;
  businessId: number;
  action: typeof publishAuditLog.$inferInsert["action"];
  result: typeof publishAuditLog.$inferInsert["result"];
  errorMessage?: string | null;
  attemptNumber?: number;
  triggeredBy?: "user" | "heartbeat";
  newScheduledAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(publishAuditLog).values({
    articleId: params.articleId,
    businessId: params.businessId,
    action: params.action,
    result: params.result,
    errorMessage: params.errorMessage ?? null,
    attemptNumber: params.attemptNumber ?? 1,
    triggeredBy: params.triggeredBy ?? "heartbeat",
    newScheduledAt: params.newScheduledAt ?? null,
  });
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

export async function createNotification(params: {
  userId: number;
  businessId: number | null;
  articleId: number | null;
  type: typeof notifications.$inferInsert["type"];
  title: string;
  message: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values({
    userId: params.userId,
    businessId: params.businessId ?? undefined,
    articleId: params.articleId ?? undefined,
    type: params.type,
    title: params.title,
    message: params.message,
    read: false,
  });
}

// ---------------------------------------------------------------------------
// Core: execute a scheduled publish for one article
// Called by the Heartbeat handler. Handles retry logic internally.
// ---------------------------------------------------------------------------

export async function executeScheduledPublish(
  ctx: ScheduledPublishContext
): Promise<ScheduledPublishResult> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };

  // Load article with all required fields
  const [row] = await db
    .select({
      id: articles.id,
      businessId: articles.businessId,
      title: articles.title,
      bodyHtml: articles.bodyHtml,
      metaTitle: articles.metaTitle,
      metaDescription: articles.metaDescription,
      focusKeyword: articles.focusKeyword,
      urlSlug: articles.urlSlug,
      schemaMarkup: articles.schemaMarkup,
      scheduledPublishAt: articles.scheduledPublishAt,
      status: articles.status,
      publishRetryCount: articles.publishRetryCount,
      level: articleNodes.level,
      imageUrl: articleImages.imageUrl,
      altText: articleImages.altText,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
    .where(eq(articles.id, ctx.articleId))
    .limit(1);

  if (!row) {
    console.error(`[Scheduler] Article ${ctx.articleId} not found`);
    return { success: false, error: "Article not found" };
  }

  // Guard: only publish if article is in scheduled status
  if (row.status !== "scheduled") {
    console.warn(`[Scheduler] Article ${ctx.articleId} is in status '${row.status}', skipping`);
    return { success: false, error: `Article is not in scheduled status (current: ${row.status})` };
  }

  // Load the business to find the active CMS integration
  const [biz] = await db
    .select({ id: businesses.id, cmsPlatform: businesses.cmsPlatform })
    .from(businesses)
    .where(eq(businesses.id, row.businessId))
    .limit(1);

  if (!biz?.cmsPlatform) {
    const error = "No CMS platform configured for this business";
    await writeAuditLog({
      articleId: ctx.articleId,
      businessId: row.businessId,
      action: ctx.attemptNumber === 1 ? "scheduled_publish_attempted" : "retry_attempted",
      result: "failure",
      errorMessage: error,
      attemptNumber: ctx.attemptNumber,
    });
    return { success: false, error };
  }

  // Load integration credentials
  const platform = biz.cmsPlatform as "wordpress" | "wix" | "shopify" | "webflow" | "squarespace" | "ghost";
  // Map to supported publisher platforms
  const publisherPlatform = (["wordpress", "wix"].includes(platform) ? platform : "zapier") as "wordpress" | "wix" | "zapier";

  const [integration] = await db
    .select({ credentialsEncrypted: integrations.credentialsEncrypted })
    .from(integrations)
    .where(
      and(
        eq(integrations.businessId, row.businessId),
        eq(integrations.platform, publisherPlatform === "zapier" ? "zapier" : platform)
      )
    )
    .limit(1);

  if (!integration?.credentialsEncrypted) {
    const error = `No ${platform} credentials found`;
    await writeAuditLog({
      articleId: ctx.articleId,
      businessId: row.businessId,
      action: ctx.attemptNumber === 1 ? "scheduled_publish_attempted" : "retry_attempted",
      result: "failure",
      errorMessage: error,
      attemptNumber: ctx.attemptNumber,
    });
    return { success: false, error };
  }

  const creds = decryptCredentials(integration.credentialsEncrypted);
  if (!creds) {
    const error = "Failed to decrypt CMS credentials";
    await writeAuditLog({
      articleId: ctx.articleId,
      businessId: row.businessId,
      action: ctx.attemptNumber === 1 ? "scheduled_publish_attempted" : "retry_attempted",
      result: "failure",
      errorMessage: error,
      attemptNumber: ctx.attemptNumber,
    });
    return { success: false, error };
  }

  // Write "attempted" audit log entry
  await writeAuditLog({
    articleId: ctx.articleId,
    businessId: row.businessId,
    action: ctx.attemptNumber === 1 ? "scheduled_publish_attempted" : "retry_attempted",
    result: "success", // will be overwritten below if it fails
    attemptNumber: ctx.attemptNumber,
  });

  const payload: ArticlePayload = {
    title: row.title ?? "",
    bodyHtml: row.bodyHtml ?? "",
    metaTitle: row.metaTitle ?? row.title ?? "",
    metaDescription: row.metaDescription ?? "",
    focusKeyword: row.focusKeyword ?? "",
    urlSlug: row.urlSlug ?? "",
    schemaMarkup: row.schemaMarkup ?? null,
    imageUrl: row.imageUrl ?? null,
    imageAltText: row.altText ?? null,
    scheduledPublishAt: row.scheduledPublishAt ?? null,
    level: row.level ?? "cluster",
  };

  let result;
  try {
    if (publisherPlatform === "wordpress") {
      result = await publishToWordPress(
        {
          siteUrl: creds.siteUrl ?? "",
          username: creds.username ?? "",
          applicationPassword: creds.applicationPassword ?? "",
          seoPlugin: (creds.seoPlugin as "yoast" | "rankmath" | "aioseo" | "none") ?? "none",
        },
        payload
      );
    } else if (publisherPlatform === "wix") {
      result = await publishToWix(
        { apiKey: creds.apiKey ?? "", siteId: creds.siteId ?? "", memberId: creds.memberId ?? "" },
        payload
      );
    } else {
      result = await publishToZapier(
        { webhookUrl: creds.webhookUrl ?? "" },
        payload
      );
    }
  } catch (err) {
    result = { success: false, error: String(err) };
  }

  // Load user ID for notifications
  const [bizWithUser] = await db
    .select({ userId: businesses.userId })
    .from(businesses)
    .where(eq(businesses.id, row.businessId))
    .limit(1);
  const userId = bizWithUser?.userId ?? -1;

  if (result.success) {
    // SUCCESS — update article to published
    await db
      .update(articles)
      .set({
        status: "published",
        publishedAt: new Date(),
        cmsPostId: result.cmsPostId ?? null,
        cmsPostUrl: result.cmsPostUrl ?? null,
        errorMessage: null,
        scheduleCronTaskUid: null, // job is done
      })
      .where(eq(articles.id, ctx.articleId));

    // Write success audit log
    await writeAuditLog({
      articleId: ctx.articleId,
      businessId: row.businessId,
      action: ctx.attemptNumber === 1 ? "scheduled_publish_succeeded" : "retry_succeeded",
      result: "success",
      attemptNumber: ctx.attemptNumber,
    });

    // In-app notification
    if (userId > 0) {
      await createNotification({
        userId,
        businessId: row.businessId,
        articleId: ctx.articleId,
        type: "publish_success",
        title: "Article published successfully",
        message: `"${row.title ?? "Your article"}" was automatically published to your CMS.${result.cmsPostUrl ? ` View it at ${result.cmsPostUrl}` : ""}`,
      });
    }

    return { success: true, cmsPostUrl: result.cmsPostUrl };
  } else {
    // FAILURE
    const errorMsg = result.error ?? "Publish failed";

    if (ctx.attemptNumber === 1 && (row.publishRetryCount ?? 0) < 1) {
      // First failure — schedule retry in 15 minutes
      const retryAt = new Date(Date.now() + 15 * 60 * 1000);

      // Convert to 6-field cron: sec min hour dom mon dow (UTC)
      const retryCron = dateToCron(retryAt);

      let retryTaskUid: string | null = null;
      try {
        const retryJob = await createHeartbeatJob(
          {
            name: `publish-retry-${ctx.articleId}-${Date.now()}`,
            cron: retryCron,
            path: "/api/scheduled/publish-article",
            payload: { articleId: ctx.articleId, attemptNumber: 2 },
            description: `Retry publish for article ${ctx.articleId}`,
          },
          ctx.sessionToken
        );
        retryTaskUid = retryJob.taskUid;
      } catch (err) {
        console.error(`[Scheduler] Failed to create retry heartbeat for article ${ctx.articleId}:`, err);
      }

      // Update article: mark as failed (temporarily), record retry info
      await db
        .update(articles)
        .set({
          status: "failed",
          errorMessage: errorMsg,
          publishRetryCount: 1,
          retryScheduledAt: retryAt,
          scheduleCronTaskUid: retryTaskUid ?? null,
        })
        .where(eq(articles.id, ctx.articleId));

      // Write failure audit log
      await writeAuditLog({
        articleId: ctx.articleId,
        businessId: row.businessId,
        action: "scheduled_publish_failed",
        result: "failure",
        errorMessage: errorMsg,
        attemptNumber: 1,
      });

      // Notify owner (admin)
      await notifyOwner({
        title: `Scheduled publish failed: ${row.title ?? "Article"}`,
        content: `Article "${row.title ?? "Article"}" failed to publish automatically.\nError: ${errorMsg}\nRetry scheduled for ${retryAt.toISOString()}.\nBusiness ID: ${row.businessId}`,
      });

      return { success: false, error: errorMsg, retryScheduled: true };
    } else {
      // Second failure (retry) — mark as publish_failed permanently
      await db
        .update(articles)
        .set({
          status: "failed",
          errorMessage: `Retry also failed: ${errorMsg}`,
          scheduleCronTaskUid: null,
          retryScheduledAt: null,
        })
        .where(eq(articles.id, ctx.articleId));

      // Write retry_failed audit log
      await writeAuditLog({
        articleId: ctx.articleId,
        businessId: row.businessId,
        action: "retry_failed",
        result: "failure",
        errorMessage: errorMsg,
        attemptNumber: 2,
      });

      // In-app notification for user
      if (userId > 0) {
        await createNotification({
          userId,
          businessId: row.businessId,
          articleId: ctx.articleId,
          type: "retry_failed",
          title: "Automatic publish failed",
          message: `"${row.title ?? "Your article"}" could not be published automatically after retrying. Please check your CMS connection and retry manually from the dashboard.`,
        });
      }

      // Notify owner (admin)
      await notifyOwner({
        title: `Scheduled publish retry failed: ${row.title ?? "Article"}`,
        content: `Article "${row.title ?? "Article"}" failed to publish on retry.\nError: ${errorMsg}\nBusiness ID: ${row.businessId}\nManual intervention required.`,
      });

      return { success: false, error: errorMsg, retryScheduled: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: convert a Date to a 6-field cron expression (UTC)
// Format: sec min hour dom mon dow
// ---------------------------------------------------------------------------

export function dateToCron(date: Date): string {
  // Always use 0 for seconds — Heartbeat minimum interval is 60s.
  const min = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const mon = date.getUTCMonth() + 1; // 0-indexed → 1-indexed
  return `0 ${min} ${hour} ${dom} ${mon} *`;
}

// ---------------------------------------------------------------------------
// Create a Heartbeat job for a scheduled article
// Called by schedule.scheduleArticle tRPC mutation
// ---------------------------------------------------------------------------

export async function createArticleHeartbeat(
  articleId: number,
  scheduledAt: Date,
  sessionToken: string
): Promise<string> {
  const cron = dateToCron(scheduledAt);
  const job = await createHeartbeatJob(
    {
      name: `publish-article-${articleId}-${scheduledAt.getTime()}`,
      cron,
      path: "/api/scheduled/publish-article",
      payload: { articleId, attemptNumber: 1 },
      description: `Scheduled publish for article ${articleId} at ${scheduledAt.toISOString()}`,
    },
    sessionToken
  );
  return job.taskUid;
}

// ---------------------------------------------------------------------------
// Cancel a Heartbeat job for a scheduled article
// Called by schedule.cancelSchedule tRPC mutation
// ---------------------------------------------------------------------------

export async function cancelArticleHeartbeat(
  taskUid: string,
  sessionToken: string
): Promise<void> {
  await deleteHeartbeatJob(taskUid, sessionToken);
}

// ---------------------------------------------------------------------------
// Reschedule a Heartbeat job for a scheduled article
// Called by schedule.reschedule tRPC mutation
// ---------------------------------------------------------------------------

export async function rescheduleArticleHeartbeat(
  taskUid: string,
  newScheduledAt: Date,
  sessionToken: string
): Promise<void> {
  const newCron = dateToCron(newScheduledAt);
  await updateHeartbeatJob(taskUid, { cron: newCron }, sessionToken);
}
