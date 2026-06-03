/**
 * Keyword Seeds Router — Stage 1 Business Profile (Step 9)
 *
 * Procedures:
 *   keywordSeeds.suggest         — AI suggests up to 10 seed keywords from business profile
 *   keywordSeeds.getAll          — return all seeds for a business
 *   keywordSeeds.save            — replace full seed list (max 10)
 *   keywordSeeds.searchDataForSEO — for each seed, call DataForSEO keywords_for_keywords
 *                                   and return a ranked pool of real keywords with MSV + competition
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { keywordSeeds, businesses, businessServices } from "../../drizzle/schema";
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
1. Generate 8–10 short seed keyword phrases (2–4 words each) that represent the CORE topics this business should rank for.
2. Each seed must be a real phrase people type into Google — not a sentence or question.
3. Include a mix of: main service terms, location-modified terms (if local), and problem/solution terms.
4. Do NOT include brand names, competitor names, or overly generic single words.
5. Seeds will be expanded into a full keyword list via Google Ads data — choose seeds that generate diverse, relevant variations.

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

      // Call DataForSEO for each seed
      const allResults: Array<{
        seed: string;
        keyword: string;
        msv: number | null;
        competition: string | null;
        cpc: number | null;
      }> = [];

      for (const seed of seeds) {
        try {
          const suggestions = await getKeywordSuggestions(seed.keyword, input.locationCode, "en", 15);
          // Include the seed itself first
          const seedData = suggestions.find((s) => s.keyword.toLowerCase() === seed.keyword.toLowerCase());
          allResults.push({
            seed: seed.keyword,
            keyword: seed.keyword,
            msv: seedData?.monthlySearchVolume ?? null,
            competition: seedData?.competitionLevel ?? null,
            cpc: seedData?.cpc ?? null,
          });
          // Add all suggestions (excluding the seed itself)
          for (const s of suggestions) {
            if (s.keyword.toLowerCase() !== seed.keyword.toLowerCase()) {
              allResults.push({
                seed: seed.keyword,
                keyword: s.keyword,
                msv: s.monthlySearchVolume,
                competition: s.competitionLevel,
                cpc: s.cpc,
              });
            }
          }
        } catch (err) {
          console.warn(`[KeywordSeeds] DataForSEO failed for seed "${seed.keyword}":`, err);
          allResults.push({ seed: seed.keyword, keyword: seed.keyword, msv: null, competition: null, cpc: null });
        }
      }

      // Deduplicate by keyword (keep first occurrence)
      const seen = new Set<string>();
      const deduped = allResults.filter((r) => {
        const key = r.keyword.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort: seed keywords first, then by MSV descending
      deduped.sort((a, b) => {
        const aIsSeed = a.keyword === a.seed;
        const bIsSeed = b.keyword === b.seed;
        if (aIsSeed && !bIsSeed) return -1;
        if (!aIsSeed && bIsSeed) return 1;
        return (b.msv ?? 0) - (a.msv ?? 0);
      });

      return { results: deduped, message: `Found ${deduped.length} keywords from ${seeds.length} seeds.` };
    }),
});
