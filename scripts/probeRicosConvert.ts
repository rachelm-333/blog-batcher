/**
 * probeRicosConvert.ts — Tests whether the Wix Ricos "convert to ricos" API works
 * with the stored Wix API key, using a REAL <table> pulled from an article body.
 * Tells us definitively whether the publish-time table fix can succeed, and prints
 * the valid TABLE node schema Wix returns.
 * Read-only. Run on Manus:  node --import tsx scripts/probeRicosConvert.ts
 */
import { getDb } from "../server/db";
import { articles, integrations } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { decryptCredentials } from "../server/cmsPublisher";

async function main() {
  const db = await getDb();
  if (!db) { console.error("✗ No DATABASE_URL here."); process.exit(1); }

  // Grab a Wix integration (first business with wix creds)
  const [integ] = await db
    .select({ businessId: integrations.businessId, enc: integrations.credentialsEncrypted })
    .from(integrations)
    .where(eq(integrations.platform, "wix"));
  if (!integ?.enc) { console.error("✗ No Wix integration found."); process.exit(1); }
  const creds = decryptCredentials(integ.enc);
  const apiKey = creds?.apiKey ?? "";
  console.log(`Wix apiKey present: ${apiKey ? "yes (" + apiKey.length + " chars)" : "NO"}`);

  // Find an article body that has a <table>
  const rows = await db.select({ title: articles.title, bodyHtml: articles.bodyHtml }).from(articles);
  const withTable = rows.find((r) => /<table\b/i.test(r.bodyHtml ?? ""));
  if (!withTable) { console.error("✗ No article body with a <table> found."); process.exit(1); }
  const tableHtml = (withTable.bodyHtml ?? "").match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  console.log(`\nUsing table from: ${withTable.title}`);
  console.log(`Table HTML (300 chars): ${tableHtml.slice(0, 300).replace(/\n/g, " ")}\n`);

  // Call the Wix Ricos convert API
  console.log("→ POST https://www.wixapis.com/ricos/v1/ricos-document/convert/to-ricos");
  const resp = await fetch("https://www.wixapis.com/ricos/v1/ricos-document/convert/to-ricos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ html: tableHtml, options: { plugins: ["table"] } }),
  });
  const text = await resp.text();
  console.log(`HTTP ${resp.status}`);
  if (!resp.ok) {
    console.log(`RESPONSE (800 chars): ${text.slice(0, 800)}`);
    console.log("\n⇒ The convert API is NOT usable with this key (likely a missing scope). We'll fix tables locally instead.");
    process.exit(0);
  }
  const data = JSON.parse(text) as { document?: { nodes?: unknown[] } };
  const findTable = (ns: any[]): any => {
    for (const n of ns) { if (n.type === "TABLE") return n; if (n.nodes) { const r = findTable(n.nodes); if (r) return r; } }
    return null;
  };
  const tableNode = findTable(data.document?.nodes ?? []);
  console.log("\n✓ Convert API WORKS. Wix-valid TABLE node schema:");
  console.log(JSON.stringify(tableNode, null, 2).slice(0, 2500));
  process.exit(0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
