import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const conn = await mysql.createConnection(url);

try {
  // Step 1: Drop the FK on article_nodes that references blog_architectures.id
  console.log('Dropping article_nodes FK...');
  await conn.execute('ALTER TABLE `article_nodes` DROP FOREIGN KEY `article_nodes_architectureId_blog_architectures_id_fk`');
  console.log('FK dropped.');

  // Step 2: Drop the old unique(businessId) constraint
  console.log('Dropping old unique(businessId) constraint...');
  await conn.execute('ALTER TABLE `blog_architectures` DROP INDEX `blog_architectures_businessId_unique`');
  console.log('Old constraint dropped.');

  // Step 3: Re-add the FK
  console.log('Re-adding article_nodes FK...');
  await conn.execute('ALTER TABLE `article_nodes` ADD CONSTRAINT `article_nodes_architectureId_blog_architectures_id_fk` FOREIGN KEY (`architectureId`) REFERENCES `blog_architectures` (`id`)');
  console.log('FK re-added.');

  // Step 4: Verify indexes
  const [indexes] = await conn.execute('SHOW INDEX FROM blog_architectures');
  console.log('Final indexes:', indexes.map(i => `${i.Key_name}: ${i.Column_name} (unique=${i.Non_unique===0})`));

} catch (e) {
  console.error('Error:', e.message);
} finally {
  await conn.end();
}
console.log('Done.');
