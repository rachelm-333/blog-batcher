CREATE TABLE `selected_keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`msv` int,
	`competitionLevel` varchar(16),
	`cpc` decimal(10,2),
	`seedKeyword` varchar(255),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `selected_keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `selected_keywords` ADD CONSTRAINT `selected_keywords_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;