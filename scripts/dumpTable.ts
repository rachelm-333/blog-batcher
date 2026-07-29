/**
 * dumpTable.ts — show whether each article's saved body contains a real <table>,
 * and print how the "at-a-glance" / metric content is actually structured, so we
 * can tell if the writer produced a real table or just stacked headings/paragraphs.
 * Read-only. Run on Manus:  node --import tsx scripts/dumpTable.ts
 */
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db
    .select({ id: articles.id, title: articles.title, status: articles.status, bodyHtml: articles.bodyHtml })
    .from(articles);

  for (const r of rows) {
    const body = r.bodyHtml ?? "";
    const tableCount = (body.match(/<table\b/gi) || []).length;
    const trCount = (body.match(/<tr\b/gi) || []).length;
    const mdTable = /\n\s*\|[^\n]*\|\s*\n\s*\|?\s*[-:| ]+\|/.test(body); // markdown pipe table
    console.log(`\n▸ [${r.status}] ${r.title}`);
    console.log(`    <table> tags: ${tableCount}   <tr> rows: ${trCount}   markdown-pipe-table: ${mdTable}`);
    if (tableCount > 0) {
      const idx = body.search(/<table\b/i);
      console.log(`    TABLE HTML (400 chars): ${body.slice(idx, idx + 400).replace(/\n/g, " ")}`);
    } else {
      // Show a snippet around the word "table" or a metric keyword to see what the writer emitted
      const m = body.match(/(awareness|at.a.glance|metric|comparison|<h[23][^>]*>[^<]*table)/i);
      if (m && m.index != null) {
        console.log(`    NO <table>. Nearby content (500 chars from "${m[0]}"):`);
        console.log("    " + body.slice(m.index, m.index + 500).replace(/\n/g, " "));
      } else {
        console.log(`    NO <table> and no obvious table-like section found.`);
      }
    }
  }
  console.log("");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
