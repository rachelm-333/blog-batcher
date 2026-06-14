/**
 * Inner TypeScript script for regenerating SafeWize articles.
 * Called by regenerate-safewize.mjs via tsx.
 */

import { eq, and } from "drizzle-orm";
import { articles, articleNodes, keywords } from "../drizzle/schema";
import { getDb } from "../server/db";
import { generateSingleArticle, getOrderedNodes, preGenerateSlugs } from "../server/articleEngine";

const BUSINESS_ID = 720001;
const BATCH_NUMBER = 2;

async function generateAndSave(
  businessId: number,
  nodeId: number,
  allOrderedNodes: Awaited<ReturnType<typeof getOrderedNodes>>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Get current attempt count
  const existing = await db
    .select({ id: articles.id, generationAttempts: articles.generationAttempts })
    .from(articles)
    .where(eq(articles.articleNodeId, nodeId))
    .limit(1);

  const attempts = (existing[0]?.generationAttempts ?? 0) + 1;

  // Mark as generating
  if (existing.length) {
    await db
      .update(articles)
      .set({ status: "generating", generationAttempts: attempts, errorMessage: null })
      .where(eq(articles.articleNodeId, nodeId));
  } else {
    await db.insert(articles).values({
      articleNodeId: nodeId,
      businessId,
      batchNumber: BATCH_NUMBER,
      status: "generating",
      generationAttempts: 1,
    });
  }

  try {
    console.log(`[Regenerate] Generating node ${nodeId}...`);
    const result = await generateSingleArticle(businessId, nodeId, allOrderedNodes);

    console.log(`[Regenerate] Node ${nodeId} done — ${result.wordCount} words, score ${result.internalScore}, badge: ${result.statusBadge}`);

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
        internalScore: result.internalScore,
        pass2Score: result.pass2Score,
        pass1Details: result.pass1Points as unknown,
        statusBadge: result.statusBadge,
        status: "generated",
        approvedAt: null,
        generationAttempts: attempts,
        errorMessage: null,
      })
      .where(eq(articles.articleNodeId, nodeId));

    // Set focus keyword
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Regenerate] Node ${nodeId} FAILED: ${msg}`);
    await db
      .update(articles)
      .set({ status: "failed", errorMessage: msg, generationAttempts: attempts })
      .where(eq(articles.articleNodeId, nodeId));
    throw err;
  }
}

async function main() {
  console.log(`[Regenerate] SafeWize businessId=${BUSINESS_ID}, batchNumber=${BATCH_NUMBER}`);

  // Pre-generate slugs
  await preGenerateSlugs(BUSINESS_ID, BATCH_NUMBER);

  // Get ordered nodes (cornerstone → pillar → cluster)
  const orderedNodes = await getOrderedNodes(BUSINESS_ID, BATCH_NUMBER);
  console.log(`[Regenerate] Found ${orderedNodes.length} nodes to generate`);

  for (const node of orderedNodes) {
    try {
      await generateAndSave(BUSINESS_ID, node.nodeId, orderedNodes);
    } catch (err) {
      console.error(`[Regenerate] Skipping node ${node.nodeId} after error:`, err);
    }
  }

  console.log(`[Regenerate] All articles generated. Checking word counts...`);

  // Verify results
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const results = await db
    .select({
      id: articles.id,
      title: articles.title,
      level: articleNodes.level,
      status: articles.status,
      wordCount: articles.wordCount,
      internalScore: articles.internalScore,
      statusBadge: articles.statusBadge,
    })
    .from(articles)
    .innerJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id))
    .where(and(eq(articles.businessId, BUSINESS_ID), eq(articles.batchNumber, BATCH_NUMBER)));

  console.log("\n=== FINAL RESULTS ===");
  for (const r of results) {
    const limit = r.level === "cornerstone" ? 3200 : r.level === "pillar" ? 2200 : 1300;
    const overLimit = (r.wordCount ?? 0) > limit;
    console.log(
      `[${r.level.toUpperCase()}] "${r.title}" — ${r.wordCount} words (limit: ${limit}) ${overLimit ? "⚠️ OVER LIMIT" : "✓"} | score: ${r.internalScore} | badge: ${r.statusBadge}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[Regenerate] Fatal error:", err);
  process.exit(1);
});
