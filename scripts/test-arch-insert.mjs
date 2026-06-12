import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const conn = await mysql.createConnection(url);

// Check current state
const [rows] = await conn.execute(
  'SELECT id, businessId, batchNumber, packSize, cornerstoneCount, confirmed FROM blog_architectures WHERE businessId = 720001 ORDER BY id'
);
console.log('Current blog_architectures rows for SafeWize:', rows);

// Check businesses activeBatch
const [biz] = await conn.execute(
  'SELECT id, name, activeBatch, currentStage FROM businesses WHERE id = 720001'
);
console.log('SafeWize business:', biz);

await conn.end();
