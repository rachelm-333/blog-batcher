CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`businessId` int,
	`articleId` int,
	`type` enum('publish_success','publish_failed','retry_failed','schedule_cancelled','schedule_rescheduled') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`read` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `publish_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int NOT NULL,
	`businessId` int NOT NULL,
	`action` enum('scheduled_publish_attempted','scheduled_publish_succeeded','scheduled_publish_failed','retry_attempted','retry_succeeded','retry_failed','schedule_cancelled','schedule_rescheduled') NOT NULL,
	`result` enum('success','failure','cancelled','rescheduled') NOT NULL,
	`errorMessage` text,
	`attemptNumber` int NOT NULL DEFAULT 1,
	`triggeredBy` enum('user','heartbeat') NOT NULL DEFAULT 'heartbeat',
	`newScheduledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `publish_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `articles` ADD `scheduleCronTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `articles` ADD `retryScheduledAt` timestamp;--> statement-breakpoint
ALTER TABLE `articles` ADD `publishRetryCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_articleId_articles_id_fk` FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_audit_log` ADD CONSTRAINT `publish_audit_log_articleId_articles_id_fk` FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `publish_audit_log` ADD CONSTRAINT `publish_audit_log_businessId_businesses_id_fk` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE no action ON UPDATE no action;