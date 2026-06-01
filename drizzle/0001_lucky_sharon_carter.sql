CREATE TABLE `admin_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminUserId` int NOT NULL,
	`action` enum('grant_credits','override_article_status','unlock_user','reset_user','view_user_dashboard','flag_test_business','manual_publish_retry','other') NOT NULL,
	`targetUserId` int,
	`targetBusinessId` int,
	`targetArticleId` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `article_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int NOT NULL,
	`imageUrl` varchar(2048),
	`storageKey` varchar(512),
	`altText` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `article_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `article_images_articleId_unique` UNIQUE(`articleId`)
);
--> statement-breakpoint
CREATE TABLE `article_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`architectureId` int NOT NULL,
	`businessId` int NOT NULL,
	`level` enum('cornerstone','pillar','cluster') NOT NULL,
	`articleType` enum('cornerstone_guide','top_10_list','how_to','the_why','comparison','myth_busting','case_study') NOT NULL,
	`parentCornerstoneId` int,
	`parentPillarId` int,
	`urlSlug` varchar(512),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `article_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleNodeId` int NOT NULL,
	`businessId` int NOT NULL,
	`title` varchar(512),
	`bodyHtml` text,
	`bodyMarkdown` text,
	`metaTitle` varchar(120),
	`metaDescription` varchar(320),
	`focusKeyword` varchar(512),
	`urlSlug` varchar(512),
	`schemaMarkup` text,
	`faqItems` json,
	`wordCount` int,
	`internalScore` int,
	`statusBadge` enum('authority_ready','strong','needs_review'),
	`status` enum('pending_generation','generating','generated','pending_approval','approved','scheduled','published','failed') NOT NULL DEFAULT 'pending_generation',
	`generationAttempts` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`isFreeTrial` boolean NOT NULL DEFAULT false,
	`isTestArticle` boolean NOT NULL DEFAULT false,
	`approvedAt` timestamp,
	`publishedAt` timestamp,
	`scheduledPublishAt` timestamp,
	`cmsPostId` varchar(255),
	`cmsPostUrl` varchar(2048),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `articles_articleNodeId_unique` UNIQUE(`articleNodeId`)
);
--> statement-breakpoint
CREATE TABLE `blog_architectures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`packSize` int NOT NULL,
	`cornerstoneCount` int NOT NULL,
	`pillarCount` int NOT NULL,
	`clustersPerPillar` int NOT NULL DEFAULT 3,
	`totalArticleCount` int NOT NULL,
	`confirmed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `blog_architectures_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_architectures_businessId_unique` UNIQUE(`businessId`)
);
--> statement-breakpoint
CREATE TABLE `brand_voice` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`primaryArchetype` enum('professional_authority','friendly_neighbour','bold_direct','inspiring_thought_leader'),
	`secondaryArchetype` enum('professional_authority','friendly_neighbour','bold_direct','inspiring_thought_leader'),
	`namedPersona` varchar(255),
	`formalityLevel` enum('very_formal','formal','semi_formal','conversational','casual'),
	`keyPhrases` json,
	`phrasesToAvoid` json,
	`styleNotes` text,
	`finalVoiceBrief` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `brand_voice_id` PRIMARY KEY(`id`),
	CONSTRAINT `brand_voice_businessId_unique` UNIQUE(`businessId`)
);
--> statement-breakpoint
CREATE TABLE `business_audiences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`label` varchar(255) NOT NULL,
	`description` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `business_audiences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `business_competitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`websiteUrl` varchar(2048),
	`description` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `business_competitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `business_existing_content` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`title` varchar(512),
	`url` varchar(2048),
	`detectedKeyword` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_existing_content_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `business_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`pageUrl` varchar(2048),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `business_services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`websiteUrl` varchar(2048),
	`industry` varchar(255),
	`location` varchar(255),
	`serviceArea` text,
	`physicalAddress` text,
	`isPhysicalLocation` boolean NOT NULL DEFAULT false,
	`abnBusinessRegistration` varchar(64),
	`uniqueValueProposition` text,
	`keywordExclusions` text,
	`yearsInBusiness` int,
	`clientsServed` int,
	`awardsAccreditations` text,
	`primaryCtaText` varchar(255),
	`primaryCtaUrl` varchar(2048),
	`contactPageUrl` varchar(2048),
	`bookingsPageUrl` varchar(2048),
	`testimonialsPageUrl` varchar(2048),
	`shopUrl` varchar(2048),
	`otherInternalLinks` json,
	`cmsPlatform` enum('wordpress','wix','shopify','webflow','squarespace','ghost'),
	`wordpressSeoPlugin` enum('yoast','rankmath','aioseo','none'),
	`scrapeStatus` enum('pending','running','complete','failed') NOT NULL DEFAULT 'pending',
	`lastScrapedAt` timestamp,
	`scrapeCache` json,
	`currentStage` int NOT NULL DEFAULT 1,
	`isTestBusiness` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`delta` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`reason` enum('pack_purchase','top_up','article_generated','article_regenerated','free_trial','admin_grant','refund') NOT NULL,
	`articleId` int,
	`stripePaymentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`balance` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credits_id` PRIMARY KEY(`id`),
	CONSTRAINT `credits_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`platform` enum('wordpress','wix','shopify','webflow','squarespace','ghost','zapier') NOT NULL,
	`status` enum('not_connected','connected','failed') NOT NULL DEFAULT 'not_connected',
	`credentialsEncrypted` text,
	`lastTestedAt` timestamp,
	`lastTestError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleNodeId` int NOT NULL,
	`businessId` int NOT NULL,
	`primaryKeyword` varchar(512) NOT NULL,
	`monthlySearchVolume` int,
	`competitionLevel` enum('high','medium'),
	`secondaryKeywords` json,
	`paaQuestions` json,
	`approvedPaaQuestion` text,
	`keywordApproved` boolean NOT NULL DEFAULT false,
	`paaApproved` boolean NOT NULL DEFAULT false,
	`cannibalizationWarning` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`),
	CONSTRAINT `keywords_articleNodeId_unique` UNIQUE(`articleNodeId`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`businessId` int NOT NULL,
	`cadence` enum('every_day','every_2_days','every_3_days','once_per_week','twice_per_week'),
	`startDate` timestamp,
	`confirmed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `schedules_businessId_unique` UNIQUE(`businessId`)
);
--> statement-breakpoint
CREATE TABLE `stripe_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripePaymentIntentId` varchar(255),
	`stripeCustomerId` varchar(255),
	`status` enum('pending','succeeded','failed','refunded') NOT NULL,
	`amountCents` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'aud',
	`product` enum('pack_20','pack_50','credit_top_up') NOT NULL,
	`creditsAllocated` int NOT NULL DEFAULT 0,
	`stripeEventId` varchar(255),
	`stripeEventPayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stripe_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_payments_stripePaymentIntentId_unique` UNIQUE(`stripePaymentIntentId`),
	CONSTRAINT `stripe_payments_stripeEventId_unique` UNIQUE(`stripeEventId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `tier` enum('standard','multi_business','agency') DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingComplete` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerificationToken` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerificationExpiry` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordResetToken` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordResetExpiry` timestamp;