/**
 * Diagnostic script: find article nodes and architecture for all businesses
 * Run with: node scripts/diagnose-nodes.mjs
 */
import { createConnection } from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await createConnection(url);

console.log("\n=== BUSINESSES ===");
const [bizRows] = await conn.execute(
  "SELECT id, name, activeBatch, currentStage FROM businesses ORDER BY id DESC LIMIT 10"
);
console.table(bizRows);

console.log("\n=== BLOG_ARCHITECTURES (most recent 10) ===");
const [archRows] = await conn.execute(
  "SELECT id, businessId, batchNumber, cornerstoneCount, pillarCount, clustersPerPillar, totalArticleCount, confirmed, createdAt FROM blog_architectures ORDER BY createdAt DESC LIMIT 10"
);
console.table(archRows);

console.log("\n=== ARTICLE_NODES (most recent 20) ===");
const [nodeRows] = await conn.execute(
  "SELECT id, businessId, batchNumber, architectureId, level, articleType, sortOrder, createdAt FROM article_nodes ORDER BY createdAt DESC LIMIT 20"
);
console.table(nodeRows);

console.log("\n=== KEYWORDS (most recent 10) ===");
const [kwRows] = await conn.execute(
  "SELECT id, businessId, batchNumber, articleNodeId, primaryKeyword FROM keywords ORDER BY id DESC LIMIT 10"
);
console.table(kwRows);

await conn.end();
