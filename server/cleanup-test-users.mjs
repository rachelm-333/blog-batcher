/**
 * Cleanup script: delete leftover test users from failed verification runs
 */
import { getDb } from "./db.ts";
import { users, credits, adminLog, businesses, apiCostLog, appErrorLog, notifications, creditTransactions } from "../drizzle/schema.ts";
import { inArray, eq } from "drizzle-orm";

const TEST_EMAILS = [
  'suspend-test@example.com',
  'credit-test@example.com',
  'impersonate-test@example.com',
];

async function run() {
  const db = await getDb();
  
  // Get the IDs
  const rows = await db.select({ id: users.id, email: users.email }).from(users)
    .where(inArray(users.email, TEST_EMAILS));
  
  if (rows.length === 0) {
    console.log('No test users found — nothing to clean up');
    return;
  }
  
  console.log(`Found ${rows.length} test users:`, rows.map(r => `${r.id}:${r.email}`).join(', '));
  
  const ids = rows.map(r => r.id);
  
  // Check what FK constraints exist
  const fkResult = await db.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME 
     FROM information_schema.KEY_COLUMN_USAGE 
     WHERE REFERENCED_TABLE_NAME = 'users' 
     AND TABLE_SCHEMA = DATABASE()`
  );
  console.log('FK constraints referencing users:', JSON.stringify(fkResult[0], null, 2));
  
  // Delete in FK order - try all possible tables
  const tables = [
    { table: credits, col: credits.userId, name: 'credits' },
    { table: creditTransactions, col: creditTransactions.userId, name: 'creditTransactions' },
    { table: adminLog, col: adminLog.targetUserId, name: 'adminLog (targetUserId)' },
    { table: adminLog, col: adminLog.adminUserId, name: 'adminLog (adminUserId)' },
    { table: businesses, col: businesses.userId, name: 'businesses' },
    { table: apiCostLog, col: apiCostLog.userId, name: 'apiCostLog' },
    { table: appErrorLog, col: appErrorLog.userId, name: 'appErrorLog' },
    { table: notifications, col: notifications.userId, name: 'notifications' },
  ];
  
  for (const { table, col, name } of tables) {
    try {
      await db.delete(table).where(inArray(col, ids));
      console.log(`Deleted from ${name}`);
    } catch(e) {
      console.log(`${name}: ${e.message}`);
    }
  }
  
  // Now delete users
  try {
    await db.delete(users).where(inArray(users.id, ids));
    console.log('Deleted test users:', ids);
  } catch(e) {
    console.error('Failed to delete users:', e.message);
    // Try raw SQL
    for (const id of ids) {
      try {
        await db.execute(`DELETE FROM users WHERE id = ${id}`);
        console.log(`Deleted user ${id} via raw SQL`);
      } catch(e2) {
        console.error(`Failed to delete user ${id}:`, e2.message);
      }
    }
  }
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
