CREATE TABLE `api_cost_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`model` varchar(128) NOT NULL,
	`inputTokens` int NOT NULL DEFAULT 0,
	`outputTokens` int NOT NULL DEFAULT 0,
	`estimatedCostUsd` decimal(10,6) NOT NULL DEFAULT '0',
	`feature` enum('article_generation','keyword_research','business_scrape','seo_analysis','other') NOT NULL DEFAULT 'other',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_cost_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_error_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`route` varchar(255),
	`errorMessage` text NOT NULL,
	`stackTrace` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_error_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_log` MODIFY COLUMN `action` enum('grant_credits','remove_credits','override_article_status','unlock_user','reset_user','view_user_dashboard','flag_test_business','manual_publish_retry','suspend_user','unsuspend_user','add_credits','impersonate_user','other') NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isSuspended` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `api_cost_log` ADD CONSTRAINT `api_cost_log_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_error_log` ADD CONSTRAINT `app_error_log_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;