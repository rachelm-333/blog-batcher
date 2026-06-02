/**
 * Test script to diagnose the byDay query failure in listApiCostLog
 */
import { getDb } from "./db.ts";
import { apiCostLog } from "../drizzle/schema.ts";
import { gte, and, sql } from "drizzle-orm";

async function run() {
  const db = await getDb();
  
  // Test 1: Simple query with no where clause
  console.log("Test 1: Simple byDay query without WHERE");
  try {
    const r1 = await db.select({
      day: sql`date(${apiCostLog.createdAt})`,
      count: sql`count(*)`,
    }).from(apiCostLog)
      .groupBy(sql`date(${apiCostLog.createdAt})`);
    console.log("  PASS - rows:", r1.length);
  } catch(e) {
    console.log("  FAIL:", e.message);
  }
  
  // Test 2: With gte using a Date object (with milliseconds stripped)
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const since = new Date(Math.floor(sinceMs / 1000) * 1000);
  console.log("\nTest 2: byDay with gte(Date) - since:", since.toISOString());
  try {
    const r2 = await db.select({
      day: sql`date(${apiCostLog.createdAt})`,
      count: sql`count(*)`,
    }).from(apiCostLog)
      .where(gte(apiCostLog.createdAt, since))
      .groupBy(sql`date(${apiCostLog.createdAt})`);
    console.log("  PASS - rows:", r2.length);
  } catch(e) {
    console.log("  FAIL:", e.message);
  }
  
  // Test 3: With gte using a string date
  const sinceStr = since.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  console.log("\nTest 3: byDay with gte(string) - since:", sinceStr);
  try {
    const r3 = await db.select({
      day: sql`date(${apiCostLog.createdAt})`,
      count: sql`count(*)`,
    }).from(apiCostLog)
      .where(sql`${apiCostLog.createdAt} >= ${sinceStr}`)
      .groupBy(sql`date(${apiCostLog.createdAt})`);
    console.log("  PASS - rows:", r3.length);
  } catch(e) {
    console.log("  FAIL:", e.message);
  }
  
  // Test 4: Raw SQL
  console.log("\nTest 4: Raw SQL query");
  try {
    const r4 = await db.execute(`SELECT date(createdAt) as day, count(*) as cnt FROM api_cost_log WHERE createdAt >= '${sinceStr}' GROUP BY date(createdAt)`);
    console.log("  PASS - rows:", r4[0].length);
  } catch(e) {
    console.log("  FAIL:", e.message);
  }
  
  // Test 5: Full listApiCostLog query
  console.log("\nTest 5: Full listApiCostLog query");
  try {
    const conditions = [gte(apiCostLog.createdAt, since)];
    const byDay = await db
      .select({
        day: sql`date(${apiCostLog.createdAt})`,
        totalCostUsd: sql`sum(${apiCostLog.estimatedCostUsd})`,
        callCount: sql`count(*)`,
        totalTokens: sql`sum(${apiCostLog.inputTokens} + ${apiCostLog.outputTokens})`,
      })
      .from(apiCostLog)
      .where(and(...conditions))
      .groupBy(sql`date(${apiCostLog.createdAt})`)
      .orderBy(sql`date(${apiCostLog.createdAt}) desc`);
    console.log("  PASS - byDay rows:", byDay.length);
  } catch(e) {
    console.log("  FAIL:", e.message);
  }
}

run().catch(e => {
  console.error("Script error:", e.message);
  process.exit(1);
});
