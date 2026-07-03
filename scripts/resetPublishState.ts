/**
 * resetPublishState.ts — reset articles back to a publishable state so they can
 * be re-published to the CMS from scratch.
 *
 * Use when posts were deleted from the CMS (e.g. pulled off Wix) but the app
 * still has them marked "published" with stale cmsPostId/cmsPostUrl. This flips
 * those articles back to "approved" and clears the dead CMS links/ids so you can
 * publish fresh and test the internal-link resolution.
 *
 * Article BODIES are untouched — only publish state is reset. Nothing else
 * (business profiles, keywords, architecture) is affected.
 *
 * SAFETY: dry run by default (prints what it would reset). Pass --confirm (or
 * CONFIRM_RESET=YES) to apply. Optionally pass a numeric business id as the
 * first arg to limit it to one business; omit to reset all.
 *
 * Run on the deployment (Manus) where DATABASE_URL is set:
 *   node --import tsx scripts/resetPublishState.ts            # dry run, all businesses
 *   node --import tsx scripts/resetPublishState.ts 42         # dry run, business 42
 *   node --import tsx scripts/resetPublishState.ts 42 --confirm
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

const argv = process.argv.slice(2);
const CONFIRMED = argv.includes("--confirm") || process.env.CONFIRM_RESET === "YES";
const bizArg = argv.find((a) => /^\d+$/.test(a));
const businessId = bizArg ? parseInt(bizArg, 10) : null;

// Statuses that represent "already handed to the CMS" — these get reset.
const RESET_FROM = ["published", "scheduled", "failed"] as const;

async function main() {
  const db = await getDb();
  if (!db) {
    console.error(
      "✗ No database connection. DATABASE_URL is not set here.\n" +
        "  Run this on the deployment (Manus) where DATABASE_URL is configured."
    );
    process.exit(1);
  }

  const scope = businessId ? eq(articles.businessId, businessId) : sql`1=1`;
  const where = and(scope, inArray(articles.status, RESET_FROM as unknown as string[]));

  const rows = await db
    .select({ id: articles.id, title: articles.title, status: articles.status, businessId: articles.businessId })
    .from(articles)
    .where(where);

  console.log(
    `\nArticles that would be reset to "approved"` +
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
      status: "approved",
      publishedAt: null,
      scheduledPublishAt: null,
      cmsPostId: null,
      cmsPostUrl: null,
      errorMessage: null,
    })
    .where(where);

  console.log(`\n✓ Reset ${rows.length} article(s) to "approved" and cleared their CMS links/ids.`);
  console.log("  Article bodies were not touched. You can now publish fresh to Wix.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Reset failed:", err);
  process.exit(1);
});
