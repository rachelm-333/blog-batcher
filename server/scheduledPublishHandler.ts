/**
 * server/scheduledPublishHandler.ts
 *
 * Layer 9 — Heartbeat callback handler for scheduled article publishing.
 *
 * Registered at: POST /api/scheduled/publish-article
 * Triggered by: Manus Heartbeat platform (cron job per article)
 *
 * Authentication: sdk.authenticateRequest — verifies isCron=true and taskUid
 * Security: article is looked up by scheduleCronTaskUid (= taskUid), NEVER by req.body
 *
 * Flow:
 *   1. Authenticate request (must be a cron call with valid taskUid)
 *   2. Look up article by scheduleCronTaskUid = taskUid
 *   3. Delegate to executeScheduledPublish() in schedulerService.ts
 *   4. Return 200 with result (always 200 to prevent platform retries — we handle retries ourselves)
 */

import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { articles } from "../drizzle/schema";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { executeScheduledPublish } from "./schedulerService";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "../shared/const";

export async function scheduledPublishHandler(req: Request, res: Response) {
  try {
    // Step 1: Authenticate — must be a cron request with taskUid
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return res.status(403).json({ error: "cron-only" });
    }

    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }

    const taskUid = user.taskUid;

    // Step 2: Look up article by scheduleCronTaskUid (NEVER by req.body)
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }

    const [article] = await db
      .select({ id: articles.id, publishRetryCount: articles.publishRetryCount })
      .from(articles)
      .where(eq(articles.scheduleCronTaskUid, taskUid))
      .limit(1);

    if (!article) {
      // Orphan job — article no longer exists or was already processed
      console.log(`[Heartbeat] Orphan job for taskUid ${taskUid} — skipping`);
      return res.json({ ok: true, skipped: "orphan" });
    }

    // Determine attempt number from article's retry count
    // publishRetryCount=0 means this is the first attempt (attemptNumber=1)
    // publishRetryCount=1 means this is the retry (attemptNumber=2)
    const attemptNumber = (article.publishRetryCount ?? 0) === 0 ? 1 : 2;

    // Extract session token for Heartbeat SDK calls (needed to create retry jobs)
    const cookieHeader = req.headers["cookie"] ?? "";
    const cookies = parseCookieHeader(cookieHeader);
    const sessionToken = cookies[COOKIE_NAME] ?? "";

    // Step 3: Execute the publish
    console.log(`[Heartbeat] Publishing article ${article.id} (attempt ${attemptNumber}, taskUid: ${taskUid})`);

    const result = await executeScheduledPublish({
      articleId: article.id,
      taskUid,
      attemptNumber,
      sessionToken,
    });

    console.log(`[Heartbeat] Article ${article.id} publish result:`, result);

    // Always return 200 — we handle retries ourselves, not via platform retry
    return res.json({
      ok: true,
      articleId: article.id,
      success: result.success,
      retryScheduled: result.retryScheduled ?? false,
      error: result.error ?? null,
    });
  } catch (err) {
    console.error("[Heartbeat] Unexpected error in scheduledPublishHandler:", err);
    return res.status(500).json({
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
      context: { url: req.url, taskUid: "unknown" },
      timestamp: new Date().toISOString(),
    });
  }
}
