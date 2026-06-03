CREATE TABLE `keyword_seeds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_seeds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `keyword_seeds` ADD CONSTRAINT `keyword_seeds_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;