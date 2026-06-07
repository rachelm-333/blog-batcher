/**
 * Layer 6 — Stage 4: Article Generation tRPC Router
 * Layer 7 — Stage 5: Review, Edit, Approve, Publish & Schedule
 *
 * Procedures:
 *  articles.startGeneration     — kick off batch generation for a business
 *  articles.getGenerationStatus — poll progress (completed/total, per-article status)
 *  articles.getAll              — return all articles for a business with node info
 *  articles.get                 — return a single article with full content
 *  articles.regenerate          — re-run generation for a single failed/needs_review article
 *  articles.updateStatus        — advance article status (generated → pending_approval → approved)
 *  articles.updateSeoFields     — save edits to SEO fields (slug, meta title, meta description, etc.)
 *  articles.approve             — approve a single article (sets approvedAt, status=approved)
 *  articles.approveAll          — approve all generated articles for a business
 *  articles.saveImage           — save image URL or upload bytes to S3 for an article
 *  articles.exportZip           — generate export ZIP (HTML + Markdown + meta + schema + schedule CSV)
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const archiver = require("archiver") as (format: string, options?: object) => any;
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  articleImages,
  articleNodes,
  articles,
  blogArchitectures,
  businesses,
  credits,
  schedules,
  keywords,
  users,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { invokeLLM } from "../_core/llm";
import {
  generateSingleArticle,
  getOrderedNodes,
  preGenerateSlugs,
  MIN_DELIVERY_SCORE,
} from "../articleEngine";
import {
  publishToWordPress,
  publishToWix,
  publishToZapier,
  decryptCredentials,
  type ArticlePayload,
} from "../cmsPublisher";
import { integrations } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";

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

    // If score is below threshold on first attempt, save the article as-is (word count is already enforced)
    // Do NOT regenerate from scratch — that would lose the word count that was already achieved.
    // The article will be flagged as needs_review for manual improvement via the AI Edit Instruction panel.
    if (!isRetry && result.internalScore < MIN_DELIVERY_SCORE) {
      console.log(`[Articles] Node ${nodeId} scored ${result.internalScore} — saving as needs_review (word count preserved: ${result.wordCount} words)`);
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
        approvedAt: null,
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

      // ── Trial / credit guard (checked BEFORE article nodes so upgrade prompt shows first) ────
      // Admin users bypass all credit gates
      const [arch] = await db
        .select({ packSize: blogArchitectures.packSize })
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, input.businessId))
        .limit(1);
      const isTrialBusiness = arch?.packSize === 0;
      if (ctx.user.role !== 'admin') {
      if (isTrialBusiness) {
        // Trial business: block if free trial already used
        const [userRow] = await db
          .select({ freeTrialUsed: users.freeTrialUsed })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        if (userRow?.freeTrialUsed) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "FREE_TRIAL_USED",
          });
        }
      } else {
        // Paid business: require at least 1 credit
        const [creditRow] = await db
          .select({ balance: credits.balance })
          .from(credits)
          .where(eq(credits.userId, ctx.user.id))
          .limit(1);
        if (!creditRow || creditRow.balance < 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "INSUFFICIENT_CREDITS",
          });
        }
      }
      } // end admin bypass
      // ── End trial / credit guard ──────────────────────────────────────────────────

      // Check article nodes exist (Stage 2 must be complete)
      const nodeRows = await db
        .select({ id: articleNodes.id })
        .from(articleNodes)
        .where(eq(articleNodes.businessId, input.businessId));
      if (!nodeRows.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No article nodes found. Complete Stage 2 first." });
      }

      // Check all keywords are approved
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

      // Capture trial flag for use in background task
      const isTrialGen = isTrialBusiness;
      const trialUserId = ctx.user.id;

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
        // Mark trial as used after the trial article is generated
        if (isTrialGen) {
          try {
            const dbInner = await getDb();
            if (dbInner) {
              await dbInner.update(users).set({ freeTrialUsed: true }).where(eq(users.id, trialUserId));
              // Also mark the article as isFreeTrial
              await dbInner.update(articles).set({ isFreeTrial: true }).where(eq(articles.businessId, input.businessId));
              console.log(`[Trial] Marked freeTrialUsed=true for user ${trialUserId}`);
            }
          } catch (err) {
            console.error(`[Trial] Failed to mark trial as used:`, err);
          }
        }
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
          hasContent: sql<number>`(CASE WHEN ${articles.bodyHtml} IS NOT NULL AND LENGTH(${articles.bodyHtml}) > 0 THEN 1 ELSE 0 END)`,
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
        .select({
          id: articles.id,
          articleNodeId: articles.articleNodeId,
          businessId: articles.businessId,
          title: articles.title,
          bodyHtml: articles.bodyHtml,
          bodyMarkdown: articles.bodyMarkdown,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          schemaMarkup: articles.schemaMarkup,
          faqItems: articles.faqItems,
          wordCount: articles.wordCount,
          internalScore: articles.internalScore,
          statusBadge: articles.statusBadge,
          status: articles.status,
          generationAttempts: articles.generationAttempts,
          errorMessage: articles.errorMessage,
          approvedAt: articles.approvedAt,
          scheduledPublishAt: articles.scheduledPublishAt,
          publishedAt: articles.publishedAt,
          cmsPostId: articles.cmsPostId,
          cmsPostUrl: articles.cmsPostUrl,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt,
          imageUrl: articleImages.imageUrl,
          imageAltText: articleImages.altText,
        })
        .from(articles)
        .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
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
   * Regenerate all articles that are below their word count minimum for their type.
   * Runs sequentially in the background. Returns the count of articles queued.
   */
  regenerateUnderTarget: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Word count minimums per article type
      const WORD_COUNT_MIN: Record<string, number> = {
        cornerstone: 2400,
        pillar: 1500,
        cluster: 800,
      };

      // Find all articles that are below their word count minimum and not currently generating
      const allArticles = await db
        .select({
          id: articles.id,
          articleNodeId: articles.articleNodeId,
          wordCount: articles.wordCount,
          status: articles.status,
          level: articleNodes.level,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .where(eq(articles.businessId, input.businessId));

      const underTarget = allArticles.filter((a) => {
        if (a.status === "generating" || a.status === "approved") return false;
        const min = WORD_COUNT_MIN[a.level ?? "cluster"] ?? 800;
        return (a.wordCount ?? 0) < min;
      });

      if (underTarget.length === 0) return { queued: 0 };

      const orderedNodes = await getOrderedNodes(input.businessId);

      // Run sequentially in background so we don't overwhelm the LLM
      setImmediate(async () => {
        for (const art of underTarget) {
          try {
            console.log(`[Articles] regenerateUnderTarget: starting node ${art.articleNodeId} (${art.level}, ${art.wordCount ?? 0} words)`);
            await generateAndSave(input.businessId, art.articleNodeId, orderedNodes, false);
            console.log(`[Articles] regenerateUnderTarget: completed node ${art.articleNodeId}`);
          } catch (err) {
            console.error(`[Articles] regenerateUnderTarget: failed for node ${art.articleNodeId}:`, err);
          }
        }
        console.log(`[Articles] regenerateUnderTarget: all ${underTarget.length} articles processed`);
      });

      return { queued: underTarget.length };
    }),

  /**
   * Advance article status.
   * Valid transitions: generated → pending_approval, pending_approval → approved
   */
  updateStatus: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      status: z.enum(["generated", "pending_approval", "approved"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [article] = await db
        .select({ businessId: articles.businessId, status: articles.status, bodyHtml: articles.bodyHtml })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });

      await assertBusinessOwnership(ctx.user.id, article.businessId);

      // If marking a failed article as generated, require it to have content
      if (input.status === "generated" && !article.bodyHtml) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot mark as ready — article has no content. Use Retry to regenerate it." });
      }

      const updates: Partial<typeof articles.$inferInsert> = { status: input.status, errorMessage: null };
      if (input.status === "approved") {
        updates.approvedAt = new Date();
      }

      await db
        .update(articles)
        .set(updates)
        .where(eq(articles.id, input.articleId));

      return { updated: true };
    }),

  // ---------------------------------------------------------------------------
  // Layer 7: Stage 5 — Review, Edit, Approve, Publish & Schedule
  // ---------------------------------------------------------------------------

  /**
   * Save edits to SEO fields.
   * All fields are optional — only provided fields are updated.
   */
  updateSeoFields: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      urlSlug: z.string().max(512).optional(),
      metaTitle: z.string().max(120).optional(),
      metaDescription: z.string().max(320).optional(),
      focusKeyword: z.string().max(512).optional(),
      schemaMarkup: z.string().optional(),
      faqItems: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
      imageUrl: z.string().url().optional(),
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

      // SEO fields (slug, meta title, meta description, focus keyword, image URL) are always editable
      // even after publishing, so users can update them before re-publishing to CMS.

      // Validate meta title length
      if (input.metaTitle && input.metaTitle.length > 60) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Meta title must be 60 characters or fewer." });
      }
      // Validate meta description length
      if (input.metaDescription && (input.metaDescription.length < 140 || input.metaDescription.length > 160)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Meta description must be between 140 and 160 characters." });
      }

      const updates: Partial<typeof articles.$inferInsert> = {};
      if (input.urlSlug !== undefined) updates.urlSlug = input.urlSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (input.metaTitle !== undefined) updates.metaTitle = input.metaTitle;
      if (input.metaDescription !== undefined) updates.metaDescription = input.metaDescription;
      if (input.focusKeyword !== undefined) updates.focusKeyword = input.focusKeyword;
      if (input.schemaMarkup !== undefined) updates.schemaMarkup = input.schemaMarkup;
      if (input.faqItems !== undefined) updates.faqItems = input.faqItems as unknown;

      if (Object.keys(updates).length > 0) {
        await db.update(articles).set(updates).where(eq(articles.id, input.articleId));
      }

      // Save imageUrl to articleImages table if provided
      if (input.imageUrl) {
        const existing = await db
          .select({ id: articleImages.id })
          .from(articleImages)
          .where(eq(articleImages.articleId, input.articleId))
          .limit(1);
        if (existing.length > 0) {
          await db.update(articleImages)
            .set({ imageUrl: input.imageUrl })
            .where(eq(articleImages.articleId, input.articleId));
        } else {
          await db.insert(articleImages).values({
            articleId: input.articleId,
            imageUrl: input.imageUrl,
            storageKey: null,
            altText: null,
          });
        }
      }

      return { updated: true };
    }),

  /**
   * Update the article body (HTML + Markdown).
   * Allowed before approval. Blocked for published articles.
   */
  updateBody: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      bodyHtml: z.string(),
      bodyMarkdown: z.string().optional(),
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

      if (article.status === "published") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Published articles cannot be edited here. Edit directly in your CMS." });
      }

      // Recount words from the updated HTML
      const wordCount = input.bodyHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

      await db.update(articles).set({
        bodyHtml: input.bodyHtml,
        bodyMarkdown: input.bodyMarkdown ?? input.bodyHtml.replace(/<[^>]+>/g, ""),
        wordCount,
      }).where(eq(articles.id, input.articleId));

      return { updated: true, wordCount };
    }),

  /**
   * AI-guided article edit.
   * Takes a natural language instruction and rewrites the article body accordingly.
   * Preserves keyword placement, HTML structure, and SEO fields.
   */
  aiEditInstruction: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      instruction: z.string().min(5).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [article] = await db
        .select({
          businessId: articles.businessId,
          status: articles.status,
          bodyHtml: articles.bodyHtml,
          bodyMarkdown: articles.bodyMarkdown,
          wordCount: articles.wordCount,
        })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      await assertBusinessOwnership(ctx.user.id, article.businessId);

      if (article.status === "published") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Published articles cannot be edited here. Edit directly in your CMS." });
      }

      if (!article.bodyHtml) throw new TRPCError({ code: "BAD_REQUEST", message: "Article has no content to edit." });

      const systemPrompt = `You are an expert SEO content editor. You will receive an article body (HTML) and an editing instruction from the author.

Apply the instruction precisely. Rules:
- Make ONLY the changes described in the instruction — do not rewrite unrelated sections
- Preserve all HTML tags, heading structure, internal links, and keyword placement
- Preserve the closing CTA section exactly as-is
- Use Australian English spelling
- Do not add new sections unless the instruction explicitly asks for them
- Do not change the article title or meta fields

Return ONLY the updated article body as clean HTML, wrapped in these exact delimiters:
<EDITED_HTML>
...full updated HTML here...
</EDITED_HTML>`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `EDITING INSTRUCTION: ${input.instruction}\n\nARTICLE:\n${article.bodyHtml}` },
        ],
        max_tokens: 65536,
      });

      const rawContent = result.choices[0]?.message?.content ?? "";
      const raw = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      const delimMatch = raw.match(/<EDITED_HTML>([\s\S]*?)<\/EDITED_HTML>/i);
      const editedHtml = delimMatch ? delimMatch[1].trim() : raw.trim();

      if (!editedHtml || editedHtml.length < 100) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI edit returned empty content. Please try again." });
      }

      const wordCount = editedHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

      await db.update(articles).set({
        bodyHtml: editedHtml,
        bodyMarkdown: article.bodyMarkdown ?? editedHtml.replace(/<[^>]+>/g, ""),
        wordCount,
      }).where(eq(articles.id, input.articleId));

      return { updated: true, bodyHtml: editedHtml, wordCount };
    }),

  /**
   * Approve a single article.
   * Sets status = approved and records approvedAt timestamp.
   * Regeneration is blocked after approval.
   */
  approve: protectedProcedure
    .input(z.object({ articleId: z.number() }))
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

      if (article.status === "approved" || article.status === "scheduled" || article.status === "published") {
        return { approved: true, alreadyApproved: true };
      }

      if (article.status !== "generated" && article.status !== "pending_approval") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot approve article with status '${article.status}'. Article must be generated first.` });
      }

      await db
        .update(articles)
        .set({ status: "approved", approvedAt: new Date() })
        .where(eq(articles.id, input.articleId));

      return { approved: true, alreadyApproved: false };
    }),

  /**
   * Approve all generated articles for a business in one call.
   * Only approves articles in generated or pending_approval status.
   * Returns count of newly approved articles.
   */
  approveAll: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const toApprove = await db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(
            eq(articles.businessId, input.businessId),
            inArray(articles.status, ["generated", "pending_approval"])
          )
        );

      if (toApprove.length === 0) return { approvedCount: 0 };

      const ids = toApprove.map(a => a.id);
      const now = new Date();

      await db
        .update(articles)
        .set({ status: "approved", approvedAt: now })
        .where(inArray(articles.id, ids));

      return { approvedCount: ids.length };
    }),

  /**
   * Save an image for an article.
   * Accepts either a URL (paste from website) or base64-encoded bytes (upload).
   * If bytes provided, uploads to S3 and saves the storage URL.
   * Auto-generates alt text using the LLM.
   */
  saveImage: protectedProcedure
    .input(z.object({
      articleId: z.number(),
      /** Paste a URL from the user's existing website */
      imageUrl: z.string().url().optional(),
      /** Base64-encoded image bytes for direct upload */
      imageBase64: z.string().optional(),
      /** MIME type for uploaded file, e.g. image/jpeg */
      mimeType: z.string().optional(),
      /** Filename for uploaded file */
      filename: z.string().optional(),
      /** User-provided alt text (overrides AI-generated) */
      altText: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [article] = await db
        .select({ businessId: articles.businessId, title: articles.title })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      await assertBusinessOwnership(ctx.user.id, article.businessId);

      let finalUrl: string;
      let storageKey: string | undefined;

      if (input.imageBase64) {
        // Upload to S3
        const bytes = Buffer.from(input.imageBase64, "base64");
        const filename = input.filename ?? `article-${input.articleId}-image.jpg`;
        const contentType = input.mimeType ?? "image/jpeg";
        const { key, url } = await storagePut(`article-images/${filename}`, bytes, contentType);
        finalUrl = url;
        storageKey = key;
      } else if (input.imageUrl) {
        finalUrl = input.imageUrl;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide either imageUrl or imageBase64." });
      }

      // Auto-generate alt text if not provided
      let altText = input.altText ?? "";
      if (!altText) {
        try {
          const altResp = await invokeLLM({
            messages: [
              { role: "system", content: "You write concise, SEO-optimised image alt text. Return only the alt text string, no quotes, no explanation." },
              { role: "user", content: `Article title: "${article.title ?? ""}". Write alt text for the featured image of this article. Max 125 characters.` },
            ],
          });
          altText = (altResp.choices?.[0]?.message?.content as string ?? "").trim().slice(0, 512);
        } catch {
          altText = article.title ?? "";
        }
      }

      // Upsert article_images row
      const existing = await db
        .select({ id: articleImages.id })
        .from(articleImages)
        .where(eq(articleImages.articleId, input.articleId))
        .limit(1);

      if (existing.length) {
        await db
          .update(articleImages)
          .set({ imageUrl: finalUrl, storageKey: storageKey ?? null, altText })
          .where(eq(articleImages.articleId, input.articleId));
      } else {
        await db.insert(articleImages).values({
          articleId: input.articleId,
          imageUrl: finalUrl,
          storageKey: storageKey ?? null,
          altText,
        });
      }

      return { imageUrl: finalUrl, altText };
    }),

  /**
   * Generate and return an export ZIP for all approved articles in a business.
   * ZIP contains:
   *   - articles/{slug}.html
   *   - articles/{slug}.md
   *   - articles/{slug}-meta.txt
   *   - articles/{slug}-schema.json
   *   - schedule.csv
   *
   * Returns the ZIP as a base64-encoded string so the frontend can trigger a download.
   */
  exportZip: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Fetch all approved articles with their node info
      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          bodyHtml: articles.bodyHtml,
          bodyMarkdown: articles.bodyMarkdown,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          schemaMarkup: articles.schemaMarkup,
          wordCount: articles.wordCount,
          statusBadge: articles.statusBadge,
          scheduledPublishAt: articles.scheduledPublishAt,
          nodeLevel: articleNodes.level,
          nodeUrlSlug: articleNodes.urlSlug,
          imageAltText: articleImages.altText,
        })
        .from(articles)
        .innerJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            inArray(articles.status, ["approved", "scheduled", "published"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No approved articles found. Approve articles before exporting." });
      }

      // Build ZIP in memory
      const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", reject);

        for (const row of rows) {
          const slug = row.urlSlug ?? `article-${row.id}`;

          // HTML file
          const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${row.metaTitle ?? row.title ?? ""}</title>
<meta name="description" content="${row.metaDescription ?? ""}">
${row.schemaMarkup ? `<script type="application/ld+json">${row.schemaMarkup}</script>` : ""}
</head>
<body>
${row.bodyHtml ?? ""}
</body>
</html>`;
          archive.append(htmlContent, { name: `articles/${slug}.html` });

          // Markdown file
          archive.append(row.bodyMarkdown ?? "", { name: `articles/${slug}.md` });

          // Meta text file
          const metaTxt = [
            `Title: ${row.title ?? ""}`,
            `Meta Title: ${row.metaTitle ?? ""}`,
            `Meta Description: ${row.metaDescription ?? ""}`,
            `Focus Keyword: ${row.focusKeyword ?? ""}`,
            `URL Slug: ${row.urlSlug ?? ""}`,
            `Image Alt Text: ${(row as any).imageAltText ?? ""}`,
            `Word Count: ${row.wordCount ?? ""}`,
            `Status: ${row.statusBadge ?? ""}`,
            `Level: ${row.nodeLevel ?? ""}`,
          ].join("\n");
          archive.append(metaTxt, { name: `articles/${slug}-meta.txt` });

          // Schema JSON-LD file
          if (row.schemaMarkup) {
            archive.append(row.schemaMarkup, { name: `articles/${slug}-schema.json` });
          }
        }

        // Schedule CSV
        const csvLines = [
          "Title,Slug,Level,Scheduled Publish Date,Status",
          ...rows.map(r => [
            `"${(r.title ?? "").replace(/"/g, '""')}"`,
            r.urlSlug ?? "",
            r.nodeLevel ?? "",
            r.scheduledPublishAt ? new Date(r.scheduledPublishAt).toISOString().split("T")[0] : "",
            r.statusBadge ?? "",
          ].join(",")),
        ].join("\n");
        archive.append(csvLines, { name: "schedule.csv" });

        archive.finalize();
      });

      return { zipBase64: zipBuffer.toString("base64"), articleCount: rows.length };
    }),

  // ─── Layer 8: CMS Publish ─────────────────────────────────────────────────────

  /**
   * Publish a single article to the connected CMS.
   * Updates article status to published/failed and records cmsPostId/cmsPostUrl.
   */
  publish: protectedProcedure
    .input(
      z.object({
        articleId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Load article with node info
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
          level: articleNodes.level,
          imageUrl: articleImages.imageUrl,
          altText: articleImages.altText,
        })
        .from(articles)
        .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      await assertBusinessOwnership(ctx.user.id, row.businessId);

      if (row.status !== "approved" && row.status !== "scheduled" && row.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Article must be approved before publishing",
        });
      }

      // Load integration credentials
      const [integration] = await db
        .select({ credentialsEncrypted: integrations.credentialsEncrypted })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, row.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (!integration?.credentialsEncrypted) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No ${input.platform} credentials found. Connect your CMS in Integrations first.`,
        });
      }

      const creds = decryptCredentials(integration.credentialsEncrypted);
      if (!creds) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to decrypt CMS credentials" });

      // Apply formatting pass to bodyHtml before publishing:
      // - Ensure bullet list items have margin-bottom for Wix/WordPress spacing
      // - Convert plain Q:/A: FAQ paragraphs to structured format with <hr> dividers
      let publishBodyHtml = row.bodyHtml ?? "";
      publishBodyHtml = publishBodyHtml
        .replace(/<li>/g, '<li style="margin-bottom:0.75em">')
        .replace(/<li /g, '<li style="margin-bottom:0.75em" ');
      publishBodyHtml = publishBodyHtml
        .replace(/<p>\s*Q:\s*/g, '<hr><p><strong>Q: ')
        .replace(/<\/strong>\s*<\/p>\s*<p>\s*A:\s*/g, '</strong></p><p>A: ');

      const payload: ArticlePayload = {
        title: row.title ?? "",
        bodyHtml: publishBodyHtml,
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
      if (input.platform === "wordpress") {
        result = await publishToWordPress(
          {
            siteUrl: creds.siteUrl ?? "",
            username: creds.username ?? "",
            applicationPassword: creds.applicationPassword ?? "",
            seoPlugin: (creds.seoPlugin as "yoast" | "rankmath" | "aioseo" | "none") ?? "none",
          },
          payload
        );
      } else if (input.platform === "wix") {
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

      if (result.success) {
        const isScheduled = row.scheduledPublishAt && row.scheduledPublishAt > new Date();
        await db
          .update(articles)
          .set({
            status: isScheduled ? "scheduled" : "published",
            publishedAt: isScheduled ? null : new Date(),
            cmsPostId: result.cmsPostId ?? null,
            cmsPostUrl: result.cmsPostUrl ?? null,
            errorMessage: null,
          })
          .where(eq(articles.id, input.articleId));
      } else {
        await db
          .update(articles)
          .set({
            status: "failed",
            errorMessage: result.error ?? "Publish failed",
          })
          .where(eq(articles.id, input.articleId));

        // Notify owner of publish failure
        await notifyOwner({
          title: `Publish failed: ${row.title ?? "Article"}`,
          content: `Article "${row.title ?? "Article"}" failed to publish to ${input.platform}.\nError: ${result.error ?? "Unknown error"}\nBusiness ID: ${row.businessId}`,
        });
      }

      return { success: result.success, error: result.error, cmsPostUrl: result.cmsPostUrl };
    }),

  /**
   * Publish all approved articles for a business to the connected CMS.
   * Processes articles one at a time in generation order.
   */
  publishAll: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Load integration credentials
      const [integration] = await db
        .select({ credentialsEncrypted: integrations.credentialsEncrypted })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, input.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (!integration?.credentialsEncrypted) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No ${input.platform} credentials found. Connect your CMS in Integrations first.`,
        });
      }

      const creds = decryptCredentials(integration.credentialsEncrypted);
      if (!creds) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to decrypt CMS credentials" });

      // Load all approved articles in generation order
      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          bodyHtml: articles.bodyHtml,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          schemaMarkup: articles.schemaMarkup,
          scheduledPublishAt: articles.scheduledPublishAt,
          level: articleNodes.level,
          imageUrl: articleImages.imageUrl,
          altText: articleImages.altText,
        })
        .from(articles)
        .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
        .where(
          and(
            eq(articles.businessId, input.businessId),
            inArray(articles.status, ["approved", "scheduled"])
          )
        )
        .orderBy(articleNodes.sortOrder);

      if (rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No approved articles to publish" });
      }

      let published = 0;
      let failed = 0;
      const failures: { title: string; error: string }[] = [];

      for (const row of rows) {
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
        if (input.platform === "wordpress") {
          result = await publishToWordPress(
            {
              siteUrl: creds.siteUrl ?? "",
              username: creds.username ?? "",
              applicationPassword: creds.applicationPassword ?? "",
              seoPlugin: (creds.seoPlugin as "yoast" | "rankmath" | "aioseo" | "none") ?? "none",
            },
            payload
          );
        } else if (input.platform === "wix") {
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

        if (result.success) {
          const isScheduled = row.scheduledPublishAt && row.scheduledPublishAt > new Date();
          await db
            .update(articles)
            .set({
              status: isScheduled ? "scheduled" : "published",
              publishedAt: isScheduled ? null : new Date(),
              cmsPostId: result.cmsPostId ?? null,
              cmsPostUrl: result.cmsPostUrl ?? null,
              errorMessage: null,
            })
            .where(eq(articles.id, row.id));
          published++;
        } else {
          await db
            .update(articles)
            .set({
              status: "failed",
              errorMessage: result.error ?? "Publish failed",
            })
            .where(eq(articles.id, row.id));
          failed++;
          failures.push({ title: row.title ?? "Article", error: result.error ?? "Unknown error" });
        }
      }

      // Notify owner if any failures
      if (failures.length > 0) {
        await notifyOwner({
          title: `Publish batch completed with ${failures.length} failure(s)`,
          content: `Published ${published}/${rows.length} articles to ${input.platform}.\n\nFailed:\n${failures.map(f => `\u2022 ${f.title}: ${f.error}`).join("\n")}`,
        });
      }

      return { total: rows.length, published, failed, failures };
    }),

  /**
   * Publish a single approved article to the connected CMS immediately.
   */
  publishSingle: protectedProcedure
    .input(
      z.object({
        articleId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier"]),
        publishAs: z.enum(["live", "draft"]).default("live"),
        scheduledAt: z.number().optional(), // UTC ms timestamp for scheduled publish
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Load article with node + image
      const [row] = await db
        .select({
          id: articles.id,
          businessId: articles.businessId,
          status: articles.status,
          title: articles.title,
          bodyHtml: articles.bodyHtml,
          metaTitle: articles.metaTitle,
          metaDescription: articles.metaDescription,
          focusKeyword: articles.focusKeyword,
          urlSlug: articles.urlSlug,
          schemaMarkup: articles.schemaMarkup,
          level: articleNodes.level,
          imageUrl: articleImages.imageUrl,
          altText: articleImages.altText,
        })
        .from(articles)
        .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
        .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      await assertBusinessOwnership(ctx.user.id, row.businessId);

      if (!(["approved", "scheduled", "generated", "pending_approval", "published"].includes(row.status))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Article must be approved before publishing" });
      }

      // Load integration credentials
      const [integration] = await db
        .select({ credentialsEncrypted: integrations.credentialsEncrypted })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, row.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (!integration?.credentialsEncrypted) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No ${input.platform} credentials found. Connect your CMS in Integrations first.`,
        });
      }

      const creds = decryptCredentials(integration.credentialsEncrypted);
      if (!creds) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to decrypt CMS credentials" });

      const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;

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
        scheduledPublishAt: scheduledDate,
        level: (row.level ?? "cluster") as "cornerstone" | "pillar" | "cluster",
        publishAsDraft: input.publishAs === "draft",
      };

      let result;
      if (input.platform === "wordpress") {
        result = await publishToWordPress(
          {
            siteUrl: creds.siteUrl ?? "",
            username: creds.username ?? "",
            applicationPassword: creds.applicationPassword ?? "",
            seoPlugin: (creds.seoPlugin as "yoast" | "rankmath" | "aioseo" | "none") ?? "none",
          },
          payload
        );
      } else if (input.platform === "wix") {
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

      if (result.success) {
        const isScheduled = scheduledDate && scheduledDate > new Date();
        const isDraft = input.publishAs === "draft";
        await db
          .update(articles)
          .set({
            status: isDraft ? "approved" : isScheduled ? "scheduled" : "published",
            publishedAt: isDraft || isScheduled ? null : new Date(),
            scheduledPublishAt: scheduledDate,
            cmsPostId: result.cmsPostId ?? null,
            cmsPostUrl: result.cmsPostUrl ?? null,
            errorMessage: null,
          })
          .where(eq(articles.id, input.articleId));
        return {
          success: true,
          cmsPostUrl: result.cmsPostUrl ?? null,
          cmsPostId: result.cmsPostId ?? null,
          status: isDraft ? "draft_pushed" : isScheduled ? "scheduled" : "published",
        };
      } else {
        await db
          .update(articles)
          .set({ status: "failed", errorMessage: result.error ?? "Publish failed" })
          .where(eq(articles.id, input.articleId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "Publish failed" });
      }
    }),

  /**
   * Retry publishing a single failed article.
   * Resets status to approved so publish can be called again.
   */
  retryPublish: protectedProcedure
    .input(
      z.object({
        articleId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select({ id: articles.id, status: articles.status, businessId: articles.businessId })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Article not found" });
      await assertBusinessOwnership(ctx.user.id, row.businessId);

      if (row.status !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed articles can be retried" });
      }

      // Reset to approved so the publish mutation can be called again
      await db
        .update(articles)
        .set({ status: "approved", errorMessage: null })
        .where(eq(articles.id, input.articleId));

      return { readyToPublish: true };
    }),
});
