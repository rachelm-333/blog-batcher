/**
 * probeWixRead.ts — make the raw Wix "read" calls and print the HTTP status +
 * a short body snippet for each, so we can see exactly why the app can't read a
 * post's URL back (403 = permission, 404 = wrong id/endpoint, 200 = parse issue).
 *
 * Read-only. Run on Manus:  node --import tsx scripts/probeWixRead.ts
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { articles, integrations } from "../drizzle/schema";
import { decryptCredentials } from "../server/cmsPublisher";

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("✗ No DATABASE_URL here. Run on Manus.");
    process.exit(1);
  }

  const [post] = await db
    .select({
      id: articles.id,
      businessId: articles.businessId,
      title: articles.title,
      urlSlug: articles.urlSlug,
      cmsPostId: articles.cmsPostId,
    })
    .from(articles)
    .where(eq(articles.status, "published"))
    .limit(1);

  if (!post) {
    console.log("No published post to probe.");
    process.exit(0);
  }

  const [integ] = await db
    .select({ credentialsEncrypted: integrations.credentialsEncrypted })
    .from(integrations)
    .where(and(eq(integrations.businessId, post.businessId), eq(integrations.platform, "wix")))
    .limit(1);
  const creds = integ?.credentialsEncrypted ? decryptCredentials(integ.credentialsEncrypted) : null;
  if (!creds) {
    console.log("No Wix credentials found for business", post.businessId);
    process.exit(0);
  }

  const headers: Record<string, string> = {
    Authorization: creds.apiKey ?? "",
    "wix-site-id": creds.siteId ?? "",
    "Content-Type": "application/json",
    "User-Agent": "BlogBatcher/1.0",
  };

  console.log(`\nProbing Wix reads for: "${post.title}"`);
  console.log(`  stored cmsPostId: ${post.cmsPostId ?? "none"}`);
  console.log(`  our slug:         ${post.urlSlug ?? "none"}`);
  console.log(`  apiKey present:   ${!!creds.apiKey}   siteId present: ${!!creds.siteId}\n`);

  async function probe(label: string, url: string) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      console.log(`▸ ${label}`);
      console.log(`    ${url}`);
      console.log(`    HTTP ${res.status}`);
      console.log(`    body: ${text.slice(0, 400).replace(/\s+/g, " ")}\n`);
    } catch (err) {
      console.log(`▸ ${label} — ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  if (post.cmsPostId) {
    await probe("GET post by stored id", `https://www.wixapis.com/blog/v3/posts/${post.cmsPostId}`);
    // Print the EXACT shape of the url field so we can fix parsing.
    try {
      const res = await fetch(`https://www.wixapis.com/blog/v3/posts/${post.cmsPostId}`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { post?: Record<string, unknown> };
        const p = data.post ?? {};
        console.log(`>>> url FIELD SHAPE: ${JSON.stringify(p.url)}`);
        console.log(`>>> post top-level keys: ${Object.keys(p).join(", ")}\n`);
      }
    } catch { /* ignore */ }
  }
  if (post.urlSlug) {
    const clean = post.urlSlug.replace(/^\/+/, "").replace(/\/+$/, "");
    await probe("GET post by slug", `https://www.wixapis.com/blog/v3/posts/slugs/${encodeURIComponent(clean)}`);
  }
  await probe("LIST published posts", `https://www.wixapis.com/blog/v3/posts?paging.limit=100`);

  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Failed:", err);
  process.exit(1);
});
