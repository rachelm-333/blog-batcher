ALTER TABLE `blog_architectures` DROP INDEX `blog_architectures_businessId_unique`;--> statement-breakpoint
ALTER TABLE `schedules` DROP INDEX `schedules_businessId_unique`;--> statement-breakpoint
ALTER TABLE `article_nodes` ADD `batchNumber` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `blog_architectures` ADD `batchNumber` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `activeBatch` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `keywords` ADD `batchNumber` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `schedules` ADD `batchNumber` int DEFAULT 1 NOT NULL;