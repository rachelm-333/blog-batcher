/**
 * Layer 3 — Stage 1: Business Profile & Website Scrape
 *
 * Procedures:
 *  business.get          — get the user's current business (or null)
 *  business.create       — create a new business for the logged-in user
 *  business.update       — update all business detail fields
 *  business.scrape       — AI scrape via Claude: returns prefilled fields
 *  business.saveAudiences    — upsert audience groups
 *  business.saveServices     — upsert services/products
 *  business.saveCompetitors  — upsert competitors (max 3)
 *  business.saveBrandVoice   — upsert brand_voice row
 *  business.saveExistingContent — store scraped blog posts
 *  business.markStageComplete — advance stage tracker
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  articles,
  brandVoice,
  businessAudiences,
  businessCompetitors,
  businessExistingContent,
  businessServices,
  businesses,
} from "../../drizzle/schema";
import { invokeLLMWithCost } from "../apiCostLogger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Converts null, undefined, or the literal string "null"/"undefined" to undefined. */
const cleanVal = (v: string | null | undefined): string | undefined =>
  v && v !== "null" && v !== "undefined" ? v : undefined;

/** Ensure the user owns the given business. Throws FORBIDDEN if not. */
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

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const audienceSchema = z.object({
  id: z.number().optional(),
  label: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().default(0),
});

const serviceSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  pageUrl: z.string().optional(),
  sortOrder: z.number().default(0),
});

const competitorSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  websiteUrl: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.number().default(0),
});

