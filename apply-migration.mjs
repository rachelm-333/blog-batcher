import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

// Load env
config({ path: '.env' });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const conn = await mysql.createConnection(url);

const statements = [
  "ALTER TABLE `blog_architectures` DROP INDEX `blog_architectures_businessId_unique`",
  "ALTER TABLE `schedules` DROP INDEX `schedules_businessId_unique`",
  "ALTER TABLE `article_nodes` ADD `batchNumber` int DEFAULT 1 NOT NULL",
  "ALTER TABLE `blog_architectures` ADD `batchNumber` int DEFAULT 1 NOT NULL",
  "ALTER TABLE `businesses` ADD `activeBatch` int DEFAULT 1 NOT NULL",
  "ALTER TABLE `keywords` ADD `batchNumber` int DEFAULT 1 NOT NULL",
  "ALTER TABLE `schedules` ADD `batchNumber` int DEFAULT 1 NOT NULL",
];

for (const sql of statements) {
  try {
    await conn.execute(sql);
    console.log('✓', sql.substring(0, 60));
  } catch (err) {
    if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.message.includes('Duplicate column')) {
      console.log('⚠ Already applied (skipping):', sql.substring(0, 60));
    } else {
      console.error('✗ Failed:', err.message, '\n  SQL:', sql);
    }
  }
}

await conn.end();
console.log('\nMigration complete.');
