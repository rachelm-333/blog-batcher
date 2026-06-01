/**
 * Layer 6 — Stage 4: Article Generation tRPC Router
 *
 * Procedures:
 *  articles.startGeneration     — kick off batch generation for a business
 *  articles.getGenerationStatus — poll progress (completed/total, per-article status)
 *  articles.getAll              — return all articles for a business with node info
 *  articles.get                 — return a single article with full content
 *  articles.regenerate          — re-run generation for a single failed/needs_review article
 *  articles.updateStatus        — advance article status (generated → pending_approval → approved)
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  articles,
  businesses,
  keywords,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  generateSingleArticle,
  getOrderedNodes,
  preGenerateSlugs,
  MIN_DELIVERY_SCORE,
} from "../articleEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertBusinessOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!rows.length) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
}

/**
 * Run generation for a single node and save the result to the DB.
 * Returns the article ID.
 */
async function generateAndSave(
  businessId: number,
  nodeId: number,
  allOrderedNodes: Awaited<ReturnType<typeof getOrderedNodes>>,
  isRetry = false
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Mark as generating
  const existing = await db
    .select({ id: articles.id, generationAttempts: articles.generationAttempts })
    .from(articles)
    .where(eq(articles.articleNodeId, nodeId))
    .limit(1);

  const attempts = (existing[0]?.generationAttempts ?? 0) + 1;

  if (existing.length) {
    await db
      .update(articles)
      .set({ status: "generating", generationAttempts: attempts, errorMessage: null })
      .where(eq(articles.articleNodeId, nodeId));
  } else {
    await db.insert(articles).values({
      articleNodeId: nodeId,
      businessId,
      status: "generating",
      generationAttempts: 1,
    });
  }

  try {
    const result = await generateSingleArticle(businessId, nodeId, allOrderedNodes);

    // Auto-regenerate once if score is below threshold (only on first attempt)
    if (!isRetry && result.internalScore < MIN_DELIVERY_SCORE) {
      console.log(`[Articles] Node ${nodeId} scored ${result.internalScore} — auto-regenerating (attempt 2)`);
      return generateAndSave(businessId, nodeId, allOrderedNodes, true);
    }

    // Save result
    await db
      .update(articles)
      .set({
        title: result.title,
        metaTitle: result.metaTitle,
        metaDescription: result.metaDescription,
        bodyHtml: result.bodyHtml,
        bodyMarkdown: result.bodyMarkdown,
        schemaMarkup: result.schemaMarkup,
        faqItems: result.faqItems as unknown,
        wordCount: result.wordCount,
        urlSlug: result.urlSlug,
        focusKeyword: null, // will be set from keyword row
        internalScore: result.internalScore,
        statusBadge: result.statusBadge,
        status: "generated",
        generationAttempts: attempts,
        errorMessage: null,
      })
      .where(eq(articles.articleNodeId, nodeId));

    // Set focus keyword from keywords table
    const [kw] = await db
      .select({ pk: keywords.primaryKeyword })
      .from(keywords)
      .where(eq(keywords.articleNodeId, nodeId))
      .limit(1);
    if (kw) {
      await db
        .update(articles)
        .set({ focusKeyword: kw.pk })
        .where(eq(articles.articleNodeId, nodeId));
    }

    const [saved] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.articleNodeId, nodeId))
      .limit(1);

    return saved.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(articles)
      .set({ status: "failed", errorMessage: msg, generationAttempts: attempts })
      .where(eq(articles.articleNodeId, nodeId));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const articlesRouter = router({
  /**
   * Start batch generation for a business.
   * Runs articles one at a time in Cornerstone → Pillar → Cluster order.
   * This is a fire-and-forget mutation — the client polls getGenerationStatus.
   *
   * NOTE: Generation runs in the background. The procedure returns immediately
   * after kicking off the first article. Progress is tracked via article status
   * rows in the DB.
   */
  startGeneration: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Stage guard: must be at Stage 4 or beyond
      const [biz] = await db
        .select({ currentStage: businesses.currentStage })
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);
      if (!biz || biz.currentStage < 4) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Stage 3 (Keyword Research) must be completed before generating articles." });
      }

      // Check keywords are all approved
      const nodeRows = await db
        .select({ id: articleNodes.id })
        .from(articleNodes)
        .where(eq(articleNodes.businessId, input.businessId));

      if (!nodeRows.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No article nodes found. Complete Stage 2 first." });
      }

      const kwRows = await db
        .select({ approved: keywords.keywordApproved, paaApproved: keywords.paaApproved })
        .from(keywords)
        .where(eq(keywords.businessId, input.businessId));

      const allApproved = kwRows.every(k => k.approved && k.paaApproved);
      if (!allApproved) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All keywords and PAA questions must be approved before generating articles." });
      }

      // Check nothing is already generating
      const generatingRows = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.businessId, input.businessId), eq(articles.status, "generating")));

      if (generatingRows.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Generation is already in progress for this business." });
      }

      // Pre-generate slugs
      await preGenerateSlugs(input.businessId);

      // Get ordered nodes
      const orderedNodes = await getOrderedNodes(input.businessId);

      // Initialise all article rows as pending_generation (if not already present)
      for (const node of orderedNodes) {
        const existing = await db
          .select({ id: articles.id })
          .from(articles)
          .where(eq(articles.articleNodeId, node.nodeId))
          .limit(1);
        if (!existing.length) {
          await db.insert(articles).values({
            articleNodeId: node.nodeId,
            businessId: input.businessId,
            status: "pending_generation",
            generationAttempts: 0,
          });
        }
      }

      // Run generation sequentially in background (non-blocking response)
      setImmediate(async () => {
        for (const node of orderedNodes) {
          try {
            await generateAndSave(input.businessId, node.nodeId, orderedNodes);
          } catch (err) {
            console.error(`[Articles] Generation failed for node ${node.nodeId}:`, err);
            // Continue to next article even if one fails
          }
        }
        console.log(`[Articles] Batch generation complete for business ${input.businessId}`);
      });

      // Return a deterministic jobId so the client can correlate polls
      const jobId = `gen_${input.businessId}_${Date.now()}`;
      return { started: true, totalArticles: orderedNodes.length, jobId };
    }),

  /**
   * Poll generation progress.
   * Returns per-article status rows so the frontend can show a live progress bar.
   */
  getGenerationStatus: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db
        .select({
          articleId: articles.id,
          nodeId: articles.articleNodeId,
          status: articles.status,
          statusBadge: articles.statusBadge,
          title: articles.title,
          wordCount: articles.wordCount,
          internalScore: articles.internalScore,
          errorMessage: articles.errorMessage,
          level: articleNodes.level,
          articleType: articleNodes.articleType,
          urlSlug: articleNodes.urlSlug,
          sortOrder: articleNodes.sortOrder,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(eq(articles.businessId, input.businessId))
        .orderBy(articleNodes.sortOrder);

      const total = rows.length;
      const completed = rows.filter(r =>
        r.status === "generated" || r.status === "pending_approval" || r.status === "approved" || r.status === "published"
      ).length;
      const failed = rows.filter(r => r.status === "failed").length;
      const generating = rows.filter(r => r.status === "generating").length;
      const isComplete = total > 0 && completed + failed === total;

      return {
        total,
        completed,
        failed,
        generating,
        isComplete,
        articles: rows,
      };
    }),

  /**
   * Return all articles for a business with node info.
   * Used for the article list view after generation.
   */
  getAll: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const rows = await db
        .select({
          id: articles.id,
          articleNodeId: articles.articleNodeId,
          title: articles.title,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          wordCount: articles.wordCount,
          internalScore: articles.internalScore,
          statusBadge: articles.statusBadge,
          status: articles.status,
          generationAttempts: articles.generationAttempts,
          errorMessage: articles.errorMessage,
          approvedAt: articles.approvedAt,
          publishedAt: articles.publishedAt,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt,
          // Node info
          level: articleNodes.level,
          articleType: articleNodes.articleType,
          sortOrder: articleNodes.sortOrder,
          parentCornerstoneId: articleNodes.parentCornerstoneId,
          parentPillarId: articleNodes.parentPillarId,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articleNodes.id, articles.articleNodeId))
        .where(eq(articles.businessId, input.businessId))
        .orderBy(articleNodes.sortOrder);

      return rows;
    }),

  /**
   * Return a single article with full content (bodyHtml, bodyMarkdown, schema, FAQ).
   */
  get: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      // Verify ownership
      await assertBusinessOwnership(ctx.user.id, row.businessId);

      return row;
    }),

  /**
   * Re-run generation for a single article (retry for failed or needs_review).
   * Resets status to generating and runs the full pipeline again.
   */
  regenerate: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [article] = await db
        .select({ businessId: articles.businessId, articleNodeId: articles.articleNodeId })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      await assertBusinessOwnership(ctx.user.id, article.businessId);

      // Get all ordered nodes for context
      const orderedNodes = await getOrderedNodes(article.businessId);

      // Run generation in background
      setImmediate(async () => {
        try {
          await generateAndSave(article.businessId, article.articleNodeId, orderedNodes, false);
        } catch (err) {
          console.error(`[Articles] Regeneration failed for article ${input.articleId}:`, err);
        }
      });

      return { started: true };
    }),

  /**
   * Advance article status.
   * Valid transitions: generated → pending_approval, pending_approval → approved
   */
  updateStatus: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      status: z.enum(["pending_approval", "approved"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [article] = await db
        .select({ businessId: articles.businessId, status: articles.status })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      await assertBusinessOwnership(ctx.user.id, article.businessId);

      const updates: Partial<typeof articles.$inferInsert> = { status: input.status };
      if (input.status === "approved") {
        updates.approvedAt = new Date();
      }

      await db
        .update(articles)
        .set(updates)
        .where(eq(articles.id, input.articleId));

      return { updated: true };
    }),
});
