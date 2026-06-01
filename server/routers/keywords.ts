/**
 * Layer 5 — Stage 3: SEO Keyword Research
 *
 * Procedures:
 *  keywords.assignAll   — auto-assign one primary keyword to every article_node
 *  keywords.getAll      — return all keywords for a business with node info
 *  keywords.swap        — replace a keyword with a DataForSEO alternative
 *  keywords.approveOne  — approve a single keyword row
 *  keywords.approveAll  — approve all keywords (blocks on duplicates / cannibalization)
 *  keywords.fetchPAA    — fetch PAA questions for all approved keywords
 *  keywords.approvePAA  — approve the PAA set for one node; advances stage when all done
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  businesses,
  brandVoice,
  keywords,
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  getKeywordData,
  getKeywordSuggestions,
  getPAAQuestions,
} from "../dataforseo";
import {
  checkCannibalization,
  type KeywordEntry,
} from "../../shared/cannibalizationCheck";

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

// ---------------------------------------------------------------------------
// Claude fallback: generate keyword suggestions when DataForSEO is unavailable
// ---------------------------------------------------------------------------

async function generateKeywordsViaClaude(
  nodes: Array<{ id: number; level: string; articleType: string; sortOrder: number }>,
  businessName: string,
  industry: string,
  location: string,
  voiceBrief: string,
  exclusions: string[]
): Promise<Map<number, string>> {
  const nodeDescriptions = nodes.map(
    (n) => `Node ${n.id}: level=${n.level}, type=${n.articleType}, order=${n.sortOrder}`
  );

  const prompt = `You are an SEO keyword strategist. Assign one primary keyword to each article slot for the following business.

Business: ${businessName}
Industry: ${industry}
Location: ${location}
Voice brief excerpt: ${voiceBrief.slice(0, 200)}
Excluded topics: ${exclusions.join(", ") || "none"}

Article slots:
${nodeDescriptions.join("\n")}

Rules:
- Cornerstones: broad, high-volume keywords (head terms)
- Pillars: mid-tail keywords within the cornerstone topic
- Clusters: specific long-tail keywords (3-5 words)
- Every keyword must be unique — zero cannibalization
- Australian English, Australian market focus
- Keywords must match the article type intent

Return a JSON object mapping node ID to keyword string only. Example: {"1": "plumber Gold Coast", "2": "emergency plumber Gold Coast"}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an SEO keyword strategist. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "keyword_assignments",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
    },
  });

  const content = response?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as Record<string, string>;
  const map = new Map<number, string>();
  for (const [k, v] of Object.entries(parsed)) {
    map.set(parseInt(k, 10), v);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const keywordsRouter = router({
  // -------------------------------------------------------------------------
  // keywords.assignAll
  // Auto-assign one primary keyword to every article_node for the business.
  // Uses DataForSEO for keyword data; falls back to Claude if unavailable.
  // -------------------------------------------------------------------------
  assignAll: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      // Fetch business profile for context
      const [biz] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);

      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      // Fetch brand voice brief
      const [voice] = await db
        .select({ finalVoiceBrief: brandVoice.finalVoiceBrief })
        .from(brandVoice)
        .where(eq(brandVoice.businessId, input.businessId))
        .limit(1);

      // Fetch all article nodes for this business
      const nodes = await db
        .select()
        .from(articleNodes)
        .where(eq(articleNodes.businessId, input.businessId));

      if (!nodes.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No article nodes found. Complete Stage 2 first." });
      }

      // Delete any existing keyword rows for this business (re-assign)
      await db.delete(keywords).where(eq(keywords.businessId, input.businessId));

      // Generate keyword suggestions using Claude (DataForSEO enrichment happens after)
      const exclusions = biz.keywordExclusions
        ? biz.keywordExclusions.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const kwMap = await generateKeywordsViaClaude(
        nodes.map((n) => ({ id: n.id, level: n.level, articleType: n.articleType, sortOrder: n.sortOrder })),
        biz.name,
        biz.industry ?? "",
        biz.location ?? "",
        voice?.finalVoiceBrief ?? "",
        exclusions
      );

      // Enrich with DataForSEO data if credentials are available
      const kwList = Array.from(kwMap.values());
      let dfsData: Map<string, { msv: number | null; comp: "high" | "medium" | "low" | null }> = new Map();

      if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
        try {
          const dfsResults = await getKeywordData(kwList);
          for (const r of dfsResults) {
            dfsData.set(r.keyword, { msv: r.monthlySearchVolume, comp: r.competitionLevel });
          }
        } catch (err) {
          console.warn("[Keywords] DataForSEO enrichment failed, proceeding without MSV data:", err);
        }
      }

      // Insert keyword rows
      const insertRows = nodes.map((node) => {
        const kw = kwMap.get(node.id) ?? `${biz.name} ${node.level} ${node.sortOrder}`;
        const enriched = dfsData.get(kw);
        return {
          articleNodeId: node.id,
          businessId: input.businessId,
          primaryKeyword: kw,
          monthlySearchVolume: enriched?.msv ?? null,
          competitionLevel: enriched?.comp === "low" ? null : (enriched?.comp ?? null),
          keywordApproved: false,
          paaApproved: false,
          cannibalizationWarning: false,
        };
      });

      await db.insert(keywords).values(insertRows);

      return { assigned: insertRows.length };
    }),

  // -------------------------------------------------------------------------
  // keywords.getAll
  // Return all keywords for a business with their article node info.
  // -------------------------------------------------------------------------
  getAll: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const rows = await db
        .select({
          // keyword fields
          id: keywords.id,
          articleNodeId: keywords.articleNodeId,
          primaryKeyword: keywords.primaryKeyword,
          monthlySearchVolume: keywords.monthlySearchVolume,
          competitionLevel: keywords.competitionLevel,
          secondaryKeywords: keywords.secondaryKeywords,
          paaQuestions: keywords.paaQuestions,
          approvedPaaQuestion: keywords.approvedPaaQuestion,
          keywordApproved: keywords.keywordApproved,
          paaApproved: keywords.paaApproved,
          cannibalizationWarning: keywords.cannibalizationWarning,
          // node fields
          nodeLevel: articleNodes.level,
          nodeArticleType: articleNodes.articleType,
          nodeSortOrder: articleNodes.sortOrder,
          nodeParentCornerstoneId: articleNodes.parentCornerstoneId,
          nodeParentPillarId: articleNodes.parentPillarId,
        })
        .from(keywords)
        .innerJoin(articleNodes, eq(keywords.articleNodeId, articleNodes.id))
        .where(eq(keywords.businessId, input.businessId))
        .orderBy(articleNodes.sortOrder);

      return rows;
    }),

  // -------------------------------------------------------------------------
  // keywords.swap
  // Replace a keyword with a DataForSEO alternative suggestion.
  // Returns 5 suggestions; caller then calls approveOne with the chosen one.
  // -------------------------------------------------------------------------
  swap: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        keywordId: z.number(),
        newKeyword: z.string().min(1).optional(), // if provided, directly swap; otherwise fetch suggestions
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const [kw] = await db
        .select()
        .from(keywords)
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.businessId, input.businessId)))
        .limit(1);

      if (!kw) throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });

      if (input.newKeyword) {
        // Direct swap — enrich with DataForSEO data
        let msv: number | null = null;
        let comp: "high" | "medium" | "low" | null = null;

        try {
          const [data] = await getKeywordData([input.newKeyword]);
          if (data) {
            msv = data.monthlySearchVolume;
            comp = data.competitionLevel;
          }
        } catch {
          // non-fatal
        }

        await db
          .update(keywords)
          .set({
            primaryKeyword: input.newKeyword,
            monthlySearchVolume: msv,
            competitionLevel: comp === "low" ? null : comp,
            keywordApproved: false,
            paaApproved: false,
            paaQuestions: null,
            approvedPaaQuestion: null,
            cannibalizationWarning: false,
          })
          .where(eq(keywords.id, input.keywordId));

        return { swapped: true, keyword: input.newKeyword };
      }

      // Fetch suggestions
      let suggestions: Array<{ keyword: string; msv: number | null; competition: string | null }> = [];
      try {
        const results = await getKeywordSuggestions(kw.primaryKeyword, 2036, "en", 10);
        suggestions = results.slice(0, 5).map((r) => ({
          keyword: r.keyword,
          msv: r.monthlySearchVolume,
          competition: r.competitionLevel,
        }));
      } catch {
        // Fallback: return empty suggestions — UI will show a manual input
      }

      return { swapped: false, suggestions };
    }),

  // -------------------------------------------------------------------------
  // keywords.approveOne
  // Approve a single keyword row.
  // -------------------------------------------------------------------------
  approveOne: protectedProcedure
    .input(z.object({ businessId: z.number(), keywordId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      await db
        .update(keywords)
        .set({ keywordApproved: true })
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.businessId, input.businessId)));

      return { approved: true };
    }),

  // -------------------------------------------------------------------------
  // keywords.approveAll
  // Approve all keywords for the business.
  // BLOCKS if any exact duplicates or semantic overlaps exist.
  // -------------------------------------------------------------------------
  approveAll: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const allKw = await db
        .select({ id: keywords.id, articleNodeId: keywords.articleNodeId, primaryKeyword: keywords.primaryKeyword })
        .from(keywords)
        .where(eq(keywords.businessId, input.businessId));

      if (!allKw.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No keywords found. Run keyword assignment first." });
      }

      // Run cannibalization check
      const entries: KeywordEntry[] = allKw.map((k) => ({
        nodeId: k.articleNodeId,
        keyword: k.primaryKeyword,
      }));

      const cannibal = checkCannibalization(entries);

      if (cannibal.hasConflicts) {
        // Mark conflicting rows
        const conflictNodeIds = new Set<number>();
        for (const c of cannibal.conflicts) {
          conflictNodeIds.add(c.nodeIdA);
          conflictNodeIds.add(c.nodeIdB);
        }
        for (const kw of allKw) {
          if (conflictNodeIds.has(kw.articleNodeId)) {
            await db
              .update(keywords)
              .set({ cannibalizationWarning: true })
              .where(eq(keywords.id, kw.id));
          }
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot approve: ${cannibal.conflicts.length} cannibalization conflict(s) found. Swap the conflicting keywords before approving.`,
        });
      }

      // All clear — approve all
      await db
        .update(keywords)
        .set({ keywordApproved: true, cannibalizationWarning: false })
        .where(eq(keywords.businessId, input.businessId));

      return { approved: allKw.length };
    }),

  // -------------------------------------------------------------------------
  // keywords.fetchPAA
  // Fetch People Also Ask questions for all approved keywords.
  // Only callable after all keywords are approved.
  // -------------------------------------------------------------------------
  fetchPAA: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const approvedKw = await db
        .select({ id: keywords.id, primaryKeyword: keywords.primaryKeyword })
        .from(keywords)
        .where(and(eq(keywords.businessId, input.businessId), eq(keywords.keywordApproved, true)));

      if (!approvedKw.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Approve all keywords before fetching PAA." });
      }

      const kwList = approvedKw.map((k) => k.primaryKeyword);
      let paaResults: Array<{ keyword: string; questions: string[] }> = [];

      try {
        paaResults = await getPAAQuestions(kwList);
      } catch (err) {
        console.warn("[Keywords] PAA fetch failed, using empty questions:", err);
        paaResults = kwList.map((kw) => ({ keyword: kw, questions: [] }));
      }

      const paaMap = new Map(paaResults.map((r) => [r.keyword, r.questions]));

      for (const kw of approvedKw) {
        const questions = paaMap.get(kw.primaryKeyword) ?? [];
        await db
          .update(keywords)
          .set({ paaQuestions: questions })
          .where(eq(keywords.id, kw.id));
      }

      return { fetched: approvedKw.length };
    }),

  // -------------------------------------------------------------------------
  // keywords.approvePAA
  // Approve the PAA question for a single article node.
  // When all PAA sets are approved, advances the business stage to 4.
  // -------------------------------------------------------------------------
  approvePAA: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        keywordId: z.number(),
        approvedQuestion: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      await db
        .update(keywords)
        .set({ approvedPaaQuestion: input.approvedQuestion, paaApproved: true })
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.businessId, input.businessId)));

      // Check if ALL keywords now have PAA approved
      const allKw = await db
        .select({ paaApproved: keywords.paaApproved })
        .from(keywords)
        .where(eq(keywords.businessId, input.businessId));

      const allApproved = allKw.every((k) => k.paaApproved);

      if (allApproved) {
        // Advance business stage to 4 (Article Generation)
        await db
          .update(businesses)
          .set({ currentStage: 4 })
          .where(eq(businesses.id, input.businessId));
      }

      return { approved: true, stageAdvanced: allApproved };
    }),

  // -------------------------------------------------------------------------
  // keywords.getSuggestions
  // Get keyword swap suggestions for a specific keyword (used by swap modal).
  // -------------------------------------------------------------------------
  getSuggestions: protectedProcedure
    .input(z.object({ businessId: z.number(), keyword: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      try {
        const results = await getKeywordSuggestions(input.keyword, 2036, "en", 10);
        return results.slice(0, 5).map((r) => ({
          keyword: r.keyword,
          msv: r.monthlySearchVolume,
          competition: r.competitionLevel,
        }));
      } catch {
        return [];
      }
    }),
});
