/**
 * dumpSchema.ts — prints, per article, which schema @types are present in the
 * stored schemaMarkup (Article / BreadcrumbList / FAQPage / HowTo / Organization),
 * plus level + articleType. Answers: do my ranking articles have proper markup?
 * Read-only. Run on Manus:  node --import tsx scripts/dumpSchema.ts
 */
import { getDb } from "../server/db";
import { articles, articleNodes } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({
      title: articles.title,
      status: articles.status,
      level: articleNodes.level,
      articleType: articleNodes.articleType,
      schema: articles.schemaMarkup,
    })
    .from(articles)
    .leftJoin(articleNodes, eq(articles.articleNodeId, articleNodes.id));

  const TYPES = ["Article", "BreadcrumbList", "FAQPage", "HowTo", "Organization", "Person"];
  console.log("\nSchema @types per article (✓ present):\n");
  for (const r of rows) {
    const s = r.schema ?? "";
    const present = TYPES.filter((t) => new RegExp(`"@type"\\s*:\\s*"${t}"`).test(s));
    const expectFaq = r.level === "cornerstone" || r.level === "pillar";
    const faqOk = expectFaq ? present.includes("FAQPage") : !present.includes("FAQPage");
    const flag = faqOk ? "" : "   ⚠ FAQ mismatch for this level";
    console.log(`▸ [${r.level ?? "?"}/${r.articleType ?? "?"}] ${r.title}`);
    console.log(`    schema length: ${s.length}   types: ${present.join(", ") || "(none)"}${flag}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
