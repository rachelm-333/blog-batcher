import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const conn = await mysql.createConnection(url);

try {
  console.log('Dropping old unique constraint...');
  await conn.execute('ALTER TABLE `blog_architectures` DROP INDEX `blog_architectures_businessId_unique`');
  console.log('Old constraint dropped.');
} catch (e) {
  if (e.message && e.message.includes("Can't DROP")) {
    console.log('Old constraint already dropped or does not exist, continuing...');
  } else {
    console.error('Error dropping constraint:', e.message);
  }
}

try {
  console.log('Adding composite unique constraint...');
  await conn.execute('ALTER TABLE `blog_architectures` ADD UNIQUE INDEX `blog_architectures_business_batch_unique` (`businessId`, `batchNumber`)');
  console.log('Composite unique constraint added.');
} catch (e) {
  if (e.message && e.message.includes('Duplicate key name')) {
    console.log('Composite constraint already exists, skipping...');
  } else {
    console.error('Error adding constraint:', e.message);
  }
}

await conn.end();
console.log('Migration complete.');
