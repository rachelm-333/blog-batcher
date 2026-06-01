/**
 * Layer 4 — Stage 2: Blog Architecture
 *
 * Procedures:
 *  architecture.getOrCreate  — get existing architecture or create default for the business
 *  architecture.update       — update cornerstones/pillars, validate guardrails server-side
 *  architecture.setPackSize  — select pack size (20 or 50), locked once set
 *  architecture.setArticleType — set article type for a specific article_node
 *  architecture.confirm      — lock the architecture, advance stage to 3
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  blogArchitectures,
  businesses,
} from "../../drizzle/schema";
import {
  ARTICLE_TYPES,
  DEFAULT_ARCHITECTURE,
  PACK_SIZES,
  calcTotalArticles,
  generateNodes,
  validateArchitecture,
  type PackSize,
} from "../../shared/architectureRules";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ─── Ownership helper ─────────────────────────────────────────────────────────

async function assertBusinessOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select({ id: businesses.id, currentStage: businesses.currentStage })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!rows.length) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
  return rows[0];
}

// ─── Node generation helper ───────────────────────────────────────────────────

/**
 * Deletes all existing article_nodes for this architecture and regenerates them
 * based on the current cornerstoneCount and pillarCount.
 */
async function regenerateNodes(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  architectureId: number,
  businessId: number,
  cornerstones: number,
  pillarsPerCornerstone: number
) {
  // Delete existing nodes
  await db
    .delete(articleNodes)
    .where(eq(articleNodes.architectureId, architectureId));

  // Generate new node list
  const nodes = generateNodes(cornerstones, pillarsPerCornerstone);

  // We need to insert in two passes: cornerstones first (to get their IDs),
  // then pillars (referencing cornerstone IDs), then clusters.
  // Because MySQL doesn't support RETURNING, we insert level by level and
  // re-query IDs after each pass.

  let sortOrder = 0;

  // Pass 1: Cornerstones
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

  // Pass 2: Pillars
  const pillarNodes = nodes.filter((n) => n.level === "pillar");
  for (const n of pillarNodes) {
    const cornerstoneRow = insertedCornerstones[n.cornerstoneIndex - 1];
    if (!cornerstoneRow) continue;
    await db.insert(articleNodes).values({
      architectureId,
      businessId,
      level: "pillar",
      articleType: n.defaultArticleType,
      parentCornerstoneId: cornerstoneRow.id,
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

  // Pass 3: Clusters
  const clusterNodes = nodes.filter((n) => n.level === "cluster");
  for (const n of clusterNodes) {
    const cornerstoneRow = insertedCornerstones[n.cornerstoneIndex - 1];
    if (!cornerstoneRow) continue;

    // Find the matching pillar: it belongs to this cornerstone and is the p-th pillar under it
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
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const architectureRouter = router({
  // -------------------------------------------------------------------------
  // GET OR CREATE — returns the architecture for this business, creating a
  // default one if none exists yet.
  // -------------------------------------------------------------------------
  getOrCreate: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Check for existing architecture
      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, input.businessId))
        .limit(1);

      if (existing.length > 0) {
        const arch = existing[0];
        // Fetch nodes
        const nodes = await db
          .select()
          .from(articleNodes)
          .where(eq(articleNodes.architectureId, arch.id));
        return { architecture: arch, nodes };
      }

      // No architecture yet — return null (pack must be selected first)
      return { architecture: null, nodes: [] };
    }),

  // -------------------------------------------------------------------------
  // SET PACK SIZE — creates the architecture row with default config for the
  // selected pack. Pack is locked once set.
  // -------------------------------------------------------------------------
  setPackSize: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        packSize: z.union([z.literal(20), z.literal(50)]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Check if architecture already exists
      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, input.businessId))
        .limit(1);

      if (existing.length > 0 && existing[0].confirmed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Architecture is already confirmed and cannot be changed.",
        });
      }

      const packSize = input.packSize as PackSize;
      const defaults = DEFAULT_ARCHITECTURE[packSize];
      const total = calcTotalArticles(defaults.cornerstones, defaults.pillarsPerCornerstone);

      let architectureId: number;

      if (existing.length > 0) {
        // Update existing
        await db
          .update(blogArchitectures)
          .set({
            packSize,
            cornerstoneCount: defaults.cornerstones,
            pillarCount: defaults.pillarsPerCornerstone,
            clustersPerPillar: 3,
            totalArticleCount: total,
          })
          .where(eq(blogArchitectures.id, existing[0].id));
        architectureId = existing[0].id;
      } else {
        // Insert new
        const result = await db.insert(blogArchitectures).values({
          businessId: input.businessId,
          packSize,
          cornerstoneCount: defaults.cornerstones,
          pillarCount: defaults.pillarsPerCornerstone,
          clustersPerPillar: 3,
          totalArticleCount: total,
          confirmed: false,
        });
        architectureId = (result as any)[0]?.insertId ?? (result as any).insertId;
      }

      // Regenerate nodes for the default config
      await regenerateNodes(
        db,
        architectureId,
        input.businessId,
        defaults.cornerstones,
        defaults.pillarsPerCornerstone
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

  // -------------------------------------------------------------------------
  // UPDATE — adjust cornerstones and pillars counts. Guardrails validated
  // server-side. Regenerates article_nodes on every update.
  // -------------------------------------------------------------------------
  update: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        cornerstones: z.number().int().min(1).max(4),
        pillarsPerCornerstone: z.number().int().min(1).max(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, input.businessId))
        .limit(1);

      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select a pack size first." });
      }
      const arch = existing[0];
      if (arch.confirmed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Architecture is locked after confirmation." });
      }

      // Run guardrails
      const guardrail = validateArchitecture(
        arch.packSize as PackSize,
        input.cornerstones,
        input.pillarsPerCornerstone
      );

      const finalCornerstones = guardrail.correctedCornerstones;
      const finalPillars = guardrail.correctedPillarsPerCornerstone;
      const total = calcTotalArticles(finalCornerstones, finalPillars);

      await db
        .update(blogArchitectures)
        .set({
          cornerstoneCount: finalCornerstones,
          pillarCount: finalPillars,
          totalArticleCount: total,
        })
        .where(eq(blogArchitectures.id, arch.id));

      // Regenerate nodes
      await regenerateNodes(db, arch.id, input.businessId, finalCornerstones, finalPillars);

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
  // SET ARTICLE TYPE — update the article type for a single pillar node.
  // Cluster types are auto-assigned and cannot be changed here.
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

      // Verify the node belongs to this business
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

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const existing = await db
        .select()
        .from(blogArchitectures)
        .where(eq(blogArchitectures.businessId, input.businessId))
        .limit(1);

      if (!existing.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No architecture to confirm." });
      }

      const arch = existing[0];

      // Validate the current config one final time
      const guardrail = validateArchitecture(
        arch.packSize as PackSize,
        arch.cornerstoneCount,
        arch.pillarCount
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
