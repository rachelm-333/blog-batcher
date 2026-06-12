/**
 * Layer 4 — Stage 2: Blog Architecture
 *
 * Procedures:
 *  architecture.getOrCreate    — get existing architecture or return null
 *  architecture.initDefault    — create the default architecture for a business
 *  architecture.update         — update cornerstones/pillars/clusters, validate guardrails server-side
 *  architecture.setArticleType — set article type for a specific article_node
 *  architecture.confirm        — lock the architecture, advance stage to 3
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  articles,
  blogArchitectures,
  businesses,
  keywords,
} from "../../drizzle/schema";
import {
  ARTICLE_TYPES,
  DEFAULT_ARCHITECTURE,
  DEFAULT_CLUSTERS_PER_PILLAR,
  MAX_CLUSTERS_PER_PILLAR,
  MAX_CORNERSTONES,
  MAX_PILLARS_PER_CORNERSTONE,
  MIN_CLUSTERS_PER_PILLAR,
  MIN_CORNERSTONES,
  MIN_PILLARS_PER_CORNERSTONE,
  calcTotalArticles,
  generateNodes,
  validateArchitecture,
} from "../../shared/architectureRules";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ─── Ownership helper ─────────────────────────────────────────────────────────

async function assertBusinessOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select({ id: businesses.id, currentStage: businesses.currentStage, activeBatch: businesses.activeBatch })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!rows.length) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  return rows[0];
}

// ─── Node generation helper ───────────────────────────────────────────────────

/**
 * Deletes all existing article_nodes for this architecture and regenerates them
 * based on the current cornerstoneCount, pillarCount, and clustersPerPillar.
 */
