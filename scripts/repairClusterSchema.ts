/**
 * repairClusterSchema.ts — Strips FAQPage/Question schema from CLUSTER articles.
 * Clusters have no visible FAQ section, so FAQPage JSON-LD is an invalid Google
 * structured-data mismatch. Cornerstone/Pillar articles are left untouched.
 *
 * Dry run (default):   node --import tsx scripts/repairClusterSchema.ts
 * Apply changes:       node --import tsx scripts/repairClusterSchema.ts --confirm
 */
import { getDb } from "../server/db";
import { articles, articleNodes } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { stripFaqFromSchema } from "../server/articleEngine";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }
  const apply = process.argv.includes("--confirm");

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      level: articleNodes.level,
      schema: articles.schemaMarkup,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id));

  let changed = 0;
  for (const r of rows) {
    if (r.level !== "cluster") continue;
    const original = r.schema ?? "";
    const hadFaq = /"@type"\s*:\s*"(FAQPage|Question)"/.test(original);
    if (!hadFaq) { console.log(`  ok   ${r.title} (no FAQ schema)`); continue; }
    const repaired = stripFaqFromSchema(original);
    if (repaired === original) { console.log(`  skip ${r.title} (couldn't parse schema)`); continue; }
    changed++;
    console.log(`  FIX  ${r.title}  (${original.length} → ${repaired.length} chars)`);
    if (apply) {
      await db.update(articles).set({ schemaMarkup: repaired }).where(eq(articles.id, r.id));
    }
  }

  console.log(`\n${apply ? "Applied" : "Would fix"} ${changed} cluster article(s).`);
  if (!apply && changed > 0) console.log("Re-run with --confirm to apply.");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
