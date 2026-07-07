/**
 * setCmsUrlsManual.ts — one-off: set the real Wix URLs for the two test posts
 * directly, matched by title. Use only to prove the linking system end-to-end
 * while the Wix API read-permission is sorted out.
 *
 * Run on Manus:  node --import tsx scripts/setCmsUrlsManual.ts
 */
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles } from "../drizzle/schema";

// title substring (lowercase) → real live Wix URL
const MAP: Array<{ match: string; url: string }> = [
  { match: "complete branding strategies", url: "https://www.skrt.com.au/post/branding-strategies" },
  { match: "brand positioning", url: "https://www.skrt.com.au/post/brand-positioning-1" },
];

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("✗ No DATABASE_URL here. Run on Manus.");
    process.exit(1);
  }

  const rows = await db
    .select({ id: articles.id, title: articles.title, status: articles.status, cmsPostUrl: articles.cmsPostUrl })
    .from(articles)
    .where(eq(articles.status, "published"));

  let updated = 0;
  for (const r of rows) {
    const t = (r.title ?? "").toLowerCase();
    const hit = MAP.find((m) => t.includes(m.match));
    if (hit) {
      await db.update(articles).set({ cmsPostUrl: hit.url }).where(eq(articles.id, r.id));
      console.log(`✓ ${r.title} → ${hit.url}`);
      updated++;
    } else {
      console.log(`– ${r.title} (no mapping)`);
    }
  }
  console.log(`\nDone. Set ${updated} URL(s).\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
