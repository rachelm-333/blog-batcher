/**
 * verifyTables.ts — Runs the REAL publish-time converter (htmlToRicos) over every
 * stored article body and confirms each <table> becomes a BULLETED_LIST (not
 * flattened text). Proves all posts will publish tables as bullet lists.
 * Read-only, no publishing, no server needed.
 * Run on Manus:  node --import tsx scripts/verifyTables.ts
 */
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { htmlToRicos } from "../server/cmsPublisher";

function countType(ricos: any, type: string): number {
  let n = 0;
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === type) n++;
    for (const c of node.nodes ?? []) walk(c);
  };
  for (const node of ricos.nodes ?? []) walk(node);
  return n;
}

// Sample text from the first bullet so you can eyeball the format.
function firstBulletText(ricos: any): string {
  const walk = (node: any): any => {
    if (!node) return null;
    if (node.type === "BULLETED_LIST") return node;
    for (const c of node.nodes ?? []) { const r = walk(c); if (r) return r; }
    return null;
  };
  let list: any = null;
  for (const node of ricos.nodes ?? []) { list = walk(node); if (list) break; }
  if (!list) return "";
  const collect = (n: any): string => {
    let t = n.textData?.text ?? "";
    for (const c of n.nodes ?? []) t += collect(c);
    return t;
  };
  return collect(list.nodes?.[0] ?? {}).trim();
}

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  const rows = await db.select({ title: articles.title, body: articles.bodyHtml }).from(articles);

  let ok = 0, flat = 0, noTable = 0;
  console.log("\nTable → bullet-list conversion check (all articles):\n");
  for (const r of rows) {
    const body = r.body ?? "";
    const tableCount = (body.match(/<table\b/gi) || []).length;
    if (tableCount === 0) { noTable++; console.log(`  –    ${r.title}  (no table)`); continue; }

    const ricos = htmlToRicos(body) as any;
    const lists = countType(ricos, "BULLETED_LIST");
    const tablesLeft = countType(ricos, "TABLE");
    if (tablesLeft > 0) {
      flat++;
      console.log(`  ✗ FLAT ${r.title}  (${tablesLeft} TABLE node(s) survived — would NOT be a list)`);
    } else if (lists >= tableCount) {
      ok++;
      console.log(`  ✓ OK   ${r.title}  (${tableCount} table→bullets)  e.g. "${firstBulletText(ricos).slice(0, 90)}"`);
    } else {
      flat++;
      console.log(`  ⚠ CHECK ${r.title}  (${tableCount} table(s), only ${lists} list(s) produced)`);
    }
  }

  console.log(`\nSummary: ${ok} converted to bullets ✓   ${flat} need attention   ${noTable} have no table`);
  console.log(flat === 0
    ? "✓ Every article with a table will publish it as a bullet list."
    : "⚠ Some tables would not convert — paste this output and I'll fix the parser for those shapes.");
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
