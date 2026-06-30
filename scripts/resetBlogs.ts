/**
 * resetBlogs.ts — Full batch reset of stored blog content for ALL businesses.
 *
 * Removes every generated article and the whole content batch (architectures,
 * nodes, keywords, schedules, etc.) while PRESERVING all business profile data
 * (businesses + audiences/services/competitors/existing content/brand voice),
 * users, credits, integrations, and Stripe/payment history.
 *
 * Billing/audit tables that merely *reference* an article (creditTransactions,
 * adminLog, notifications) keep their rows — only the article link is nulled.
 *
 * Each business is reset to Stage 2 (Architecture), batch 1, so the workflow
 * restarts at the architecture step with a clean slate. (This also clears any
 * old, now-invalid architectures.)
 *
 * SAFETY: dry run by default — prints the row counts it WOULD delete and exits.
 * Pass --confirm (or set CONFIRM_RESET=YES) to actually perform the deletion.
 *
 * Run on the deployment (where DATABASE_URL is set), e.g. on Manus:
 *   node --import tsx scripts/resetBlogs.ts            # dry run
 *   node --import tsx scripts/resetBlogs.ts --confirm  # perform reset
 */
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  articleImages,
  articles,
  keywords,
  articleNodes,
  blogArchitectures,
  selectedKeywords,
  keywordSeeds,
  schedules,
  publishAuditLog,
  creditTransactions,
  adminLog,
  notifications,
  businesses,
} from "../drizzle/schema";

const CONFIRMED = process.argv.includes("--confirm") || process.env.CONFIRM_RESET === "YES";

async function countRows(db: any, table: any, label: string): Promise<number> {
  const res = await db.select({ c: sql<number>`count(*)` }).from(table);
  const n = Number(res[0]?.c ?? 0);
  console.log(`  ${label.padEnd(22)} ${n}`);
  return n;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error(
      "✗ No database connection. DATABASE_URL is not set in this environment.\n" +
        "  Run this on the deployment (Manus) where DATABASE_URL is configured."
    );
    process.exit(1);
  }

  console.log("\nStored blog content currently in the database:");
  await countRows(db, blogArchitectures, "blog_architectures");
  await countRows(db, articleNodes, "article_nodes");
  await countRows(db, keywords, "keywords");
  await countRows(db, articles, "articles");
  await countRows(db, articleImages, "article_images");
  await countRows(db, publishAuditLog, "publish_audit_log");
  await countRows(db, selectedKeywords, "selected_keywords");
  await countRows(db, keywordSeeds, "keyword_seeds");
  await countRows(db, schedules, "schedules");
  const bizCount = await countRows(db, businesses, "businesses (KEPT)");

  if (!CONFIRMED) {
    console.log(
      "\n⚠ DRY RUN — nothing deleted. The above content WOULD be removed and all " +
        `${bizCount} business profiles kept.\n` +
        "  Re-run with --confirm to perform the reset.\n"
    );
    process.exit(0);
  }

  console.log("\n--confirm set → performing full batch reset…\n");

  // 1) Null out article links in billing/audit/notification rows (rows are kept).
  await db.update(creditTransactions).set({ articleId: null });
  await db.update(adminLog).set({ targetArticleId: null });
  await db.update(notifications).set({ articleId: null });
  console.log("  ✓ nulled article links in credit_transactions / admin_log / notifications");

  // 2) Delete content children → parents (FK-safe order).
  await db.delete(articleImages);
  await db.delete(publishAuditLog);
  await db.delete(articles);
  await db.delete(keywords);
  await db.delete(articleNodes);
  await db.delete(blogArchitectures);
  await db.delete(selectedKeywords);
  await db.delete(keywordSeeds);
  await db.delete(schedules);
  console.log("  ✓ deleted all stored blog content");

  // 3) Reset each business to the architecture step, batch 1.
  await db.update(businesses).set({ currentStage: 2, activeBatch: 1 });
  console.log("  ✓ reset all businesses to Stage 2 (Architecture), batch 1");

  console.log("\nVerifying — remaining stored blog content (should all be 0):");
  await countRows(db, blogArchitectures, "blog_architectures");
  await countRows(db, articleNodes, "article_nodes");
  await countRows(db, keywords, "keywords");
  await countRows(db, articles, "articles");
  await countRows(db, articleImages, "article_images");
  await countRows(db, schedules, "schedules");
  await countRows(db, businesses, "businesses (KEPT)");

  console.log("\n✓ Reset complete. Business profiles preserved.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Reset failed:", err);
  process.exit(1);
});
