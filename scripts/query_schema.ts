import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { desc } from "drizzle-orm";

const db = await getDb();

const rows = await db.select({
  id: articles.id,
  title: articles.title,
  statusBadge: articles.statusBadge,
  schemaMarkup: articles.schemaMarkup,
  bodyHtml: articles.bodyHtml,
}).from(articles).orderBy(desc(articles.id)).limit(1);

const row = rows[0];
if (!row) { console.log("No articles found"); process.exit(0); }

console.log("ID:", row.id);
console.log("Title:", row.title);
console.log("Badge:", row.statusBadge);
console.log("\n--- schemaMarkup field ---");
console.log(row.schemaMarkup ?? "(empty/null)");

// Check opening answer block in bodyHtml
const html = row.bodyHtml ?? "";
const first800 = html.slice(0, 800);
const hasStrongQuestion = /<(strong|b)[^>]*>[^<]*\?[^<]*<\/(strong|b)>/i.test(first800);
const hasPQuestion = /<p[^>]*>[^<]{5,200}\?/i.test(first800);
const hasH2Question = /<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/i.test(first800);
const hasAnyQuestion = first800.includes("?");
console.log("\n--- Opening Answer Block check (first 800 chars of bodyHtml) ---");
console.log("Has <strong>/<b> with '?':", hasStrongQuestion);
console.log("Has <p> with '?':", hasPQuestion);
console.log("Has <h2>/<h3> question:", hasH2Question);
console.log("Has any '?' in first 800 chars:", hasAnyQuestion);
console.log("\nFirst 800 chars of bodyHtml (plain text):");
console.log(first800.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
