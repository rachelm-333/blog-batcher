/**
 * resetForRegeneration.ts — reset a batch's articles so they can be regenerated
 * fresh (e.g. after changing the word-count ranges). Sets each article back to
 * "pending_generation" and clears the generated content + scores + CMS links,
 * so the app's Generate button reappears and rewrites them all.
 *
 * KEEPS the architecture, keywords, PAA, and content-plan directions — only the
 * generated article output is cleared.
 *
 * Dry run by default; --confirm to apply. Optional numeric businessId arg to
 * scope to one business. Run on Manus:
 *   node --import tsx scripts/resetForRegeneration.ts            # dry run, all
 *   node --import tsx scripts/resetForRegeneration.ts 1470001 --confirm
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

const argv = process.argv.slice(2);
const CONFIRMED = argv.includes("--confirm") || process.env.CONFIRM_RESET === "YES";
const bizArg = argv.find((a) => /^\d+$/.test(a));
const businessId = bizArg ? parseInt(bizArg, 10) : null;

// Any article that has been generated/published/etc. gets reset.
const RESET_FROM = ["generated", "pending_approval", "approved", "scheduled", "published", "failed", "generating"] as const;

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("✗ No DATABASE_URL here. Run on Manus.");
    process.exit(1);
  }

  const scope = businessId ? eq(articles.businessId, businessId) : sql`1=1`;
  const where = and(scope, inArray(articles.status, RESET_FROM as unknown as string[]));

  const rows = await db
    .select({ id: articles.id, title: articles.title, status: articles.status, businessId: articles.businessId })
    .from(articles)
    .where(where);

  console.log(
    `\nArticles that would be reset to "pending_generation"` +
      (businessId ? ` for business ${businessId}` : " (all businesses)") +
      `: ${rows.length}`
  );
  for (const r of rows.slice(0, 50)) {
    console.log(`  [${r.status}] biz ${r.businessId} — ${r.title ?? `Article ${r.id}`}`);
  }
  if (rows.length > 50) console.log(`  …and ${rows.length - 50} more`);

  if (!CONFIRMED) {
    console.log("\n⚠ DRY RUN — nothing changed. Re-run with --confirm to apply.\n");
    process.exit(0);
  }
  if (rows.length === 0) {
    console.log("\nNothing to reset.\n");
    process.exit(0);
  }

  await db
    .update(articles)
    .set({
      status: "pending_generation",
      bodyHtml: null,
      bodyMarkdown: null,
      wordCount: null,
      internalScore: null,
      pass2Score: null,
      pass2Details: null,
      pass1Details: null,
      statusBadge: null,
      faqItems: null,
      cmsPostId: null,
      cmsPostUrl: null,
      publishedAt: null,
      scheduledPublishAt: null,
      errorMessage: null,
    })
    .where(where);

  console.log(`\n✓ Reset ${rows.length} article(s) to "pending_generation" and cleared generated output.`);
  console.log("  Keywords, PAA and architecture are untouched. Go to Stage 4 and click Generate to rewrite them.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Reset failed:", err);
  process.exit(1);
});