async function regenerateNodes(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  architectureId: number,
  businessId: number,
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = DEFAULT_CLUSTERS_PER_PILLAR
) {
  // Delete child rows first (foreign key constraints: articles → keywords → article_nodes)
  const existingNodes = await db
    .select({ id: articleNodes.id })
    .from(articleNodes)
    .where(eq(articleNodes.architectureId, architectureId));
  const nodeIds = existingNodes.map((n) => n.id);
  if (nodeIds.length > 0) {
    // Delete articles referencing these nodes
    for (const nodeId of nodeIds) {
      await db.delete(articles).where(eq(articles.articleNodeId, nodeId));
    }
    // Delete keywords referencing these nodes
    for (const nodeId of nodeIds) {
      await db.delete(keywords).where(eq(keywords.articleNodeId, nodeId));
    }
  }
  // Now safe to delete the nodes themselves
  await db
    .delete(articleNodes)
    .where(eq(articleNodes.architectureId, architectureId));

  // Generate new node list
  const nodes = generateNodes(cornerstones, pillarsPerCornerstone, clustersPerPillar);

  let sortOrder = 0;

  // Pass 1: Cornerstones (only in full hierarchy mode)
  const cornerstoneNodes = nodes.filter((n) => n.level === "cornerstone");
  for (const n of cornerstoneNodes) {
    await db.insert(articleNodes).values({
      architectureId,
      businessId,
      level: "cornerstone",
      articleType: n.defaultArticleType,
      parentCornerstoneId: null,
      parentPillarId: null,
      sortOrder: sortOrder++,
    });
  }

  // Re-query cornerstone IDs in order
  const insertedCornerstones = await db
    .select({ id: articleNodes.id, sortOrder: articleNodes.sortOrder })
    .from(articleNodes)
    .where(
      and(
        eq(articleNodes.architectureId, architectureId),
        eq(articleNodes.level, "cornerstone")
      )
    );
  insertedCornerstones.sort((a, b) => a.sortOrder - b.sortOrder);

  // Pass 2: Pillars (hierarchy or standalone)
  const pillarNodes = nodes.filter((n) => n.level === "pillar");
  for (const n of pillarNodes) {
    // cornerstoneIndex === 0 means standalone pillar (no parent cornerstone)
    const cornerstoneRow = n.cornerstoneIndex > 0 ? insertedCornerstones[n.cornerstoneIndex - 1] : null;
    await db.insert(articleNodes).values({
      architectureId,
      businessId,
      level: "pillar",
      articleType: n.defaultArticleType,
      parentCornerstoneId: cornerstoneRow?.id ?? null,
      parentPillarId: null,
      sortOrder: sortOrder++,
    });
  }

  // Re-query pillar IDs in order
  const insertedPillars = await db
    .select({
      id: articleNodes.id,
      parentCornerstoneId: articleNodes.parentCornerstoneId,
      sortOrder: articleNodes.sortOrder,
    })
    .from(articleNodes)
    .where(
      and(
        eq(articleNodes.architectureId, architectureId),
        eq(articleNodes.level, "pillar")
      )
    );
  insertedPillars.sort((a, b) => a.sortOrder - b.sortOrder);

  // Pass 3: Clusters (hierarchy, pillar-parented standalone, or fully standalone)
  const clusterNodes = nodes.filter((n) => n.level === "cluster");
  for (const n of clusterNodes) {
    if (n.cornerstoneIndex > 0) {
      // Full hierarchy cluster
      const cornerstoneRow = insertedCornerstones[n.cornerstoneIndex - 1];
      if (!cornerstoneRow) continue;
      const pillarsUnderCornerstone = insertedPillars.filter(
        (p) => p.parentCornerstoneId === cornerstoneRow.id
      );
      const pillarRow = pillarsUnderCornerstone[n.pillarIndex! - 1];
      if (!pillarRow) continue;
      await db.insert(articleNodes).values({
        architectureId,
        businessId,
        level: "cluster",
        articleType: n.defaultArticleType,
        parentCornerstoneId: cornerstoneRow.id,
        parentPillarId: pillarRow.id,
        sortOrder: sortOrder++,
      });
    } else if (n.pillarIndex !== null) {
      // Standalone cluster under a standalone pillar
      const pillarRow = insertedPillars[n.pillarIndex - 1];
      await db.insert(articleNodes).values({
        architectureId,
        businessId,
        level: "cluster",
        articleType: n.defaultArticleType,
        parentCornerstoneId: null,
        parentPillarId: pillarRow?.id ?? null,
        sortOrder: sortOrder++,
      });
    } else {
      // Fully standalone cluster (no cornerstone, no pillar)
      await db.insert(articleNodes).values({
        architectureId,
        businessId,
        level: "cluster",
        articleType: n.defaultArticleType,
        parentCornerstoneId: null,
        parentPillarId: null,
        sortOrder: sortOrder++,
      });
    }
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const architectureRouter = router({
  // -------------------------------------------------------------------------
  // GET OR CREATE — returns the architecture for this business, or null.
  // -------------------------------------------------------------------------
  getOrCreate: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const biz = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatch = biz.activeBatch ?? 1;

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatch)))
        .limit(1);

      if (existing.length > 0) {
        const arch = existing[0];
        const nodes = await db
          .select()
          .from(articleNodes)
          .where(and(eq(articleNodes.architectureId, arch.id), eq(articleNodes.batchNumber, activeBatch)));

        return { architecture: arch, nodes };
      }

      return { architecture: null, nodes: [] };
    }),

  // -------------------------------------------------------------------------
  // INIT DEFAULT — creates the architecture row with default config.
  // Called when the user first arrives at the Architecture page.
  // -------------------------------------------------------------------------
  initDefault: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const biz2 = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatch2 = biz2.activeBatch ?? 1;

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatch2)))
        .limit(1);

      if (existing.length > 0 && existing[0].confirmed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Architecture is already confirmed and cannot be changed.",
        });
      }

      const defaults = DEFAULT_ARCHITECTURE;
      const total = calcTotalArticles(
        defaults.cornerstones,
        defaults.pillarsPerCornerstone,
        defaults.clustersPerPillar
      );

      let architectureId: number;

      if (existing.length > 0) {
        await db
          .update(blogArchitectures)
          .set({
            cornerstoneCount: defaults.cornerstones,
            pillarCount: defaults.pillarsPerCornerstone,
            clustersPerPillar: defaults.clustersPerPillar,
            totalArticleCount: total,
          })
          .where(eq(blogArchitectures.id, existing[0].id));
        architectureId = existing[0].id;
      } else {
        const result = await db.insert(blogArchitectures).values({
          businessId: input.businessId,
          batchNumber: activeBatch2,
          packSize: 0, // no fixed pack size — total is free-form
          cornerstoneCount: defaults.cornerstones,
          pillarCount: defaults.pillarsPerCornerstone,
          clustersPerPillar: defaults.clustersPerPillar,
          totalArticleCount: total,
          confirmed: false,
        });
        architectureId = (result as any)[0]?.insertId ?? (result as any).insertId;
      }

      await regenerateNodes(
        db,
        architectureId,
        input.businessId,
        defaults.cornerstones,
        defaults.pillarsPerCornerstone,
        defaults.clustersPerPillar
      );

      const arch = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.id, architectureId))
        .limit(1);
      const nodes = await db
        .select()
        .from(articleNodes)
        .where(eq(articleNodes.architectureId, architectureId));

      return { architecture: arch[0], nodes };
    }),

  // Keep setPackSize as a no-op alias for backward compatibility
  setPackSize: protectedProcedure
    .input(z.object({ businessId: z.number(), packSize: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Delegate to initDefault — pack size is no longer meaningful
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const bizSP = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatchSP = bizSP.activeBatch ?? 1;

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatchSP)))
        .limit(1);

      if (existing.length > 0) {
        return { architecture: existing[0], nodes: [] };
      }

      const defaults = DEFAULT_ARCHITECTURE;
      const total = calcTotalArticles(defaults.cornerstones, defaults.pillarsPerCornerstone, defaults.clustersPerPillar);
      const result = await db.insert(blogArchitectures).values({
        businessId: input.businessId,
        batchNumber: activeBatchSP,
        packSize: 0,
        cornerstoneCount: defaults.cornerstones,
        pillarCount: defaults.pillarsPerCornerstone,
        clustersPerPillar: defaults.clustersPerPillar,
        totalArticleCount: total,
        confirmed: false,
      });
      const architectureId = (result as any)[0]?.insertId ?? (result as any).insertId;
      await regenerateNodes(db, architectureId, input.businessId, defaults.cornerstones, defaults.pillarsPerCornerstone, defaults.clustersPerPillar);
      const arch = await db.select().from(blogArchitectures).where(eq(blogArchitectures.id, architectureId)).limit(1);
      const nodes = await db.select().from(articleNodes).where(eq(articleNodes.architectureId, architectureId));
      return { architecture: arch[0], nodes };
    }),

  // -------------------------------------------------------------------------
  // UPDATE — adjust cornerstones, pillars, and clusters counts.
  // Guardrails validated server-side. Regenerates article_nodes on every update.
  // -------------------------------------------------------------------------
  update: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        cornerstones: z.number().int().min(MIN_CORNERSTONES).max(MAX_CORNERSTONES),
        pillarsPerCornerstone: z.number().int().min(MIN_PILLARS_PER_CORNERSTONE).max(MAX_PILLARS_PER_CORNERSTONE),
        clustersPerPillar: z.number().int().min(MIN_CLUSTERS_PER_PILLAR).max(MAX_CLUSTERS_PER_PILLAR).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const bizU = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatchU = bizU.activeBatch ?? 1;

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatchU)))
        .limit(1);

      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No architecture found. Please initialise first." });
      }
      const arch = existing[0];
      if (arch.confirmed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Architecture is locked after confirmation." });
      }

      const proposedClusters = input.clustersPerPillar ?? arch.clustersPerPillar ?? DEFAULT_CLUSTERS_PER_PILLAR;

      // Run guardrails (no pack-size constraint)
      const guardrail = validateArchitecture(
        null,
        input.cornerstones,
        input.pillarsPerCornerstone,
        proposedClusters
      );

      const finalCornerstones = guardrail.correctedCornerstones;
      const finalPillars = guardrail.correctedPillarsPerCornerstone;
      const finalClusters = guardrail.correctedClustersPerPillar;
      const total = calcTotalArticles(finalCornerstones, finalPillars, finalClusters);

      await db
        .update(blogArchitectures)
        .set({
          cornerstoneCount: finalCornerstones,
          pillarCount: finalPillars,
          clustersPerPillar: finalClusters,
          totalArticleCount: total,
        })
        .where(eq(blogArchitectures.id, arch.id));

      // Regenerate nodes
      await regenerateNodes(db, arch.id, input.businessId, finalCornerstones, finalPillars, finalClusters);

      const updatedArch = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.id, arch.id))
        .limit(1);
      const nodes = await db
        .select()
        .from(articleNodes)
        .where(eq(articleNodes.architectureId, arch.id));

      return {
        architecture: updatedArch[0],
        nodes,
        guardrailWarnings: guardrail.warnings,
        wasAdjusted: !guardrail.valid,
      };
    }),

  // -------------------------------------------------------------------------
  // UNLOCK — unconfirm a locked architecture so the user can edit the sliders
  // again. This does NOT delete nodes or keywords — that happens when they
  // hit Apply Changes, which calls regenerateNodes.
  // -------------------------------------------------------------------------
  unlock: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const bizUL = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatchUL = bizUL.activeBatch ?? 1;
      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatchUL)))
        .limit(1);
      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No architecture found." });
      }
      await db
        .update(blogArchitectures)
        .set({ confirmed: false })
        .where(eq(blogArchitectures.id, existing[0].id));
      return { unlocked: true };
    }),

  // -------------------------------------------------------------------------
  // REBUILD NODES — force-regenerate article nodes from current architecture
  // config even when confirmed. Used when user changes architecture after
  // keyword assignment (e.g., changed cornerstones/pillars/clusters).
  // -------------------------------------------------------------------------
  rebuildNodes: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const bizRB = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatchRB = bizRB.activeBatch ?? 1;
      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatchRB)))
        .limit(1);
      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No architecture found." });
      }
      const arch = existing[0];
      const clusters = arch.clustersPerPillar ?? DEFAULT_CLUSTERS_PER_PILLAR;
      const total = calcTotalArticles(arch.cornerstoneCount, arch.pillarCount, clusters);
      // Update total count
      await db
        .update(blogArchitectures)
        .set({ totalArticleCount: total })
        .where(eq(blogArchitectures.id, arch.id));
      // Regenerate nodes (deletes old ones)
      await regenerateNodes(db, arch.id, input.businessId, arch.cornerstoneCount, arch.pillarCount, clusters);
      const nodes = await db
        .select()
        .from(articleNodes)
        .where(eq(articleNodes.architectureId, arch.id));
      return { rebuilt: nodes.length, total };
    }),

  // -------------------------------------------------------------------------
  // SET ARTICLE TYPE — update the article type for a single pillar node.
  // -------------------------------------------------------------------------
  setArticleType: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        nodeId: z.number(),
        articleType: z.enum(ARTICLE_TYPES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const node = await db
        .select()
        .from(articleNodes)
        .where(and(eq(articleNodes.id, input.nodeId), eq(articleNodes.businessId, input.businessId)))
        .limit(1);

      if (!node.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Article node not found." });
      }

      if (node[0].level === "cornerstone") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cornerstone article type is fixed as 'Cornerstone Guide' and cannot be changed.",
        });
      }

      if (node[0].level === "cluster") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cluster article types are auto-assigned and cannot be changed manually.",
        });
      }

      await db
        .update(articleNodes)
        .set({ articleType: input.articleType })
        .where(eq(articleNodes.id, input.nodeId));

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // CONFIRM — lock the architecture and advance the business stage to 3.
  // -------------------------------------------------------------------------
  confirm: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const bizC = await assertBusinessOwnership(ctx.user.id, input.businessId);
      const activeBatchC = bizC.activeBatch ?? 1;

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(and(eq(blogArchitectures.businessId, input.businessId), eq(blogArchitectures.batchNumber, activeBatchC)))
        .limit(1);

      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No architecture to confirm." });
      }

      const arch = existing[0];

      // Validate the current config one final time (no pack-size constraint)
      const guardrail = validateArchitecture(
        null,
        arch.cornerstoneCount,
        arch.pillarCount,
        arch.clustersPerPillar ?? DEFAULT_CLUSTERS_PER_PILLAR
      );
      if (!guardrail.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Architecture configuration is invalid: ${guardrail.warnings.join(" ")}`,
        });
      }

      // Lock architecture
      await db
        .update(blogArchitectures)
        .set({ confirmed: true })
        .where(eq(blogArchitectures.id, arch.id));

      // Advance business stage to 3
      await db
        .update(businesses)
        .set({ currentStage: 3 })
        .where(eq(businesses.id, input.businessId));

      return { success: true };
    }),
});
