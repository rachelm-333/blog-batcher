/**
 * probeRicosLocal.ts — Runs OUR htmlToRicos() on the real article body (no Wix API)
 * and reports whether it produces a TABLE node. Isolates the bug: if a TABLE node
 * is produced with tableCellData, the problem is Wix rejecting it; if NOT, our
 * parser is flattening the table before it reaches the table builder.
 * Read-only. Run on Manus:  node --import tsx scripts/probeRicosLocal.ts
 */
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { htmlToRicos } from "../server/cmsPublisher";

function findNode(ricos: any, type: string): any {
  const walk = (n: any): any => {
    if (!n) return null;
    if (n.type === type) return n;
    for (const c of n.nodes ?? []) { const r = walk(c); if (r) return r; }
    return null;
  };
  for (const n of ricos.nodes ?? []) { const r = walk(n); if (r) return r; }
  return null;
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db.select({ title: articles.title, bodyHtml: articles.bodyHtml }).from(articles);
  const withTable = rows.find((r) => /<table\b/i.test(r.bodyHtml ?? ""));
  if (!withTable) { console.error("✗ No article body with a <table> found."); process.exit(1); }

  const body = withTable.bodyHtml ?? "";
  console.log(`Article: ${withTable.title}`);

  // Show how the table is wrapped in the source HTML (100 chars BEFORE <table>)
  const tIdx = body.search(/<table\b/i);
  const before = body.slice(Math.max(0, tIdx - 120), tIdx).replace(/\n/g, " ");
  const tableHtml = body.slice(tIdx).match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  console.log(`\nContext BEFORE <table> (120 chars): …${before}`);
  console.log(`\nRaw table HTML (350 chars): ${tableHtml.slice(0, 350).replace(/\n/g, " ")}`);

  // Run our converter on the FULL body
  const ricos = htmlToRicos(body) as any;
  const tableNode = findNode(ricos, "TABLE");
  console.log(`\n→ htmlToRicos produced a TABLE node: ${tableNode ? "YES ✓" : "NO ✗ (flattened to text)"}`);
  if (tableNode) {
    const cell = tableNode.nodes?.[0]?.nodes?.[0];
    console.log(`   rows: ${tableNode.nodes?.length}, first-row cells: ${tableNode.nodes?.[0]?.nodes?.length}`);
    console.log(`   cell uses tableCellData: ${cell?.tableCellData ? "YES ✓" : "NO ✗"}  (cellData present: ${cell?.cellData ? "yes" : "no"})`);
    console.log(`   TABLE node (700 chars): ${JSON.stringify(tableNode).slice(0, 700)}`);
  } else {
    // Isolate the table fragment and run the converter on JUST it
    const soloRicos = htmlToRicos(tableHtml) as any;
    const soloTable = findNode(soloRicos, "TABLE");
    console.log(`   Converting the table fragment ALONE → TABLE node: ${soloTable ? "YES ✓" : "NO ✗"}`);
    console.log(`   ⇒ If ALONE works but in-body fails, a wrapper (e.g. <figure>) is flattening it to text.`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
