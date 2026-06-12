import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const conn = await mysql.createConnection(url);

// Check what FKs reference blog_architectures
const [fks] = await conn.execute(`
  SELECT 
    TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
    REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE REFERENCED_TABLE_NAME = 'blog_architectures'
  AND TABLE_SCHEMA = DATABASE()
`);
console.log('FKs referencing blog_architectures:', JSON.stringify(fks, null, 2));

// Check all indexes on blog_architectures
const [indexes] = await conn.execute(`SHOW INDEX FROM blog_architectures`);
console.log('Indexes on blog_architectures:', indexes.map(i => `${i.Key_name}: ${i.Column_name} (unique=${i.Non_unique===0})`));

await conn.end();
