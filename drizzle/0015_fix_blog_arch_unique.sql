-- Drop the old single-column unique constraint that prevented multi-batch support
ALTER TABLE `blog_architectures` DROP INDEX `blog_architectures_businessId_unique`;

-- Add a composite unique constraint: one architecture row per (business, batch)
ALTER TABLE `blog_architectures` ADD UNIQUE INDEX `blog_architectures_business_batch_unique` (`businessId`, `batchNumber`);