const brandVoiceSchema = z.object({
  primaryArchetype: z
    .enum(["professional_authority", "friendly_neighbour", "bold_direct", "inspiring_thought_leader"])
    .optional(),
  secondaryArchetype: z
    .enum(["professional_authority", "friendly_neighbour", "bold_direct", "inspiring_thought_leader"])
    .optional(),
  namedPersona: z.string().optional(),
  formalityLevel: z
    .enum(["very_formal", "formal", "semi_formal", "conversational", "casual"])
    .optional(),
  keyPhrases: z.array(z.string()).optional(),
  phrasesToAvoid: z.array(z.string()).optional(),
  styleNotes: z.string().optional(),
  finalVoiceBrief: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const businessRouter = router({
  // -------------------------------------------------------------------------
  // GET — returns the first business for this user (or null)
  // Used by onboarding and single-business pages that don't pass a businessId
  // -------------------------------------------------------------------------
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const rows = await db
      .select()
      .from(businesses)
      .where(eq(businesses.userId, ctx.user.id))
      .limit(1);

    if (!rows.length) return null;
    const biz = rows[0];

    // Fetch related rows
    const [audiences, services, competitors, existingContent, brandVoiceRows] = await Promise.all([
      db.select().from(businessAudiences).where(eq(businessAudiences.businessId, biz.id)),
      db.select().from(businessServices).where(eq(businessServices.businessId, biz.id)),
      db.select().from(businessCompetitors).where(eq(businessCompetitors.businessId, biz.id)),
      db.select().from(businessExistingContent).where(eq(businessExistingContent.businessId, biz.id)),
      db.select().from(brandVoice).where(eq(brandVoice.businessId, biz.id)).limit(1),
    ]);

    return {
      ...biz,
      audiences,
      services,
      competitors,
      existingContent,
      brandVoice: brandVoiceRows[0] ?? null,
    };
  }),

  // -------------------------------------------------------------------------
  // GET BY ID — fetch a specific business by ID (with ownership check)
  // Used by multi-business pages that pass a businessId
  // -------------------------------------------------------------------------
  getById: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertOwnership(ctx.user.id, input.businessId);
      const rows = await db
        .select()
        .from(businesses)
        .where(and(eq(businesses.id, input.businessId), eq(businesses.userId, ctx.user.id)))
        .limit(1);
      if (!rows.length) return null;
      const biz = rows[0]!;
      const [audiences, services, competitors, existingContent, brandVoiceRows] = await Promise.all([
        db.select().from(businessAudiences).where(eq(businessAudiences.businessId, biz.id)),
        db.select().from(businessServices).where(eq(businessServices.businessId, biz.id)),
        db.select().from(businessCompetitors).where(eq(businessCompetitors.businessId, biz.id)),
        db.select().from(businessExistingContent).where(eq(businessExistingContent.businessId, biz.id)),
        db.select().from(brandVoice).where(eq(brandVoice.businessId, biz.id)).limit(1),
      ]);
      return {
        ...biz,
        audiences,
        services,
        competitors,
        existingContent,
        brandVoice: brandVoiceRows[0] ?? null,
      };
    }),

  // -------------------------------------------------------------------------
  // LIST ALL — all businesses for the logged-in user (lightweight)
  // Used by the business switcher and multi-business management
  // -------------------------------------------------------------------------
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db
      .select({
        id: businesses.id,
        name: businesses.name,
        industry: businesses.industry,
        location: businesses.location,
        currentStage: businesses.currentStage,
        cmsPlatform: businesses.cmsPlatform,
        createdAt: businesses.createdAt,
      })
      .from(businesses)
      .where(eq(businesses.userId, ctx.user.id))
      .orderBy(businesses.createdAt);
    return rows;
  }),

  // -------------------------------------------------------------------------
  // CREATE — create a new business for the logged-in user
  // -------------------------------------------------------------------------
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        websiteUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const result = await db.insert(businesses).values({
        userId: ctx.user.id,
        name: input.name,
        websiteUrl: input.websiteUrl,
        scrapeStatus: "pending",
        currentStage: 1,
      });

      const insertId = (result as any)[0]?.insertId ?? (result as any).insertId;
      return { id: Number(insertId) };
    }),

  // -------------------------------------------------------------------------
  // UPDATE — update all business detail fields
  // -------------------------------------------------------------------------
  update: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        name: z.string().min(1).optional(),
        websiteUrl: z.string().optional(),
        industry: z.string().optional(),
        location: z.string().optional(),
        serviceArea: z.string().optional(),
        physicalAddress: z.string().optional(),
        isPhysicalLocation: z.boolean().optional(),
        abnBusinessRegistration: z.string().optional(),
        uniqueValueProposition: z.string().optional(),
        problemsSolved: z.string().optional(),
        keywordExclusions: z.string().optional(),
        yearsInBusiness: z.number().optional(),
        clientsServed: z.number().optional(),
        awardsAccreditations: z.string().optional(),
        linkedinUrl: z.string().optional(),
        facebookUrl: z.string().optional(),
        instagramHandle: z.string().optional(),
        primaryCtaText: z.string().optional(),
        primaryCtaUrl: z.string().optional(),
        contactPageUrl: z.string().optional(),
        bookingsPageUrl: z.string().optional(),
        testimonialsPageUrl: z.string().optional(),
        shopUrl: z.string().optional(),
        otherInternalLinks: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
        cmsPlatform: z
          .enum(["wordpress", "wix", "shopify", "webflow", "squarespace", "ghost", "zapier", "download"])
          .optional(),
        wordpressSeoPlugin: z.enum(["yoast", "rankmath", "aioseo", "none"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { businessId, ...fields } = input;
      await assertOwnership(ctx.user.id, businessId);

      await db.update(businesses).set(fields).where(eq(businesses.id, businessId));
      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // SCRAPE — AI-powered website scrape using Claude
  // Returns a prefilled object for all Stage 1 sections.
  // -------------------------------------------------------------------------
  scrape: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        businessName: z.string(),
        websiteUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      // Mark scrape as running
      await db
        .update(businesses)
        .set({ scrapeStatus: "running" })
        .where(eq(businesses.id, input.businessId));

      // ── Fetch website content ────────────────────────────────────────────────
      let websiteContent = "";
      let metaTitle = "";
      let metaDescription = "";

      // Detect website builders that commonly block basic HTTP scrapers
      const BUILDER_PATTERNS = [
        { pattern: /\.wix\.com|wixsite\.com|x-wix-/i, name: "Wix" },
        { pattern: /squarespace\.com|squarespace-cdn/i, name: "Squarespace" },
        { pattern: /webflow\.io|webflow\.com/i, name: "Webflow" },
        { pattern: /myshopify\.com|shopify\.com/i, name: "Shopify" },
      ];
      const detectedBuilder = BUILDER_PATTERNS.find((b) => b.pattern.test(input.websiteUrl));
      if (detectedBuilder) {
        console.log(`[Scrape] Detected ${detectedBuilder.name} site — using JS-rendered scraper:`, input.websiteUrl);
      }

      // ── TIER 1: Jina AI Reader — handles JavaScript-rendered pages (Wix, Squarespace, Webflow, etc.) ──
      let jinaSucceeded = false;
      try {
        const jinaUrl = `https://r.jina.ai/${input.websiteUrl}`;
        const jinaController = new AbortController();
        const jinaTimeout = setTimeout(() => jinaController.abort(), 25000);
        const jinaRes = await fetch(jinaUrl, {
          signal: jinaController.signal,
          headers: {
            "Accept": "text/plain",
            "User-Agent": "Mozilla/5.0 (compatible; BlogBatcher/1.0)",
          },
        });
        clearTimeout(jinaTimeout);

        if (jinaRes.ok) {
          const jinaText = await jinaRes.text();
          // Jina returns markdown — extract title from the first line if present
          const jinaTitleMatch = jinaText.match(/^Title:\s*(.+)$/m);
          if (jinaTitleMatch) metaTitle = jinaTitleMatch[1].trim();

          // Use the Jina content directly (already clean markdown, no HTML stripping needed)
          websiteContent = jinaText.slice(0, 12000);

          if (websiteContent.length > 200) {
            jinaSucceeded = true;
            console.log(`[Scrape] Jina AI Reader succeeded (${websiteContent.length} chars) for:`, input.websiteUrl);
          } else {
            console.warn(`[Scrape] Jina AI Reader returned sparse content (${websiteContent.length} chars), falling back to direct fetch`);
          }
        } else {
          console.warn(`[Scrape] Jina AI Reader returned ${jinaRes.status}, falling back to direct fetch`);
        }
      } catch (jinaErr) {
        console.warn("[Scrape] Jina AI Reader failed, falling back to direct fetch:", jinaErr);
      }

      // ── TIER 2: Direct fetch + meta tag extraction ──────────────────────────
      if (!jinaSucceeded) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          const fetchRes = await fetch(input.websiteUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; BlogBatcher/1.0)" },
          });
          clearTimeout(timeoutId);
          const html = await fetchRes.text();

          // Extract <title> and <meta name="description"> as reliable fallback signals
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) metaTitle = titleMatch[1].trim();
          const metaDescMatch =
            html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
          if (metaDescMatch) metaDescription = metaDescMatch[1].trim();

          // Strip HTML tags and collapse whitespace
          websiteContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 12000);

          // Supplement sparse body with meta signals
          if (websiteContent.length < 200 && (metaTitle || metaDescription)) {
            console.warn(`[Scrape] Sparse body (${websiteContent.length} chars) — supplementing with meta tags`);
            websiteContent = `Page title: ${metaTitle}\nMeta description: ${metaDescription}\n\n${websiteContent}`;
          }

          console.log(`[Scrape] Direct fetch succeeded (${websiteContent.length} chars) for:`, input.websiteUrl);
        } catch (fetchErr) {
          // ── TIER 3: Both failed — proceed with URL + business name only ──────
          console.warn("[Scrape] Both Jina and direct fetch failed, proceeding with URL only:", fetchErr);
          websiteContent = "(Website content could not be fetched — use the URL and business name to infer details.)";
        }
      }

      const prompt = `You are an expert business analyst and SEO strategist. Analyse the following website content for the business "${input.businessName}" (${input.websiteUrl}) and extract the information below. Return ONLY valid JSON matching the schema — no markdown, no explanation.

WEBSITE CONTENT:
${websiteContent}

---

Extract:

{
  "industry": "string — industry or category (e.g. 'Physiotherapy', 'E-commerce', 'Legal Services')",
  "location": "string — city/state, 'Nationwide', or 'Online Only'",
  "serviceArea": "string — where they ship/service",
  "uniqueValueProposition": "string — what makes this business different in 1–2 sentences",
  "audiences": [
    { "label": "string — short audience label", "description": "string — what they search for and why" }
  ],
  "services": [
    { "name": "string — service or product name", "pageUrl": "string or null — URL to that page if found" }
  ],
  "contactPageUrl": "string or null",
  "bookingsPageUrl": "string or null",
  "testimonialsPageUrl": "string or null",
  "shopUrl": "string or null",
  "primaryCtaText": "string — e.g. 'Book a free consultation'",
  "primaryCtaUrl": "string or null",
  "competitors": [
    { "name": "string", "websiteUrl": "string or null", "description": "string or null" }
  ],
  "brandVoice": {
    "formalityLevel": "very_formal | formal | semi_formal | conversational | casual",
    "keyPhrases": ["string"],
    "phrasesToAvoid": ["string"],
    "styleNotes": "string — e.g. 'Uses short sentences. Avoids jargon.'",
    "primaryArchetype": "professional_authority | friendly_neighbour | bold_direct | inspiring_thought_leader",
    "finalVoiceBrief": "string — 2–4 sentence voice brief compiled from all sources above"
  },
  "existingBlogPosts": [
    { "title": "string or null", "url": "string", "detectedKeyword": "string or null" }
  ],
  "yearsInBusiness": "number or null",
  "clientsServed": "number or null",
  "awardsAccreditations": "string or null"
}

Rules:
- Return only data you can confidently infer from the website. Use null for unknowns.
- Audiences: 2–5 groups maximum.
- Services: list all distinct services/products found, up to 10.
- Competitors: suggest 2–3 based on industry and location. These are suggestions — the user will confirm.
- Existing blog posts: list up to 10 blog posts found on the site.
- finalVoiceBrief must be a complete, usable brief that could be sent directly to an AI writing assistant.`;

      try {
        const response = await invokeLLMWithCost(
          {
            messages: [
              {
                role: "system",
                content:
                  "You are a business analyst. Return only valid JSON. No markdown fences, no explanation.",
              },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" } as any,
          },
          { userId: ctx.user.id, feature: "business_scrape" }
        );

        const raw = (response?.choices?.[0]?.message?.content as string) ?? "{}";
        let parsed: any = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {};
        }

        // Use meta description as UVP fallback if the LLM couldn't extract one
        if (!parsed.uniqueValueProposition && metaDescription) {
          console.warn("[Scrape] Using meta description as UVP fallback");
          parsed.uniqueValueProposition = metaDescription;
        }

        // Cache the scrape result and mark complete
        await db
          .update(businesses)
          .set({
            scrapeStatus: "complete",
            lastScrapedAt: new Date(),
            scrapeCache: parsed,
            // Pre-fill top-level fields from scrape
            industry: cleanVal(parsed.industry),
            location: cleanVal(parsed.location),
            serviceArea: cleanVal(parsed.serviceArea),
            uniqueValueProposition: cleanVal(parsed.uniqueValueProposition),
            primaryCtaText: cleanVal(parsed.primaryCtaText),
            primaryCtaUrl: cleanVal(parsed.primaryCtaUrl),
            contactPageUrl: cleanVal(parsed.contactPageUrl),
            bookingsPageUrl: cleanVal(parsed.bookingsPageUrl),
            testimonialsPageUrl: cleanVal(parsed.testimonialsPageUrl),
            shopUrl: cleanVal(parsed.shopUrl),
            yearsInBusiness: parsed.yearsInBusiness ?? undefined,
            clientsServed: parsed.clientsServed ?? undefined,
            awardsAccreditations: cleanVal(parsed.awardsAccreditations),
          })
          .where(eq(businesses.id, input.businessId));

        return { success: true, data: parsed };
      } catch (err) {
        await db
          .update(businesses)
          .set({ scrapeStatus: "failed" })
          .where(eq(businesses.id, input.businessId));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Scrape failed. Please try again.",
        });
      }
    }),

  // -------------------------------------------------------------------------
  // SAVE AUDIENCES — replace all audience rows for this business
  // -------------------------------------------------------------------------
  saveAudiences: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        audiences: z.array(audienceSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      // Delete existing and re-insert (simple replace strategy)
      await db
        .delete(businessAudiences)
        .where(eq(businessAudiences.businessId, input.businessId));

      if (input.audiences.length > 0) {
        await db.insert(businessAudiences).values(
          input.audiences.map((a, i) => ({
            businessId: input.businessId,
            label: a.label,
            description: a.description ?? null,
            sortOrder: a.sortOrder ?? i,
          }))
        );
      }

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // SAVE SERVICES — replace all service rows for this business
  // -------------------------------------------------------------------------
  saveServices: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        services: z.array(serviceSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      await db
        .delete(businessServices)
        .where(eq(businessServices.businessId, input.businessId));

      if (input.services.length > 0) {
        await db.insert(businessServices).values(
          input.services.map((s, i) => ({
            businessId: input.businessId,
            name: s.name,
            pageUrl: s.pageUrl ?? null,
            sortOrder: s.sortOrder ?? i,
          }))
        );
      }

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // SAVE COMPETITORS — replace all competitor rows (max 3)
  // -------------------------------------------------------------------------
  saveCompetitors: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        competitors: z.array(competitorSchema).max(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      await db
        .delete(businessCompetitors)
        .where(eq(businessCompetitors.businessId, input.businessId));

      if (input.competitors.length > 0) {
        await db.insert(businessCompetitors).values(
          input.competitors.map((c, i) => ({
            businessId: input.businessId,
            name: c.name,
            websiteUrl: c.websiteUrl ?? null,
            description: c.description ?? null,
            sortOrder: c.sortOrder ?? i,
          }))
        );
      }

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // SAVE BRAND VOICE — upsert the brand_voice row for this business
  // -------------------------------------------------------------------------
  saveBrandVoice: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        voice: brandVoiceSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      const existing = await db
        .select({ id: brandVoice.id })
        .from(brandVoice)
        .where(eq(brandVoice.businessId, input.businessId))
        .limit(1);

      const values = {
        businessId: input.businessId,
        primaryArchetype: input.voice.primaryArchetype ?? null,
        secondaryArchetype: input.voice.secondaryArchetype ?? null,
        namedPersona: input.voice.namedPersona ?? null,
        formalityLevel: input.voice.formalityLevel ?? null,
        keyPhrases: input.voice.keyPhrases ?? null,
        phrasesToAvoid: input.voice.phrasesToAvoid ?? null,
        styleNotes: input.voice.styleNotes ?? null,
        finalVoiceBrief: input.voice.finalVoiceBrief ?? null,
      };

      if (existing.length > 0) {
        await db.update(brandVoice).set(values).where(eq(brandVoice.businessId, input.businessId));
      } else {
        await db.insert(brandVoice).values(values);
      }

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // SAVE EXISTING CONTENT — store scraped blog posts (replaces all)
  // -------------------------------------------------------------------------
  saveExistingContent: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        posts: z.array(
          z.object({
            title: z.string().optional(),
            url: z.string(),
            detectedKeyword: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      await db
        .delete(businessExistingContent)
        .where(eq(businessExistingContent.businessId, input.businessId));

      if (input.posts.length > 0) {
        await db.insert(businessExistingContent).values(
          input.posts.map((p) => ({
            businessId: input.businessId,
            title: p.title ?? null,
            url: p.url,
            detectedKeyword: p.detectedKeyword ?? null,
          }))
        );
      }

      return { success: true };
    }),

  // -------------------------------------------------------------------------
  // MARK STAGE COMPLETE — advance the stage tracker
  // -------------------------------------------------------------------------
  markStageComplete: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        completedStage: z.number().min(1).max(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await assertOwnership(ctx.user.id, input.businessId);

      const nextStage = input.completedStage + 1;
      await db
        .update(businesses)
        .set({ currentStage: nextStage })
        .where(
          and(
            eq(businesses.id, input.businessId),
            // Only advance if still on the expected stage
            eq(businesses.currentStage, input.completedStage)
          )
        );

      return { success: true, nextStage };
    }),

  /**
   * Delete a business. Only allowed if the business has zero articles
   * (safety guard to prevent accidental data loss).
   */
  delete: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertOwnership(ctx.user.id, input.businessId);

      // Safety: refuse if there are any articles attached
      const articleRows = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.businessId, input.businessId));

      if (articleRows.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete a business that has ${articleRows.length} article(s). Delete the articles first or contact support.`,
        });
      }

      // Delete related records first (FK order)
      await db.delete(businessAudiences).where(eq(businessAudiences.businessId, input.businessId));
      await db.delete(businessServices).where(eq(businessServices.businessId, input.businessId));
      await db.delete(businessCompetitors).where(eq(businessCompetitors.businessId, input.businessId));
      await db.delete(businessExistingContent).where(eq(businessExistingContent.businessId, input.businessId));
      await db.delete(brandVoice).where(eq(brandVoice.businessId, input.businessId));
            await db.delete(businesses).where(eq(businesses.id, input.businessId));
      return { success: true };
    }),

  /**
   * Start a new batch for an existing business.
   * Increments activeBatch, resets currentStage to 2 (Architecture),
   * and preserves all business profile data and previous batch articles.
   */
  startNewBatch: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnership(ctx.user.id, input.businessId);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [biz] = await db
        .select({ activeBatch: businesses.activeBatch, currentStage: businesses.currentStage })
        .from(businesses)
        .where(eq(businesses.id, input.businessId))
        .limit(1);
      if (!biz) throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });

      // Must have reached at least Stage 4 (Publish & Schedule — the final stage) before starting a new batch
      if (biz.currentStage < 4) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Complete the current batch (reach the Publish & Schedule stage) before starting a new one.",
        });
      }

      const newBatch = (biz.activeBatch ?? 1) + 1;

      await db
        .update(businesses)
        .set({
          activeBatch: newBatch,
          currentStage: 2, // Skip Stage 1 (profile already done), go straight to Architecture
        })
        .where(eq(businesses.id, input.businessId));

      return { success: true, newBatch };
    }),

  // -------------------------------------------------------------------------
  // GENERATE PROBLEMS SOLVED — AI interview helper
  // -------------------------------------------------------------------------
  generateProblemsSolved: protectedProcedure
    .input(
      z.object({
        answer1: z.string().min(1),
        answer2: z.string().min(1),
        answer3: z.string().min(1),
        businessName: z.string(),
        industry: z.string(),
      })
    )
    .output(z.object({ paragraph: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const prompt = `You are helping a business owner describe the core problems their business solves for customers. Write a 2-3 sentence paragraph in first person plural ('our clients', 'we help') based on their answers below.

The paragraph should:
- Open with the customer's situation or frustration BEFORE finding this business
- Name the specific pain, struggle, or problem in plain language (not corporate speak)
- End with what changes or becomes possible after working with this business
- Sound like a real business owner wrote it, not like marketing copy
- Be specific — use the details they provided, not generic phrases

Business: ${input.businessName}, Industry: ${input.industry}

Answer 1 (situation before): ${input.answer1}
Answer 2 (frustrations/struggles): ${input.answer2}
Answer 3 (what changed after): ${input.answer3}

Write only the paragraph. No intro, no label, no explanation.`;

      const response = await invokeLLMWithCost(
        {
          messages: [
            { role: "system", content: "You are a skilled copywriter. Return only the requested paragraph with no additional text." },
            { role: "user", content: prompt },
          ],
        },
        { userId: ctx.user.id, feature: "other" }
      );

      const paragraph = ((response?.choices?.[0]?.message?.content as string) ?? "").trim();
      if (!paragraph) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Generation failed. Please try again." });
      }

      // Save the raw interview answers to the business record
      const db = await getDb();
      if (db) {
        // Find the user's active business to save the answers against
        const [biz] = await db
          .select({ id: businesses.id })
          .from(businesses)
          .where(eq(businesses.userId, ctx.user.id))
          .limit(1);
        if (biz) {
          await db
            .update(businesses)
            .set({
              customerSituationBefore: input.answer1,
              customerFrustrations: input.answer2,
              customerTransformation: input.answer3,
            })
            .where(eq(businesses.id, biz.id));
        }
      }

      return { paragraph };
    }),
});
