/**
 * Keyword Seeds Router — Stage 1 Business Profile (Step 9)
 *
 * Procedures:
 *   keywordSeeds.suggest              — AI suggests up to 10 seed keywords from business profile
 *   keywordSeeds.getAll               — return all seeds for a business
 *   keywordSeeds.save                 — replace full seed list (max 10)
 *   keywordSeeds.searchDataForSEO     — for each seed, call DataForSEO keywords_for_keywords
 *                                       and return a ranked pool of real keywords with MSV + competition
 *   keywordSeeds.saveSelectedKeywords — persist the user's ticked keyword selections (with MSV/competition/CPC)
 *   keywordSeeds.getSelectedKeywords  — return the saved selected keywords for a business
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { keywordSeeds, businesses, businessServices, selectedKeywords } from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";
import { invokeLLMWithCost } from "../apiCostLogger";
import { getKeywordSuggestions } from "../dataforseo";

// ---------------------------------------------------------------------------
// Helper: assert user owns the business
// ---------------------------------------------------------------------------
async function assertOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!rows.length) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found" });
}

export const keywordSeedsRouter = router({
  // -------------------------------------------------------------------------
  // keywordSeeds.getAll
  // Return all keyword seeds for a business, ordered by sortOrder.
  // -------------------------------------------------------------------------
  getAll: protectedProcedure
    .input(z.object({ businessId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db
        .select()
        .from(keywordSeeds)
        .where(eq(keywordSeeds.businessId, input.businessId))
        .orderBy(asc(keywordSeeds.sortOrder));
    }),

  // -------------------------------------------------------------------------
  // keywordSeeds.save
  // Replace the full seed list for a business (max 10 seeds).
  // -------------------------------------------------------------------------
  save: protectedProcedure
    .input(z.object({
      businessId: z.number().int().positive(),
      seeds: z.array(z.string().min(1).max(255)).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.delete(keywordSeeds).where(eq(keywordSeeds.businessId, input.businessId));
      if (input.seeds.length > 0) {
        await db.insert(keywordSeeds).values(
          input.seeds.map((kw, idx) => ({
            businessId: input.businessId,
            keyword: kw.trim(),
            sortOrder: idx,
          }))
        );
      }
      return { saved: input.seeds.length };
    }),

  // -------------------------------------------------------------------------
  // keywordSeeds.suggest
  // Claude suggests up to 10 seed keyword phrases from the business profile.
  // Returns string array — user edits/approves before saving.
  // -------------------------------------------------------------------------
  suggest: protectedProcedure
    .input(z.object({ businessId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const bizRows = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);
      const biz = bizRows[0];
      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      const serviceRows = await db
        .select({ name: businessServices.name })
        .from(businessServices)
        .where(eq(businessServices.businessId, input.businessId))
        .orderBy(asc(businessServices.sortOrder));
      const services = serviceRows.map((s) => s.name);

      const prompt = `You are an expert SEO keyword strategist. Suggest up to 10 seed keyword phrases for a business that will be used to research real keyword data via Google Ads API.

BUSINESS PROFILE:
- Business name: ${biz.name}
- Industry: ${biz.industry ?? "not specified"}
- Location: ${biz.location ?? "Australia"}
- Services/Products: ${services.length > 0 ? services.join(", ") : "not specified"}
- Unique value proposition: ${biz.uniqueValueProposition ?? "not specified"}
- Service area: ${biz.serviceArea ?? "not specified"}

INSTRUCTIONS:
1. Generate 8–10 SHORT seed keyword phrases (1–3 words each) that represent the CORE topics this business should rank for.
2. CRITICAL: Keep seeds SHORT and BROAD — 1 to 3 words maximum. Google Ads needs broad terms to find related keywords. Long phrases (4+ words) return no data.
   GOOD examples: "workplace wellbeing", "mental health", "employee assistance", "psychosocial hazards"
   BAD examples: "workplace mental health compliance documentation", "psychosocial hazard risk assessment"
3. Each seed must be a real phrase people type into Google — not a sentence or question.
4. Include a mix of: main service terms, location-modified terms (if local business), and problem/solution terms.
5. Do NOT include brand names, competitor names, or overly generic single words like "health" alone.
6. Seeds will be expanded into a full keyword list via Google Ads data — choose seeds that generate diverse, relevant variations.

Return JSON with key "seeds" containing an array of up to 10 keyword strings.`;

      const response = await invokeLLMWithCost(
        {
          messages: [
            { role: "system", content: "You are an expert SEO keyword strategist. Return only valid JSON." },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "seed_suggestions",
              strict: true,
              schema: {
                type: "object",
                properties: { seeds: { type: "array", items: { type: "string" } } },
                required: ["seeds"],
                additionalProperties: false,
              },
            },
          },
        },
        { userId: ctx.user.id, feature: "keyword_research" }
      );

      const content = response?.choices?.[0]?.message?.content ?? '{"seeds":[]}';
      const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as { seeds: string[] };
      const seeds = (parsed.seeds ?? []).slice(0, 10).map((s: string) => s.trim()).filter(Boolean);
      return { seeds };
    }),

  // -------------------------------------------------------------------------
  // keywordSeeds.saveSelectedKeywords
  // Persist the keywords the user ticked in the Step 8 results table.
  // Replaces any previously saved selections for this business.
  // -------------------------------------------------------------------------
  saveSelectedKeywords: protectedProcedure
    .input(z.object({
      businessId: z.number().int().positive(),
      keywords: z.array(z.object({
        keyword: z.string().min(1).max(255),
        msv: z.number().int().nullable().optional(),
        competition: z.string().nullable().optional(),
        cpc: z.number().nullable().optional(),
        seedKeyword: z.string().nullable().optional(),
      })).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Delete existing selections for this business
      await db.delete(selectedKeywords).where(eq(selectedKeywords.businessId, input.businessId));
      if (input.keywords.length > 0) {
        await db.insert(selectedKeywords).values(
          input.keywords.map((kw, idx) => ({
            businessId: input.businessId,
            keyword: kw.keyword.trim(),
            msv: kw.msv ?? null,
            competitionLevel: kw.competition ?? null,
            cpc: kw.cpc != null ? String(kw.cpc.toFixed(2)) : null,
            seedKeyword: kw.seedKeyword ?? null,
            sortOrder: idx,
          }))
        );
      }
      return { saved: input.keywords.length };
    }),

  // -------------------------------------------------------------------------
  // keywordSeeds.getSelectedKeywords
  // Return all saved selected keywords for a business, ordered by sortOrder.
  // Used to pre-populate the Step 8 selection state when the user returns.
  // -------------------------------------------------------------------------
  getSelectedKeywords: protectedProcedure
    .input(z.object({ businessId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db
        .select()
        .from(selectedKeywords)
        .where(eq(selectedKeywords.businessId, input.businessId))
        .orderBy(asc(selectedKeywords.sortOrder));
    }),

  // -------------------------------------------------------------------------
  // keywordSeeds.searchDataForSEO
  // For each saved seed, call DataForSEO keywords_for_keywords/live and return
  // a ranked pool of real keywords with MSV + competition.
  // The pool is returned to the frontend for user review — not saved to DB.
  // -------------------------------------------------------------------------
  searchDataForSEO: protectedProcedure
    .input(z.object({
      businessId: z.number().int().positive(),
      locationCode: z.number().int().optional().default(2036), // 2036 = Australia
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const seeds = await db
        .select({ keyword: keywordSeeds.keyword })
        .from(keywordSeeds)
        .where(eq(keywordSeeds.businessId, input.businessId))
        .orderBy(asc(keywordSeeds.sortOrder));

      if (seeds.length === 0) {
        return { results: [], message: "No seeds found. Add seed keywords first." };
      }

      // If no DataForSEO credentials, return seeds only with null MSV
      if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
        const mockResults = seeds.map((s, idx) => ({
          seed: s.keyword,
          keyword: s.keyword,
          msv: null as number | null,
          competition: null as string | null,
          cpc: null as number | null,
        }));
        return { results: mockResults, message: "DataForSEO credentials not configured — showing seed keywords only." };
      }

      // ── Combined request: send ALL seeds together for best results ─────────
      // The keywords_for_keywords endpoint returns far more results when given
      // multiple seeds at once vs. one seed per request.
      type SeedGroup = {
        seed: string;
        keywords: Array<{
          keyword: string;
          msv: number | null;
          competition: string | null;
          cpc: number | null;
        }>;
      };

      // Cap at 200 results total to keep response manageable
      const LIMIT = 200;
      let allSuggestions: Array<{ keyword: string; msv: number | null; competition: string | null; cpc: number | null }> = [];

      try {
        const seedTerms = seeds.map((s) => s.keyword);
        const suggestions = await getKeywordSuggestions(
          seedTerms, // pass all seeds as an array for a combined request
          input.locationCode,
          "en",
          LIMIT
        );
        // Filter: only keep keywords that have real MSV data
        allSuggestions = suggestions
          .filter((s) => s.monthlySearchVolume != null && s.monthlySearchVolume > 0)
          .sort((a, b) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0))
          .map((s) => ({
            keyword: s.keyword,
            msv: s.monthlySearchVolume,
            competition: s.competitionLevel,
            cpc: s.cpc,
          }));
      } catch (err) {
        console.warn("[KeywordSeeds] Combined DataForSEO request failed:", err);
      }

      // If combined request returned nothing, try seeds individually
      if (allSuggestions.length === 0) {
        for (const seed of seeds) {
          try {
            const suggestions = await getKeywordSuggestions(seed.keyword, input.locationCode, "en", 30);
            const withData = suggestions
              .filter((s) => s.monthlySearchVolume != null && s.monthlySearchVolume > 0)
              .map((s) => ({
                keyword: s.keyword,
                msv: s.monthlySearchVolume,
                competition: s.competitionLevel,
                cpc: s.cpc,
              }));
            allSuggestions.push(...withData);
          } catch (err) {
            console.warn(`[KeywordSeeds] DataForSEO failed for seed "${seed.keyword}":`, err);
          }
        }
        // Deduplicate and sort
        const seen = new Set<string>();
        allSuggestions = allSuggestions
          .filter((s) => { const k = s.keyword.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((a, b) => (b.msv ?? 0) - (a.msv ?? 0));
      }

      // ── Group results by seed (assign each keyword to its closest seed) ────
      // Simple heuristic: a keyword belongs to the seed whose words appear most in it
      const groups: SeedGroup[] = seeds.map((s) => ({ seed: s.keyword, keywords: [] }));
      const PER_SEED = Math.max(10, Math.ceil(allSuggestions.length / Math.max(seeds.length, 1)));

      // Score each keyword against each seed and assign to best-matching seed
      for (const kw of allSuggestions) {
        let bestSeedIdx = 0;
        let bestScore = -1;
        seeds.forEach((seed, idx) => {
          const seedWords = seed.keyword.toLowerCase().split(/\s+/);
          const kwLower = kw.keyword.toLowerCase();
          const score = seedWords.filter((w) => w.length > 2 && kwLower.includes(w)).length;
          if (score > bestScore) { bestScore = score; bestSeedIdx = idx; }
        });
        const group = groups[bestSeedIdx];
        if (group && group.keywords.length < PER_SEED) {
          group.keywords.push(kw);
        }
      }

      // Fill any empty groups with top unassigned keywords
      const assignedKws = new Set(groups.flatMap((g) => g.keywords.map((k) => k.keyword)));
      const unassigned = allSuggestions.filter((k) => !assignedKws.has(k.keyword));
      for (const group of groups) {
        if (group.keywords.length === 0 && unassigned.length > 0) {
          group.keywords.push(...unassigned.splice(0, 10));
        }
      }

      const totalFound = groups.reduce((sum, g) => sum + g.keywords.length, 0);

      return {
        groups,
        totalFound,
        message: totalFound > 0
          ? `Found ${totalFound} keywords across ${seeds.length} seed${seeds.length !== 1 ? "s" : ""} — select the ones most relevant to your business.`
          : `No keyword data found. Try shorter, broader seed terms (e.g. "mental health" instead of "workplace mental health compliance").`,
      };
    }),
});
