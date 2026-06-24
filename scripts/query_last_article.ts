import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";
import { desc } from "drizzle-orm";

const db = await getDb();

const rows = await db.select({
  id: articles.id,
  title: articles.title,
  statusBadge: articles.statusBadge,
  bodyHtml: articles.bodyHtml,
}).from(articles).orderBy(desc(articles.id)).limit(1);

const row = rows[0];
if (!row) {
  console.log("No articles found");
  process.exit(0);
}

console.log("ID:", row.id);
console.log("Title:", row.title);
console.log("Badge:", row.statusBadge);

const html = row.bodyHtml || "";
const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

console.log("\n--- FULL PLAIN TEXT ---\n");
console.log(plain);
