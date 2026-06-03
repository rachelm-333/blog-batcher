ALTER TABLE `businesses` MODIFY COLUMN `cmsPlatform` enum('wordpress','wix','shopify','webflow','squarespace','ghost','zapier','download');--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `stripeCheckoutSessionId` varchar(255);--> statement-breakpoint
ALTER TABLE `stripe_payments` ADD `receiptUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD `stripeCustomerId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `freeTrialUsed` boolean DEFAULT false NOT NULL;