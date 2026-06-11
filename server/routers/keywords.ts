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
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  articleNodes,
  businesses,
  businessServices,
  brandVoice,
  keywords,
  keywordSeeds,
  selectedKeywords,
} from "../../drizzle/schema";
import { invokeLLMWithCost } from "../apiCostLogger";
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

// Human-readable labels for article types
const ARTICLE_TYPE_LABEL: Record<string, string> = {
  cornerstone_guide: "Ultimate Guide",
  top_10_list: "Top 10 List",
  how_to: "How-To Guide",
  the_why: "The Why",
  comparison: "Comparison",
  myth_busting: "Myth-Busting",
  specialist_post: "Specialist Post",
};

// ---------------------------------------------------------------------------
// Claude fallback: generate keyword suggestions when DataForSEO is unavailable
// ---------------------------------------------------------------------------

async function generateKeywordsViaClaude(
  nodes: Array<{ id: number; level: string; articleType: string; sortOrder: number }>,
  businessName: string,
  industry: string,
  location: string,
  voiceBrief: string,
  exclusions: string[],
  services: string[],
  description: string,
  userId?: number | null,
  keywordPool?: Array<{ keyword: string; msv: number | null; competition: string | null }>
): Promise<Map<number, string>> {
  // Group nodes by level so Claude understands the hierarchy
  const cornerstones = nodes.filter((n) => n.level === "cornerstone");
  const pillars = nodes.filter((n) => n.level === "pillar");
  const clusters = nodes.filter((n) => n.level === "cluster");

  const nodeDescriptions = nodes.map(
    (n) =>
      `Node ${n.id}: [${n.level.toUpperCase()}] ${ARTICLE_TYPE_LABEL[n.articleType] ?? n.articleType} (order ${n.sortOrder})`
  );

  const servicesText = services.length > 0 ? services.join(", ") : "(not specified)";
  const descText = description ? description.slice(0, 500) : "(not specified)";
  const locationText = location || "Australia";

  // If we have a real keyword pool from DataForSEO, instruct Claude to SELECT from it.
  // Otherwise Claude generates keywords from scratch.
  const poolSection = keywordPool && keywordPool.length > 0
    ? `\nKEYWORD POOL (real data from Google Ads — SELECT from this list, do not invent new ones):\n${keywordPool
        .slice(0, 80) // cap at 80 to keep prompt manageable
        .map((k) => `- "${k.keyword}" (MSV: ${k.msv ?? "unknown"}, competition: ${k.competition ?? "unknown"})`)
        .join("\n")}\n\nIMPORTANT: You MUST assign keywords exclusively from the pool above. Do not invent keywords not in the list.`
    : `\nIMPORTANT: No DataForSEO pool is available. Generate real, specific keywords that people actually search for when looking for ${businessName}'s services (${servicesText}). Do NOT use article type names, placeholder text, or the business name as the keyword. Each keyword must be a genuine search phrase.`;

  const prompt = `You are an expert SEO keyword strategist. Your job is to assign one specific, real-world primary keyword to each article slot for the following business.

BUSINESS PROFILE:
- Name: ${businessName}
- Industry: ${industry}
- Location: ${locationText}
- Services/Products offered: ${servicesText}
- Business description: ${descText}
- Brand voice excerpt: ${voiceBrief.slice(0, 300)}
- Excluded topics: ${exclusions.join(", ") || "none"}

ARTICLE ARCHITECTURE OVERVIEW:
- ${cornerstones.length} Cornerstone article(s) — broad, authoritative hub pages covering the main service/topic areas
- ${pillars.length} Pillar article(s) — supporting articles that go deeper into specific aspects
- ${clusters.length} Cluster article(s) — highly specific long-tail articles targeting narrow questions

ARTICLE SLOTS TO ASSIGN KEYWORDS TO:
${nodeDescriptions.join("\n")}

KEYWORD ASSIGNMENT RULES:
1. CORNERSTONES: Assign broad, high-intent head-term keywords (1-3 words) that directly represent the main service areas of ${businessName}. These should be the most searched terms in the industry.
2. PILLARS: Assign mid-tail keywords (2-4 words) that support a cornerstone topic. Each pillar keyword should clearly relate to one of the cornerstone topics.
3. CLUSTERS: Assign specific long-tail keywords (3-6 words) targeting a narrow question, comparison, or subtopic. These should be highly specific and have clear search intent.
4. UNIQUENESS: Every single keyword must be completely unique — absolutely zero duplication or semantic overlap between any two slots.
5. REAL KEYWORDS: All keywords must be real search terms that people actually type into Google. No made-up phrases.
6. SERVICE RELEVANCE: Keywords must be directly relevant to the actual services/products of ${businessName}: ${servicesText}
7. LOCAL SEO: Where appropriate for local service businesses, include "${locationText}" as a location modifier.
8. INTENT MATCHING: Match keyword intent to article type (e.g., "how to" keywords for How-To articles, "best X" for Top 10 lists, "X vs Y" for Comparisons).
${poolSection}

Return a JSON object mapping node ID (as a string key) to the keyword string.
IMPORTANT: Use the EXACT node IDs shown above (e.g. "${nodes[0]?.id ?? 1}", "${nodes[1]?.id ?? 2}", etc.) as the JSON keys — NOT sequential numbers like "1", "2", "3".
Example using your actual node IDs: {"${nodes[0]?.id ?? 1}": "pitch deck consultant", "${nodes[1]?.id ?? 2}": "investor pitch deck design", "${nodes[2]?.id ?? 3}": "how to write a pitch deck for investors"}`;

      const response = await invokeLLMWithCost(
    {
      messages: [
        { role: "system", content: "You are an expert SEO keyword strategist. Return only valid JSON with real, specific keywords. Never use placeholder text." },
        { role: "user", content: prompt },
      ],

    },
    { userId, feature: "keyword_research" }
  );

  let content = response?.choices?.[0]?.message?.content ?? "{}";
  if (typeof content !== "string") content = JSON.stringify(content);
  // Strip markdown code fences if Claude wraps the JSON
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) content = fenceMatch[1].trim();
  // Extract first {...} block in case there's surrounding text
  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) content = braceMatch[0];
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(content) as Record<string, string>;
  } catch (e) {
    console.warn("[Keywords] Claude returned unparseable JSON:", content.slice(0, 200));
  }
  console.log(`[Keywords] Claude returned ${Object.keys(parsed).length} keyword assignments`);
  const map = new Map<number, string>();
  for (const [k, v] of Object.entries(parsed)) {
    const nodeId = parseInt(k, 10);
    if (!isNaN(nodeId) && typeof v === "string" && v.trim()) {
      map.set(nodeId, v.trim());
    }
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

      const exclusions = biz.keywordExclusions
        ? biz.keywordExclusions.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      // Fetch all services for this business (used to give Claude real context)
      const serviceRows = await db
        .select({ name: businessServices.name })
        .from(businessServices)
        .where(eq(businessServices.businessId, input.businessId))
        .orderBy(businessServices.sortOrder);

      const services = serviceRows.map((s) => s.name);

      // Build description from available fields
      const description = [biz.uniqueValueProposition, biz.serviceArea]
        .filter(Boolean)
        .join(" | ");

      // ── Step A: Build keyword pool ─────────────────────────────────────────
      // Priority 1: Use the user's saved selected keywords from Step 8 (with real MSV data).
      // Priority 2: Fall back to re-querying DataForSEO from seed phrases.
      // Priority 3: Claude-only generation if no seeds or DataForSEO unavailable.

      const savedSelectedRows = await db
        .select()
        .from(selectedKeywords)
        .where(eq(selectedKeywords.businessId, input.businessId))
        .orderBy(selectedKeywords.sortOrder);

      let keywordPool: Array<{ keyword: string; msv: number | null; competition: string | null }> = [];
      let dfsData: Map<string, { msv: number | null; comp: "high" | "medium" | "low" | null }> = new Map();

      if (savedSelectedRows.length > 0) {
        // ── Priority 1: Use the user's saved selections (no DataForSEO re-query needed) ──
        console.log(`[Keywords] Using ${savedSelectedRows.length} saved selected keywords from Step 8 (no DataForSEO re-query)`);
        for (const row of savedSelectedRows) {
          const comp = row.competitionLevel as "high" | "medium" | "low" | null;
          keywordPool.push({ keyword: row.keyword, msv: row.msv ?? null, competition: comp });
          dfsData.set(row.keyword, { msv: row.msv ?? null, comp });
        }
        // Sort by MSV descending so Claude picks high-value keywords first
        keywordPool.sort((a, b) => (b.msv ?? 0) - (a.msv ?? 0));
      } else {
        // ── Priority 2: Fall back to re-querying DataForSEO from saved seed phrases ──
        const seedRows = await db
          .select({ keyword: keywordSeeds.keyword })
          .from(keywordSeeds)
          .where(eq(keywordSeeds.businessId, input.businessId))
          .orderBy(keywordSeeds.sortOrder);

        if (seedRows.length > 0 && process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
          // Send ALL seeds in a single combined request — much better results than per-seed calls
          const seedTerms = seedRows.map((s) => s.keyword);
          try {
            const suggestions = await getKeywordSuggestions(seedTerms, 2036, "en", 100);
            // Add seeds themselves (MSV will be enriched in Step C if not in suggestions)
            for (const seed of seedTerms) {
              keywordPool.push({ keyword: seed, msv: null, competition: null });
            }
            // Add all suggestions with real MSV data
            for (const s of suggestions) {
              if (s.monthlySearchVolume !== null) {
                keywordPool.push({ keyword: s.keyword, msv: s.monthlySearchVolume, competition: s.competitionLevel });
                dfsData.set(s.keyword, { msv: s.monthlySearchVolume, comp: s.competitionLevel });
              }
            }
          } catch (err) {
            console.warn(`[Keywords] Combined pool build failed:`, err);
            for (const seed of seedTerms) {
              keywordPool.push({ keyword: seed, msv: null, competition: null });
            }
          }
          // Deduplicate
          const seen = new Set<string>();
          keywordPool = keywordPool.filter((r) => {
            const k = r.keyword.toLowerCase().trim();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          // Sort by MSV descending so Claude picks high-value keywords first
          keywordPool.sort((a, b) => (b.msv ?? 0) - (a.msv ?? 0));
          console.log(`[Keywords] Built pool of ${keywordPool.length} keywords from ${seedTerms.length} seeds via DataForSEO (fallback — no saved selections found)`);
        }
      }

      // ── Step B: Claude assigns one keyword per article slot ───────────────────
      // If pool exists, Claude selects from it. Otherwise Claude generates.
      const kwMap = await generateKeywordsViaClaude(
        nodes.map((n) => ({ id: n.id, level: n.level, articleType: n.articleType, sortOrder: n.sortOrder })),
        biz.name,
        biz.industry ?? "",
        biz.location ?? biz.serviceArea ?? "",
        voice?.finalVoiceBrief ?? "",
        exclusions,
        services,
        description,
        ctx.user.id,
        keywordPool.length > 0 ? keywordPool : undefined
      );

      // ── Step C: Enrich any Claude-generated keywords not already in dfsData ──
      const newKwList = Array.from(kwMap.values()).filter((kw) => !dfsData.has(kw));
      if (newKwList.length > 0 && process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) {
        try {
          const dfsResults = await getKeywordData(newKwList);
          for (const r of dfsResults) {
            dfsData.set(r.keyword, { msv: r.monthlySearchVolume, comp: r.competitionLevel });
          }
        } catch (err) {
          console.warn("[Keywords] DataForSEO enrichment failed, proceeding without MSV data:", err);
        }
      }

      // Insert keyword rows
      // Fallback: if Claude missed a node, generate a reasonable placeholder based on business name + service
      const fallbackService = services[0] ?? biz.industry ?? "services";
      const insertRows = nodes.map((node) => {
        const kw =
          kwMap.get(node.id) ??
          `${biz.name} ${fallbackService} ${node.level}`.toLowerCase().replace(/\s+/g, " ").trim();
        const enriched = dfsData.get(kw);
        return {
          articleNodeId: node.id,
          businessId: input.businessId,
          primaryKeyword: kw,
          monthlySearchVolume: enriched?.msv ?? null,
          competitionLevel: enriched?.comp ?? null,
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
            competitionLevel: comp ?? null,
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
  // keywords.retryPAA
  // Fetch (or re-fetch) PAA questions for a single keyword row.
  // -------------------------------------------------------------------------
  retryPAA: protectedProcedure
    .input(z.object({ businessId: z.number(), keywordId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const kwRows = await db
        .select({ id: keywords.id, primaryKeyword: keywords.primaryKeyword })
        .from(keywords)
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.businessId, input.businessId)))
        .limit(1);

      if (!kwRows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });

      const kw = kwRows[0];
      let questions: string[] = [];
      try {
        const results = await getPAAQuestions([kw.primaryKeyword]);
        questions = results.find(r => r.keyword === kw.primaryKeyword)?.questions ?? [];
      } catch (err) {
        console.warn("[Keywords] retryPAA failed for", kw.primaryKeyword, err);
      }

      await db
        .update(keywords)
        .set({ paaQuestions: questions })
        .where(eq(keywords.id, kw.id));

      return { keywordId: kw.id, questionsFound: questions.length };
    }),

  getSuggestions: protectedProcedure
    .input(z.object({ businessId: z.number(), keyword: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) return [];

      // Load all existing keywords for this business so we can filter out conflicts.
      // We exclude the keyword being swapped (input.keyword) from the conflict set
      // so the row being replaced doesn't block its own suggestions.
      const existingKws = await db
        .select({ primaryKeyword: keywords.primaryKeyword })
        .from(keywords)
        .where(eq(keywords.businessId, input.businessId));

      // Build a normalised set of existing keywords (minus the one being swapped)
      const normalise = (kw: string) =>
        kw.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      const STOP = new Set([
        "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
        "from","is","are","was","were","be","been","being","have","has","had","do",
        "does","did","will","would","could","should","may","might","shall","can",
        "how","what","when","where","why","who","which","that","this","these","those",
      ]);
      const tokenSet = (kw: string) =>
        normalise(kw).split(" ").filter(t => t.length > 1 && !STOP.has(t)).sort().join("|");

      const normCurrentKw = normalise(input.keyword);
      const existingNorms = new Set<string>();
      const existingTokenSets = new Set<string>();
      for (const row of existingKws) {
        const norm = normalise(row.primaryKeyword);
        const tset = tokenSet(row.primaryKeyword);
        // Exclude the row being swapped from the conflict set
        if (norm === normCurrentKw) continue;
        existingNorms.add(norm);
        if (tset.length > 0) existingTokenSets.add(tset);
      }

      /** Returns true if a candidate keyword would conflict with any existing keyword. */
      function wouldConflict(candidate: string): boolean {
        const norm = normalise(candidate);
        if (existingNorms.has(norm)) return true; // exact duplicate
        const tset = tokenSet(candidate);
        if (tset.length > 0 && existingTokenSets.has(tset)) return true; // semantic overlap
        return false;
      }

      // Load saved seed keywords for this business
      const seeds = await db
        .select({ keyword: keywordSeeds.keyword })
        .from(keywordSeeds)
        .where(eq(keywordSeeds.businessId, input.businessId))
        .orderBy(asc(keywordSeeds.sortOrder));

      // If seeds exist, use them to build a real pool from DataForSEO
      if (seeds.length > 0) {
        const allResults: Array<{ keyword: string; msv: number | null; competition: string | null }> = [];
        for (const seed of seeds.slice(0, 5)) {
          try {
            const results = await getKeywordSuggestions(seed.keyword, 2036, "en", 10);
            for (const r of results) {
              allResults.push({ keyword: r.keyword, msv: r.monthlySearchVolume, competition: r.competitionLevel });
            }
          } catch {
            // skip failed seeds
          }
        }
        // Deduplicate, filter out conflicts, and sort by MSV descending
        const seen = new Set<string>();
        const deduped = allResults
          .filter(r => {
            if (seen.has(r.keyword)) return false;
            seen.add(r.keyword);
            if (wouldConflict(r.keyword)) return false; // skip cannibalizing suggestions
            return true;
          })
          .sort((a, b) => (b.msv ?? 0) - (a.msv ?? 0))
          .slice(0, 20);
        if (deduped.length > 0) return deduped;
      }

      // Fallback: use the current keyword as the seed (original behaviour)
      try {
        const results = await getKeywordSuggestions(input.keyword, 2036, "en", 10);
        return results
          .filter(r => !wouldConflict(r.keyword))
          .slice(0, 10)
          .map((r) => ({
            keyword: r.keyword,
            msv: r.monthlySearchVolume,
            competition: r.competitionLevel,
          }));
      } catch {
        return [];
      }
    }),

  // ---------------------------------------------------------------------------
  // keywords.getSavedSelections
  // Returns the user's Step 8 saved selected keywords for a business,
  // annotated with which article node (if any) each keyword is currently
  // assigned to. Used in the Keywords page sidebar and Swap modal.
  // ---------------------------------------------------------------------------
  getSavedSelections: protectedProcedure
    .input(z.object({ businessId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertBusinessOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) return [];

      // Load saved selections from Step 8
      const saved = await db
        .select()
        .from(selectedKeywords)
        .where(eq(selectedKeywords.businessId, input.businessId))
        .orderBy(asc(selectedKeywords.sortOrder));

      if (saved.length === 0) return [];

      // Load all currently assigned keywords for this business
      const assigned = await db
        .select({
          primaryKeyword: keywords.primaryKeyword,
          articleNodeId: keywords.articleNodeId,
        })
        .from(keywords)
        .where(eq(keywords.businessId, input.businessId));

      // Load article node labels so we can show which article each keyword is assigned to
      const nodes = await db
        .select({ id: articleNodes.id, level: articleNodes.level, sortOrder: articleNodes.sortOrder })
        .from(articleNodes)
        .where(eq(articleNodes.businessId, input.businessId))
        .orderBy(asc(articleNodes.sortOrder));

      // Build a map: normalised keyword → assigned node id
      const normalise = (kw: string) =>
        kw.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

      const assignedMap = new Map<string, number>(); // normKeyword → nodeId
      for (const row of assigned) {
        assignedMap.set(normalise(row.primaryKeyword), row.articleNodeId);
      }

      // Build a map: nodeId → human label (e.g. "Cornerstone 1", "Pillar 1.2")
      const cornerstoneCount: Record<string, number> = {};
      const pillarCount: Record<string, number> = {};
      const clusterCount: Record<string, number> = {};
      const nodeLabel = new Map<number, string>();
      for (const node of nodes) {
        if (node.level === "cornerstone") {
          cornerstoneCount[node.level] = (cornerstoneCount[node.level] ?? 0) + 1;
          nodeLabel.set(node.id, `Cornerstone ${cornerstoneCount[node.level]}`);
        } else if (node.level === "pillar") {
          pillarCount[node.level] = (pillarCount[node.level] ?? 0) + 1;
          nodeLabel.set(node.id, `Pillar ${pillarCount[node.level]}`);
        } else {
          clusterCount[node.level] = (clusterCount[node.level] ?? 0) + 1;
          nodeLabel.set(node.id, `Cluster ${clusterCount[node.level]}`);
        }
      }

      return saved.map((s) => {
        const norm = normalise(s.keyword);
        const assignedNodeId = assignedMap.get(norm) ?? null;
        const assignedLabel = assignedNodeId ? (nodeLabel.get(assignedNodeId) ?? null) : null;
        return {
          id: s.id,
          keyword: s.keyword,
          msv: s.msv ?? null,
          competitionLevel: s.competitionLevel ?? null,
          cpc: s.cpc != null ? parseFloat(String(s.cpc)) : null,
          seedKeyword: s.seedKeyword ?? null,
          assignedNodeId,
          assignedLabel,
          isAssigned: assignedNodeId !== null,
        };
      });
    }),
});
