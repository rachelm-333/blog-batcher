/**
 * Layer 6 End-to-End Verification Script
 *
 * 1. Creates a test user + business profile (pool installation company, Sydney)
 * 2. Seeds a minimal architecture: 1 cornerstone → 1 pillar → 1 cluster
 * 3. Assigns one keyword to the cluster node
 * 4. Calls generateSingleArticle() directly
 * 5. Saves the result to the DB
 * 6. Prints the full article text, word count, all 16 Pass 1 points, and DB status badge
 *
 * Run from project root:
 *   node --loader tsx/esm server/e2e-layer6-verify.mjs
 * (tsx is already a dev dependency)
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Load environment variables the same way the server does
const { config } = await import("dotenv");
config({ path: ".env" });

// Now import project modules
const { getDb } = await import("./db.ts");
const {
  generateSingleArticle,
  getOrderedNodes,
  preGenerateSlugs,
  runPass1Scorer,
  WORD_COUNT_RULES,
  BADGE_THRESHOLDS,
} = await import("./articleEngine.ts");

const { drizzle } = await import("drizzle-orm/mysql2");
const schema = await import("../drizzle/schema.ts");
const { eq } = await import("drizzle-orm");

// ─── helpers ────────────────────────────────────────────────────────────────

function countWords(html) {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("❌  Database unavailable — check DATABASE_URL env var");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  LAYER 6 END-TO-END VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 1. Seed test user ──────────────────────────────────────────────────────
  console.log("Step 1: Creating test user…");
  const testOpenId = `e2e-verify-${Date.now()}`;
  await db.insert(schema.users).values({
    openId: testOpenId,
    name: "E2E Test User",
    email: "e2e-test@blogbatcher.test",
    loginMethod: "test",
    role: "user",
    onboardingComplete: true,
    emailVerified: true,
    lastSignedIn: new Date(),
  });
  const [user] = await db.select().from(schema.users).where(eq(schema.users.openId, testOpenId)).limit(1);
  console.log(`   ✓ User ID: ${user.id}\n`);

  // ── 2. Seed test business ──────────────────────────────────────────────────
  console.log("Step 2: Creating test business profile…");
  await db.insert(schema.businesses).values({
    userId: user.id,
    name: "BlueLine Pool Installations",
    websiteUrl: "https://bluelinepools.com.au",
    industry: "Pool Installation & Renovation",
    location: "Sydney, NSW",
    serviceArea: "Greater Sydney, Blue Mountains, Central Coast",
    uniqueValueProposition: "We build custom in-ground pools with a 10-year structural warranty, using only Australian-certified materials.",
    yearsInBusiness: 14,
    clientsServed: 820,
    awardsAccreditations: "SPASA Member, Master Builders Association, 2023 NSW Pool Builder of the Year",
    primaryCtaText: "Get a Free Quote",
    primaryCtaUrl: "https://bluelinepools.com.au/free-quote",
    contactPageUrl: "https://bluelinepools.com.au/contact",
    currentStage: 4,
    isTestBusiness: true,
    scrapeStatus: "complete",
  });
  const [biz] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.userId, user.id))
    .limit(1);
  console.log(`   ✓ Business ID: ${biz.id} — ${biz.name}\n`);

  // ── 3. Seed brand voice ────────────────────────────────────────────────────
  console.log("Step 3: Seeding brand voice…");
  await db.insert(schema.brandVoice).values({
    businessId: biz.id,
    primaryArchetype: "professional_authority",
    formalityLevel: "semi_formal",
    finalVoiceBrief:
      "Write as a trusted Sydney pool builder with 14 years of hands-on experience. Use a confident, knowledgeable tone — authoritative but approachable. Avoid jargon unless you explain it. Short sentences preferred. Address the reader as 'you'. Use Australian English spelling throughout.",
  });
  console.log("   ✓ Brand voice seeded\n");

  // ── 4. Seed services ───────────────────────────────────────────────────────
  await db.insert(schema.businessServices).values([
    { businessId: biz.id, name: "In-Ground Pool Installation", pageUrl: "https://bluelinepools.com.au/in-ground-pools" },
    { businessId: biz.id, name: "Pool Renovation & Resurfacing", pageUrl: "https://bluelinepools.com.au/renovation" },
    { businessId: biz.id, name: "Pool Heating & Solar Systems", pageUrl: "https://bluelinepools.com.au/heating" },
  ]);

  // ── 5. Seed audiences ─────────────────────────────────────────────────────
  await db.insert(schema.businessAudiences).values([
    { businessId: biz.id, label: "Sydney homeowners planning a new pool build" },
    { businessId: biz.id, label: "Families wanting a safe backyard pool for kids" },
  ]);

  // ── 6. Seed competitors ───────────────────────────────────────────────────
  await db.insert(schema.businessCompetitors).values([
    { businessId: biz.id, name: "Compass Pools Sydney", websiteUrl: "https://compasspools.com.au" },
    { businessId: biz.id, name: "Leisure Pools", websiteUrl: "https://leisurepools.com.au" },
  ]);

  // ── 7. Seed architecture ──────────────────────────────────────────────────
  console.log("Step 4: Seeding architecture (1 cornerstone → 1 pillar → 1 cluster)…");
  await db.insert(schema.blogArchitectures).values({
    businessId: biz.id,
    packSize: 20,
    cornerstoneCount: 1,
    pillarCount: 4,
    clustersPerPillar: 3,
    totalArticleCount: 13,
    confirmed: true,
  });
  const [arch] = await db
    .select()
    .from(schema.blogArchitectures)
    .where(eq(schema.blogArchitectures.businessId, biz.id))
    .limit(1);

  // Cornerstone
  await db.insert(schema.articleNodes).values({
    architectureId: arch.id,
    businessId: biz.id,
    level: "cornerstone",
    articleType: "cornerstone_guide",
    sortOrder: 0,
    urlSlug: "ultimate-guide-to-pool-installation-sydney",
  });
  const [csNode] = await db
    .select()
    .from(schema.articleNodes)
    .where(eq(schema.articleNodes.architectureId, arch.id))
    .limit(1);

  // Pillar
  await db.insert(schema.articleNodes).values({
    architectureId: arch.id,
    businessId: biz.id,
    level: "pillar",
    articleType: "how_to",
    parentCornerstoneId: csNode.id,
    sortOrder: 1,
    urlSlug: "how-to-choose-a-pool-builder-sydney",
  });
  const [pillarNode] = await db
    .select()
    .from(schema.articleNodes)
    .where(eq(schema.articleNodes.level, "pillar"))
    .limit(1);

  // Cluster (this is the article we'll generate)
  await db.insert(schema.articleNodes).values({
    architectureId: arch.id,
    businessId: biz.id,
    level: "cluster",
    articleType: "myth_busting",
    parentCornerstoneId: csNode.id,
    parentPillarId: pillarNode.id,
    sortOrder: 2,
    urlSlug: "pool-installation-cost-myths-sydney",
  });
  const [clusterNode] = await db
    .select()
    .from(schema.articleNodes)
    .where(eq(schema.articleNodes.level, "cluster"))
    .limit(1);

  console.log(`   ✓ Cornerstone node ID: ${csNode.id}`);
  console.log(`   ✓ Pillar node ID:      ${pillarNode.id}`);
  console.log(`   ✓ Cluster node ID:     ${clusterNode.id}\n`);

  // ── 8. Assign keyword to cluster ──────────────────────────────────────────
  console.log("Step 5: Assigning keyword to cluster node…");
  await db.insert(schema.keywords).values({
    articleNodeId: clusterNode.id,
    businessId: biz.id,
    primaryKeyword: "pool installation cost Sydney",
    secondaryKeywords: JSON.stringify(["how much does a pool cost in Sydney", "inground pool price NSW", "pool builder cost Sydney"]),
    paaQuestions: JSON.stringify([
      "How much does it cost to install a pool in Sydney?",
      "What is the cheapest type of pool to install?",
      "Do pool builders charge upfront?",
    ]),
    approvedPaaQuestion: "How much does it cost to install a pool in Sydney?",
    keywordApproved: true,
    paaApproved: true,
    cannibalizationWarning: false,
  });
  console.log(`   ✓ Keyword: "pool installation cost Sydney"\n`);

  // ── 9. Also assign keywords to cornerstone and pillar (needed for context) ─
  await db.insert(schema.keywords).values({
    articleNodeId: csNode.id,
    businessId: biz.id,
    primaryKeyword: "pool installation Sydney",
    keywordApproved: true,
    paaApproved: true,
    cannibalizationWarning: false,
  });
  await db.insert(schema.keywords).values({
    articleNodeId: pillarNode.id,
    businessId: biz.id,
    primaryKeyword: "how to choose a pool builder Sydney",
    keywordApproved: true,
    paaApproved: true,
    cannibalizationWarning: false,
  });

  // ── 10. Run generation ────────────────────────────────────────────────────
  console.log("Step 6: Running article generation (this may take 30–90 seconds)…");
  console.log("   Calling generateSingleArticle() for cluster node…\n");

  const allOrderedNodes = await getOrderedNodes(biz.id);
  const startTime = Date.now();
  const result = await generateSingleArticle(biz.id, clusterNode.id, allOrderedNodes);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`   ✓ Generation complete in ${elapsed}s\n`);

  // ── 11. Save to DB ────────────────────────────────────────────────────────
  console.log("Step 7: Saving article to database…");
  await db.insert(schema.articles).values({
    articleNodeId: clusterNode.id,
    businessId: biz.id,
    title: result.title,
    metaTitle: result.metaTitle,
    metaDescription: result.metaDescription,
    bodyHtml: result.bodyHtml,
    bodyMarkdown: result.bodyMarkdown,
    schemaMarkup: result.schemaMarkup,
    faqItems: result.faqItems,
    wordCount: result.wordCount,
    urlSlug: result.urlSlug,
    focusKeyword: "pool installation cost Sydney",
    internalScore: result.internalScore,
    statusBadge: result.statusBadge,
    status: "generated",
    generationAttempts: 1,
  });

  // Retrieve saved row to confirm DB persistence
  const [savedArticle] = await db
    .select()
    .from(schema.articles)
    .where(eq(schema.articles.articleNodeId, clusterNode.id))
    .limit(1);

  console.log(`   ✓ Article saved — DB row ID: ${savedArticle.id}\n`);

  // ── 12. Print full report ─────────────────────────────────────────────────

  const wordCountOk =
    result.wordCount >= WORD_COUNT_RULES.cluster.min &&
    result.wordCount <= WORD_COUNT_RULES.cluster.max;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  VERIFICATION REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("── ARTICLE METADATA ──────────────────────────────────────────");
  console.log(`Title:            ${result.title}`);
  console.log(`Meta Title:       ${result.metaTitle}`);
  console.log(`Meta Description: ${result.metaDescription}`);
  console.log(`URL Slug:         /${result.urlSlug}`);
  console.log(`Article Type:     myth_busting (Cluster)`);
  console.log(`Focus Keyword:    pool installation cost Sydney\n`);

  console.log("── WORD COUNT ────────────────────────────────────────────────");
  console.log(`Word Count:       ${result.wordCount}`);
  console.log(`Target Range:     ${WORD_COUNT_RULES.cluster.min}–${WORD_COUNT_RULES.cluster.max} words`);
  console.log(`In Range:         ${wordCountOk ? "✅  YES" : "❌  NO"}\n`);

  console.log("── STATUS BADGE ──────────────────────────────────────────────");
  console.log(`Internal Score:   ${result.internalScore}/100`);
  console.log(`Pass 1 Score:     (contributes 60% of internal score)`);
  console.log(`Pass 2 Score:     ${result.pass2Score}/100 (contributes 40%)`);
  const badgeLabel = {
    authority_ready: "🟢  AUTHORITY READY (≥90)",
    strong:          "🔵  STRONG (80–89)",
    needs_review:    "🟡  NEEDS REVIEW (<80)",
  }[result.statusBadge] ?? result.statusBadge;
  console.log(`Status Badge:     ${badgeLabel}`);
  console.log(`DB Status Badge:  ${savedArticle.statusBadge} ✓ (confirmed saved)\n`);

  console.log("── 16 AUTHORITY STANDARD POINTS (Pass 1) ─────────────────────");
  const pointLabels = {
    p1_keyword_density:       "P1  Keyword density 0.5–2.5%",
    p2_keyword_in_h1:         "P2  Keyword in H1 (title)",
    p3_keyword_in_h2:         "P3  Keyword in H2",
    p4_keyword_in_h3:         "P4  Keyword in H3",
    p5_keyword_first_100:     "P5  Keyword in first 100 words",
    p6_keyword_in_slug:       "P6  Keyword in URL slug",
    p7_meta_title:            "P7  Meta title ≤60 chars",
    p8_meta_description:      "P8  Meta description 140–160 chars",
    p9_opening_answer:        "P9  Opening answer block (Featured Snippet)",
    p10_external_link:        "P10 External authority link present",
    p11_internal_cta:         "P11 Internal CTA link present",
    p12_internal_blog_links:  "P12 Internal blog links present",
    p13_schema:               "P13 Schema markup present",
    p14_eeat:                 "P14 E-E-A-T signals (years, clients, awards)",
    p15_human_authenticity:   "P15 Human authenticity (no banned AI phrases)",
    p16_word_count:           "P16 Word count in target range",
  };

  let passCount = 0;
  for (const [key, label] of Object.entries(pointLabels)) {
    const passed = result.pass1Points[key] === true;
    if (passed) passCount++;
    console.log(`  ${passed ? "✅" : "❌"}  ${label}`);
  }
  console.log(`\n  ${passCount}/16 points passed\n`);

  console.log("── PASS 2 AI QUALITY FEEDBACK ────────────────────────────────");
  console.log(result.pass2Feedback || "(no feedback returned)");
  console.log();

  console.log("── FAQ SCHEMA ────────────────────────────────────────────────");
  console.log(`FAQ items (should be null for Cluster): ${result.faqItems === null ? "✅  null (correct)" : "❌  " + JSON.stringify(result.faqItems)}`);
  console.log();

  console.log("── DATABASE CONFIRMATION ─────────────────────────────────────");
  console.log(`DB Article ID:    ${savedArticle.id}`);
  console.log(`DB Status:        ${savedArticle.status}`);
  console.log(`DB Status Badge:  ${savedArticle.statusBadge}`);
  console.log(`DB Word Count:    ${savedArticle.wordCount}`);
  console.log(`DB Internal Score:${savedArticle.internalScore}`);
  console.log(`DB Business ID:   ${savedArticle.businessId}`);
  console.log();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  FULL ARTICLE TEXT");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(stripHtml(result.bodyHtml));
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  END OF VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── 13. Cleanup (remove test data) ────────────────────────────────────────
  console.log("Cleaning up test data…");
  try {
    await db.delete(schema.articles).where(eq(schema.articles.businessId, biz.id));
    await db.delete(schema.keywords).where(eq(schema.keywords.businessId, biz.id));
    await db.delete(schema.articleNodes).where(eq(schema.articleNodes.businessId, biz.id));
    await db.delete(schema.blogArchitectures).where(eq(schema.blogArchitectures.businessId, biz.id));
    await db.delete(schema.brandVoice).where(eq(schema.brandVoice.businessId, biz.id));
    await db.delete(schema.businessAudiences).where(eq(schema.businessAudiences.businessId, biz.id));
    await db.delete(schema.businessServices).where(eq(schema.businessServices.businessId, biz.id));
    await db.delete(schema.businessCompetitors).where(eq(schema.businessCompetitors.businessId, biz.id));
    await db.delete(schema.businesses).where(eq(schema.businesses.id, biz.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    console.log("   ✓ Test data cleaned up\n");
  } catch (cleanupErr) {
    console.warn("   ⚠ Cleanup warning (non-fatal):", cleanupErr.message);
  }

  console.log("Verification complete.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌  Verification failed:", err);
  process.exit(1);
});
