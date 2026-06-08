import {
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// USERS
// Core user table extended with Blog Batcher-specific fields.
// ---------------------------------------------------------------------------
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** Platform role: standard user or operator/admin. */
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** User tier determines multi-business and agency capabilities. */
  tier: mysqlEnum("tier", ["standard", "multi_business", "agency"]).default("standard").notNull(),
  /** True once the user has completed the first-time onboarding welcome screen. */
  onboardingComplete: boolean("onboardingComplete").default(false).notNull(),
  /** True if the user's email has been verified. */
  emailVerified: boolean("emailVerified").default(false).notNull(),
  /** Hashed password for email+password auth (null for OAuth-only users). */
  passwordHash: text("passwordHash"),
  /** Token sent in the verification email. Cleared after verification. */
  emailVerificationToken: varchar("emailVerificationToken", { length: 128 }),
  /** Expiry for the email verification token. */
  emailVerificationExpiry: timestamp("emailVerificationExpiry"),
  /** Token sent in the password reset email. Cleared after use. */
  passwordResetToken: varchar("passwordResetToken", { length: 128 }),
  /** Expiry for the password reset token. */
  passwordResetExpiry: timestamp("passwordResetExpiry"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  /** True if the user has been suspended by an admin. Suspended users cannot log in. */
  isSuspended: boolean("isSuspended").default(false).notNull(),
  /** Stripe Customer ID for billing. Set on first checkout. */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  /** True once the user has consumed their one free trial article. */
  freeTrialUsed: boolean("freeTrialUsed").default(false).notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  businesses: many(businesses),
  credits: one(credits, { fields: [users.id], references: [credits.userId] }),
  creditTransactions: many(creditTransactions),
  stripePayments: many(stripePayments),
  adminLogsAsAdmin: many(adminLog, { relationName: "adminUser" }),
  adminLogsAsTarget: many(adminLog, { relationName: "targetUser" }),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// BUSINESSES
// Each user can own multiple businesses. Every business has a completely
// isolated workspace: profile, keywords, articles, integrations, schedule.
// ---------------------------------------------------------------------------
export const businesses = mysqlTable("businesses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  websiteUrl: varchar("websiteUrl", { length: 2048 }),
  industry: varchar("industry", { length: 255 }),
  /** City/State, 'Nationwide', or 'Online Only'. */
  location: varchar("location", { length: 255 }),
  serviceArea: text("serviceArea"),
  physicalAddress: text("physicalAddress"),
  /** Flag: does this business have a physical location? */
  isPhysicalLocation: boolean("isPhysicalLocation").default(false).notNull(),
  abnBusinessRegistration: varchar("abnBusinessRegistration", { length: 64 }),
  uniqueValueProposition: text("uniqueValueProposition"),
  /** Comma-separated topics to exclude from keyword research. */
  keywordExclusions: text("keywordExclusions"),
  /** Years the business has been operating — for E-E-A-T. */
  yearsInBusiness: int("yearsInBusiness"),
  /** Number of clients served — for E-E-A-T. */
  clientsServed: int("clientsServed"),
  /** Awards, certifications, accreditations — for E-E-A-T. */
  awardsAccreditations: text("awardsAccreditations"),
  /** Primary CTA button text, e.g. 'Book a free consultation'. */
  primaryCtaText: varchar("primaryCtaText", { length: 255 }),
  primaryCtaUrl: varchar("primaryCtaUrl", { length: 2048 }),
  /** Contact page URL. */
  contactPageUrl: varchar("contactPageUrl", { length: 2048 }),
  /** Bookings / appointments page URL. */
  bookingsPageUrl: varchar("bookingsPageUrl", { length: 2048 }),
  /** Testimonials / reviews page URL. */
  testimonialsPageUrl: varchar("testimonialsPageUrl", { length: 2048 }),
  /** Shop / e-commerce URL. */
  shopUrl: varchar("shopUrl", { length: 2048 }),
  /** Any other key internal pages stored as JSON array of {label, url}. */
  otherInternalLinks: json("otherInternalLinks"),
  /** CMS platform the business publishes to. */
  cmsPlatform: mysqlEnum("cmsPlatform", [
    "wordpress",
    "wix",
    "shopify",
    "webflow",
    "squarespace",
    "ghost",
    "zapier",
    "download",
  ]),
  /** WordPress SEO plugin selection. Only relevant when cmsPlatform = 'wordpress'. */
  wordpressSeoPlugin: mysqlEnum("wordpressSeoPlugin", [
    "yoast",
    "rankmath",
    "aioseo",
    "none",
  ]),
  /** Scrape status for the last website scrape attempt. */
  scrapeStatus: mysqlEnum("scrapeStatus", [
    "pending",
    "running",
    "complete",
    "failed",
  ]).default("pending").notNull(),
  /** Timestamp of the last successful scrape. */
  lastScrapedAt: timestamp("lastScrapedAt"),
  /** Raw scrape result cached as JSON — avoids re-scraping unless user clicks Re-scan. */
  scrapeCache: json("scrapeCache"),
  /** Stage the user is currently up to for this business (1–5). */
  currentStage: int("currentStage").default(1).notNull(),
  /** True if this business is a test business created by admin (excluded from billing). */
  isTestBusiness: boolean("isTestBusiness").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  user: one(users, { fields: [businesses.userId], references: [users.id] }),
  audiences: many(businessAudiences),
  services: many(businessServices),
  competitors: many(businessCompetitors),
  existingContent: many(businessExistingContent),
  brandVoice: one(brandVoice, { fields: [businesses.id], references: [brandVoice.businessId] }),
  architecture: one(blogArchitectures, { fields: [businesses.id], references: [blogArchitectures.businessId] }),
  articleNodes: many(articleNodes),
  keywords: many(keywords),
  articles: many(articles),
  schedule: one(schedules, { fields: [businesses.id], references: [schedules.businessId] }),
  integrations: many(integrations),
}));

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = typeof businesses.$inferInsert;

// ---------------------------------------------------------------------------
// BUSINESS AUDIENCES
// Multiple target audience groups per business.
// ---------------------------------------------------------------------------
export const businessAudiences = mysqlTable("business_audiences", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** Short label for the audience group, e.g. 'Small Business Owners'. */
  label: varchar("label", { length: 255 }).notNull(),
  /** Description of what this audience searches for and why. */
  description: text("description"),
  /** Display order. */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const businessAudiencesRelations = relations(businessAudiences, ({ one }) => ({
  business: one(businesses, { fields: [businessAudiences.businessId], references: [businesses.id] }),
}));

export type BusinessAudience = typeof businessAudiences.$inferSelect;
export type InsertBusinessAudience = typeof businessAudiences.$inferInsert;

// ---------------------------------------------------------------------------
// BUSINESS SERVICES
// Services and products offered by the business. Used for CTA matching.
// ---------------------------------------------------------------------------
export const businessServices = mysqlTable("business_services", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  name: varchar("name", { length: 255 }).notNull(),
  /** URL to the specific service/product page on the business website. */
  pageUrl: varchar("pageUrl", { length: 2048 }),
  /** Display order. */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const businessServicesRelations = relations(businessServices, ({ one }) => ({
  business: one(businesses, { fields: [businessServices.businessId], references: [businesses.id] }),
}));

export type BusinessService = typeof businessServices.$inferSelect;
export type InsertBusinessService = typeof businessServices.$inferInsert;

// ---------------------------------------------------------------------------
// BUSINESS COMPETITORS
// Optional competitor research (max 3 per business).
// ---------------------------------------------------------------------------
export const businessCompetitors = mysqlTable("business_competitors", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  name: varchar("name", { length: 255 }).notNull(),
  websiteUrl: varchar("websiteUrl", { length: 2048 }),
  description: text("description"),
  /** Display order. */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const businessCompetitorsRelations = relations(businessCompetitors, ({ one }) => ({
  business: one(businesses, { fields: [businessCompetitors.businessId], references: [businesses.id] }),
}));

export type BusinessCompetitor = typeof businessCompetitors.$inferSelect;
export type InsertBusinessCompetitor = typeof businessCompetitors.$inferInsert;

// ---------------------------------------------------------------------------
// BUSINESS EXISTING CONTENT
// Existing blog posts scraped from the business website.
// Used to prevent duplicate or cannibalising content in Stage 3.
// ---------------------------------------------------------------------------
export const businessExistingContent = mysqlTable("business_existing_content", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  title: varchar("title", { length: 512 }),
  url: varchar("url", { length: 2048 }),
  /** Primary topic or keyword detected in the existing post. */
  detectedKeyword: varchar("detectedKeyword", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const businessExistingContentRelations = relations(businessExistingContent, ({ one }) => ({
  business: one(businesses, { fields: [businessExistingContent.businessId], references: [businesses.id] }),
}));

export type BusinessExistingContent = typeof businessExistingContent.$inferSelect;
export type InsertBusinessExistingContent = typeof businessExistingContent.$inferInsert;

// ---------------------------------------------------------------------------
// BRAND VOICE
// One brand voice record per business. Built from three sources:
// preset archetype, named persona, and AI-extracted voice.
// ---------------------------------------------------------------------------
export const brandVoice = mysqlTable("brand_voice", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().unique().references(() => businesses.id),
  /** Primary voice archetype selected by the user. */
  primaryArchetype: mysqlEnum("primaryArchetype", [
    "professional_authority",
    "friendly_neighbour",
    "bold_direct",
    "inspiring_thought_leader",
  ]),
  /** Optional secondary archetype to blend. */
  secondaryArchetype: mysqlEnum("secondaryArchetype", [
    "professional_authority",
    "friendly_neighbour",
    "bold_direct",
    "inspiring_thought_leader",
  ]),
  /** Optional named persona, e.g. 'Simon Sinek', 'Alex Hormozi'. */
  namedPersona: varchar("namedPersona", { length: 255 }),
  /** AI-extracted formality level from website scrape. */
  formalityLevel: mysqlEnum("formalityLevel", [
    "very_formal",
    "formal",
    "semi_formal",
    "conversational",
    "casual",
  ]),
  /** Key phrases the brand uses — stored as JSON array of strings. */
  keyPhrases: json("keyPhrases"),
  /** Phrases to avoid — stored as JSON array of strings. */
  phrasesToAvoid: json("phrasesToAvoid"),
  /** Style notes extracted from scrape, e.g. 'Use short sentences.' */
  styleNotes: text("styleNotes"),
  /**
   * The compiled Final Voice Brief — the single text field sent to Claude
   * for every article generation call. User can edit directly.
   * This is the most important field in the entire profile.
   */
  finalVoiceBrief: text("finalVoiceBrief"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const brandVoiceRelations = relations(brandVoice, ({ one }) => ({
  business: one(businesses, { fields: [brandVoice.businessId], references: [businesses.id] }),
}));

export type BrandVoice = typeof brandVoice.$inferSelect;
export type InsertBrandVoice = typeof brandVoice.$inferInsert;

// ---------------------------------------------------------------------------
// BLOG ARCHITECTURES
// One architecture record per business batch. Defines the Cornerstone →
// Pillar → Cluster hierarchy and pack size.
// ---------------------------------------------------------------------------
export const blogArchitectures = mysqlTable("blog_architectures", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().unique().references(() => businesses.id),
  /** Pack size: 20 or 50 articles. 0 = free trial (1 article). */
  packSize: int("packSize").notNull(),
  /** Number of cornerstone articles in this architecture. */
  cornerstoneCount: int("cornerstoneCount").notNull(),
  /** Number of pillar articles per cornerstone. */
  pillarCount: int("pillarCount").notNull(),
  /**
   * Clusters per pillar — always 3 per the non-negotiable rules.
   * Stored explicitly for clarity and validation.
   */
  clustersPerPillar: int("clustersPerPillar").default(3).notNull(),
  /** Total article count calculated from the architecture. Must equal packSize. */
  totalArticleCount: int("totalArticleCount").notNull(),
  /** Whether the user has confirmed this architecture and advanced to Stage 3. */
  confirmed: boolean("confirmed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const blogArchitecturesRelations = relations(blogArchitectures, ({ one, many }) => ({
  business: one(businesses, { fields: [blogArchitectures.businessId], references: [businesses.id] }),
  articleNodes: many(articleNodes),
}));

export type BlogArchitecture = typeof blogArchitectures.$inferSelect;
export type InsertBlogArchitecture = typeof blogArchitectures.$inferInsert;

// ---------------------------------------------------------------------------
// ARTICLE NODES
// Each slot in the architecture tree. One row per article in the batch.
// Stores hierarchy position, article type, and pre-generated URL slug.
// ---------------------------------------------------------------------------
export const articleNodes = mysqlTable("article_nodes", {
  id: int("id").autoincrement().primaryKey(),
  architectureId: int("architectureId").notNull().references(() => blogArchitectures.id),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** Level in the hierarchy. */
  level: mysqlEnum("level", ["cornerstone", "pillar", "cluster"]).notNull(),
  /** Article type as selected in Stage 2. */
  articleType: mysqlEnum("articleType", [
    "cornerstone_guide",
    "top_10_list",
    "how_to",
    "the_why",
    "comparison",
    "myth_busting",
    "specialist_post",
  ]).notNull(),
  /** Parent cornerstone node ID. Null for cornerstone nodes. */
  parentCornerstoneId: int("parentCornerstoneId"),
  /** Parent pillar node ID. Null for cornerstone and pillar nodes. */
  parentPillarId: int("parentPillarId"),
  /**
   * Pre-generated URL slug for this article. Generated before writing begins
   * so internal links can be inserted as real URLs, not placeholders.
   */
  urlSlug: varchar("urlSlug", { length: 512 }),
  /** Display order within its level and parent. */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const articleNodesRelations = relations(articleNodes, ({ one }) => ({
  architecture: one(blogArchitectures, { fields: [articleNodes.architectureId], references: [blogArchitectures.id] }),
  business: one(businesses, { fields: [articleNodes.businessId], references: [businesses.id] }),
  keyword: one(keywords, { fields: [articleNodes.id], references: [keywords.articleNodeId] }),
  article: one(articles, { fields: [articleNodes.id], references: [articles.articleNodeId] }),
  parentCornerstone: one(articleNodes, {
    fields: [articleNodes.parentCornerstoneId],
    references: [articleNodes.id],
    relationName: "cornerstoneChildren",
  }),
  parentPillar: one(articleNodes, {
    fields: [articleNodes.parentPillarId],
    references: [articleNodes.id],
    relationName: "pillarChildren",
  }),
}));

export type ArticleNode = typeof articleNodes.$inferSelect;
export type InsertArticleNode = typeof articleNodes.$inferInsert;

// ---------------------------------------------------------------------------
// KEYWORDS
// One keyword record per article node. Assigned in Stage 3.
// Stores primary keyword, secondary keywords, PAA questions, and approval state.
// ---------------------------------------------------------------------------
export const keywords = mysqlTable("keywords", {
  id: int("id").autoincrement().primaryKey(),
  articleNodeId: int("articleNodeId").notNull().unique().references(() => articleNodes.id),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** Primary keyword assigned to this article slot. */
  primaryKeyword: varchar("primaryKeyword", { length: 512 }).notNull(),
  /** Monthly search volume from DataForSEO. */
  monthlySearchVolume: int("monthlySearchVolume"),
  /** Competition level returned from DataForSEO. */
  competitionLevel: mysqlEnum("competitionLevel", ["high", "medium"]),
  /** Secondary/LSI keywords stored as JSON array of strings. */
  secondaryKeywords: json("secondaryKeywords"),
  /**
   * People Also Ask questions from DataForSEO stored as JSON array of strings.
   * These feed into the opening answer block and FAQ sections.
   */
  paaQuestions: json("paaQuestions"),
  /** The single PAA question approved for use in this article's opening block. */
  approvedPaaQuestion: text("approvedPaaQuestion"),
  /** Whether the user has approved this keyword assignment. */
  keywordApproved: boolean("keywordApproved").default(false).notNull(),
  /** Whether the user has approved the PAA question. */
  paaApproved: boolean("paaApproved").default(false).notNull(),
  /**
   * Cannibalization flag. Set to true if this keyword has too much semantic
   * overlap with another keyword in the same batch.
   */
  cannibalizationWarning: boolean("cannibalizationWarning").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const keywordsRelations = relations(keywords, ({ one }) => ({
  articleNode: one(articleNodes, { fields: [keywords.articleNodeId], references: [articleNodes.id] }),
  business: one(businesses, { fields: [keywords.businessId], references: [businesses.id] }),
}));

export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = typeof keywords.$inferInsert;

// ---------------------------------------------------------------------------
// ARTICLES
// The generated article content and all associated SEO metadata.
// One record per article node once generation has run.
// ---------------------------------------------------------------------------
export const articles = mysqlTable("articles", {
  id: int("id").autoincrement().primaryKey(),
  articleNodeId: int("articleNodeId").notNull().unique().references(() => articleNodes.id),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** Article title / H1. */
  title: varchar("title", { length: 512 }),
  /** Full article body as formatted HTML. */
  bodyHtml: text("bodyHtml"),
  /** Full article body as Markdown (for export). */
  bodyMarkdown: text("bodyMarkdown"),
  /** SEO meta title — max 60 characters. */
  metaTitle: varchar("metaTitle", { length: 120 }),
  /** SEO meta description — 140–160 characters. */
  metaDescription: varchar("metaDescription", { length: 320 }),
  /** Focus keyword for CMS SEO plugin fields. */
  focusKeyword: varchar("focusKeyword", { length: 512 }),
  /** URL slug — lowercase hyphenated. Pre-generated before writing. */
  urlSlug: varchar("urlSlug", { length: 512 }),
  /** Schema markup as JSON-LD string. */
  schemaMarkup: text("schemaMarkup"),
  /**
   * FAQ questions and answers stored as JSON array of {question, answer}.
   * Only populated for Cornerstone and Pillar articles.
   */
  faqItems: json("faqItems"),
  /** Actual word count of the generated article. */
  wordCount: int("wordCount"),
  /**
   * Internal numeric score (0–100). Not surfaced to the user as a number —
   * only used to determine the status badge.
   */
  internalScore: int("internalScore"),
  /**
   * Status badge shown to the user. Derived from internalScore.
   * authority_ready ≥ 90, strong ≥ 80, needs_review < 80.
   */
  statusBadge: mysqlEnum("statusBadge", [
    "authority_ready",
    "strong",
    "needs_review",
  ]),
  /**
   * Lifecycle status of the article.
   * pending_generation → generating → generated → pending_approval →
   * approved → scheduled → published → failed
   */
  status: mysqlEnum("status", [
    "pending_generation",
    "generating",
    "generated",
    "pending_approval",
    "approved",
    "scheduled",
    "published",
    "failed",
  ]).default("pending_generation").notNull(),
  /** Number of generation attempts made (for auto-retry logic). */
  generationAttempts: int("generationAttempts").default(0).notNull(),
  /** Error message if generation or publish failed. */
  errorMessage: text("errorMessage"),
  /** True if this article was generated as part of a free trial. */
  isFreeTrial: boolean("isFreeTrial").default(false).notNull(),
  /** True if this article is a test article (admin testing, excluded from billing). */
  isTestArticle: boolean("isTestArticle").default(false).notNull(),
  /** Timestamp when the user approved this article. */
  approvedAt: timestamp("approvedAt"),
  /** Timestamp when the article was published to the CMS. */
  publishedAt: timestamp("publishedAt"),
  /** Scheduled publish date/time sent to the CMS. */
  scheduledPublishAt: timestamp("scheduledPublishAt"),
  /** CMS post ID returned after successful publish. */
  cmsPostId: varchar("cmsPostId", { length: 255 }),
  /** CMS post URL returned after successful publish. */
  cmsPostUrl: varchar("cmsPostUrl", { length: 2048 }),
  /**
   * Manus Heartbeat task UID for the scheduled publish job.
   * Set when a heartbeat job is created for this article.
   * Cleared when the job fires or is cancelled.
   * Used to cancel or reschedule the job via deleteHeartbeatJob / updateHeartbeatJob.
   */
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  /**
   * Timestamp when the retry heartbeat is scheduled to fire.
   * Set to scheduledPublishAt + 15 minutes when the first publish attempt fails.
   */
  retryScheduledAt: timestamp("retryScheduledAt"),
  /**
   * Number of automated publish retries attempted.
   * 0 = no retries yet, 1 = one retry attempted.
   * Maximum retries: 1 (after which article is marked publish_failed).
   */
  publishRetryCount: int("publishRetryCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const articlesRelations = relations(articles, ({ one }) => ({
  articleNode: one(articleNodes, { fields: [articles.articleNodeId], references: [articleNodes.id] }),
  business: one(businesses, { fields: [articles.businessId], references: [businesses.id] }),
  image: one(articleImages, { fields: [articles.id], references: [articleImages.articleId] }),
  adminLogs: one(adminLog, { fields: [articles.id], references: [adminLog.targetArticleId] }),
}));

export type Article = typeof articles.$inferSelect;
export type InsertArticle = typeof articles.$inferInsert;

// ---------------------------------------------------------------------------
// ARTICLE IMAGES
// Optional image per article. User can paste a URL or upload a file.
// ---------------------------------------------------------------------------
export const articleImages = mysqlTable("article_images", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull().unique().references(() => articles.id),
  /** Public URL of the image (either user-provided URL or S3 storage URL). */
  imageUrl: varchar("imageUrl", { length: 2048 }),
  /** S3 storage key — set when user uploads directly to Blog Batcher. */
  storageKey: varchar("storageKey", { length: 512 }),
  /** AI-generated alt text, fully editable by the user. */
  altText: varchar("altText", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const articleImagesRelations = relations(articleImages, ({ one }) => ({
  article: one(articles, { fields: [articleImages.articleId], references: [articles.id] }),
}));

export type ArticleImage = typeof articleImages.$inferSelect;
export type InsertArticleImage = typeof articleImages.$inferInsert;

// ---------------------------------------------------------------------------
// SCHEDULES
// Publishing schedule for a business's article batch.
// ---------------------------------------------------------------------------
export const schedules = mysqlTable("schedules", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().unique().references(() => businesses.id),
  /** Publishing cadence selected by the user. */
  cadence: mysqlEnum("cadence", [
    "every_day",
    "every_2_days",
    "every_3_days",
    "once_per_week",
    "twice_per_week",
  ]),
  /** Date the publishing schedule starts. */
  startDate: timestamp("startDate"),
  /** Whether the user has confirmed and locked this schedule. */
  confirmed: boolean("confirmed").default(false).notNull(),
  /**
   * Preferred publish hour in 24-hour UTC (0–23). Defaults to 9 (9am UTC).
   * Stored as UTC; frontend converts from user's local AM/PM selection.
   */
  publishHour: int("publishHour").default(9).notNull(),
  /**
   * Preferred publish minute (0, 15, 30, 45). Defaults to 0.
   */
  publishMinute: int("publishMinute").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const schedulesRelations = relations(schedules, ({ one }) => ({
  business: one(businesses, { fields: [schedules.businessId], references: [businesses.id] }),
}));

export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;

// ---------------------------------------------------------------------------
// CREDITS
// Credit balance per user. Each user has one balance record.
// ---------------------------------------------------------------------------
export const credits = mysqlTable("credits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id),
  /** Current credit balance. Credits never expire. */
  balance: int("balance").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const creditsRelations = relations(credits, ({ one }) => ({
  user: one(users, { fields: [credits.userId], references: [users.id] }),
}));

export type Credit = typeof credits.$inferSelect;
export type InsertCredit = typeof credits.$inferInsert;

// ---------------------------------------------------------------------------
// CREDIT TRANSACTIONS
// Audit log of every credit debit and credit event.
// ---------------------------------------------------------------------------
export const creditTransactions = mysqlTable("credit_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  /** Change in balance: positive = credit added, negative = credit used. */
  delta: int("delta").notNull(),
  /** Balance after this transaction. */
  balanceAfter: int("balanceAfter").notNull(),
  /** Reason for the transaction. */
  reason: mysqlEnum("reason", [
    "pack_purchase",
    "top_up",
    "article_generated",
    "article_regenerated",
    "free_trial",
    "admin_grant",
    "refund",
  ]).notNull(),
  /** Optional reference to the article that consumed a credit. */
  articleId: int("articleId").references(() => articles.id),
  /** Optional reference to the Stripe payment that added credits. */
  stripePaymentId: int("stripePaymentId").references(() => stripePayments.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  user: one(users, { fields: [creditTransactions.userId], references: [users.id] }),
  article: one(articles, { fields: [creditTransactions.articleId], references: [articles.id] }),
  stripePayment: one(stripePayments, { fields: [creditTransactions.stripePaymentId], references: [stripePayments.id] }),
}));

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;

// ---------------------------------------------------------------------------
// INTEGRATIONS
// CMS connection credentials per business. One row per CMS platform.
// Credentials are stored encrypted at the application layer.
// ---------------------------------------------------------------------------
export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** CMS platform this integration connects to. */
  platform: mysqlEnum("platform", [
    "wordpress",
    "wix",
    "shopify",
    "webflow",
    "squarespace",
    "ghost",
    "zapier",
  ]).notNull(),
  /** Connection status. */
  status: mysqlEnum("status", [
    "not_connected",
    "connected",
    "failed",
  ]).default("not_connected").notNull(),
  /**
   * Platform-specific credentials stored as encrypted JSON.
   * WordPress: { siteUrl, username, applicationPassword }
   * Wix: { apiKey, siteId }
   * Shopify: { storeDomain, adminApiToken, blogId }
   * Webflow: { apiToken, collectionId }
   * Squarespace: { personalAccessToken }
   * Ghost: { adminUrl, staffAccessToken }
   * Zapier: { webhookUrl }
   */
  credentialsEncrypted: text("credentialsEncrypted"),
  /** Timestamp of the last successful connection test. */
  lastTestedAt: timestamp("lastTestedAt"),
  /** Error message from the last failed connection test. */
  lastTestError: text("lastTestError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const integrationsRelations = relations(integrations, ({ one }) => ({
  business: one(businesses, { fields: [integrations.businessId], references: [businesses.id] }),
}));

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

// ---------------------------------------------------------------------------
// STRIPE PAYMENTS
// Record of every Stripe payment event relevant to this platform.
// ---------------------------------------------------------------------------
export const stripePayments = mysqlTable("stripe_payments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  /** Stripe Payment Intent or Checkout Session ID. */
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }).unique(),
  /** Stripe Customer ID. */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  /** Payment status from Stripe. */
  status: mysqlEnum("status", [
    "pending",
    "succeeded",
    "failed",
    "refunded",
  ]).notNull(),
  /** Amount in cents (AUD). */
  amountCents: int("amountCents").notNull(),
  /** Currency code, e.g. 'aud'. */
  currency: varchar("currency", { length: 8 }).default("aud").notNull(),
  /** Product purchased. */
  product: mysqlEnum("product", [
    "pack_20",
    "pack_50",
    "credit_top_up",
  ]).notNull(),
  /** Number of credits allocated on successful payment. */
  creditsAllocated: int("creditsAllocated").default(0).notNull(),
  /** Stripe webhook event ID for idempotency. */
  stripeEventId: varchar("stripeEventId", { length: 255 }).unique(),
  /** Full Stripe event payload stored for audit purposes. */
  stripeEventPayload: json("stripeEventPayload"),
  /** Stripe Checkout Session ID (cs_...). Used to look up receipt after redirect. */
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }),
  /** Stripe-hosted receipt URL from the charge object. */
  receiptUrl: text("receiptUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const stripePaymentsRelations = relations(stripePayments, ({ one, many }) => ({
  user: one(users, { fields: [stripePayments.userId], references: [users.id] }),
  creditTransactions: many(creditTransactions),
}));

export type StripePayment = typeof stripePayments.$inferSelect;
export type InsertStripePayment = typeof stripePayments.$inferInsert;

// ---------------------------------------------------------------------------
// ADMIN LOG
// Audit trail of all admin actions performed via the admin panel.
// ---------------------------------------------------------------------------
export const adminLog = mysqlTable("admin_log", {
  id: int("id").autoincrement().primaryKey(),
  /** The admin user who performed the action. */
  adminUserId: int("adminUserId").notNull().references(() => users.id),
  /** Type of action performed. */
  action: mysqlEnum("action", [
    "grant_credits",
    "remove_credits",
    "override_article_status",
    "unlock_user",
    "reset_user",
    "view_user_dashboard",
    "flag_test_business",
    "manual_publish_retry",
    "suspend_user",
    "unsuspend_user",
    "add_credits",
    "impersonate_user",
    "other",
  ]).notNull(),
  /** Target user affected by this action (if applicable). */
  targetUserId: int("targetUserId").references(() => users.id),
  /** Target business affected by this action (if applicable). */
  targetBusinessId: int("targetBusinessId").references(() => businesses.id),
  /** Target article affected by this action (if applicable). */
  targetArticleId: int("targetArticleId").references(() => articles.id),
  /** Human-readable description of what was done. */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const adminLogRelations = relations(adminLog, ({ one }) => ({
  adminUser: one(users, {
    fields: [adminLog.adminUserId],
    references: [users.id],
    relationName: "adminUser",
  }),
  targetUser: one(users, {
    fields: [adminLog.targetUserId],
    references: [users.id],
    relationName: "targetUser",
  }),
  targetBusiness: one(businesses, { fields: [adminLog.targetBusinessId], references: [businesses.id] }),
  targetArticle: one(articles, { fields: [adminLog.targetArticleId], references: [articles.id] }),
}));

export type AdminLog = typeof adminLog.$inferSelect;
export type InsertAdminLog = typeof adminLog.$inferInsert;

// ---------------------------------------------------------------------------
// PUBLISH AUDIT LOG
// Records every automated publish attempt (scheduled, retry, cancel) with
// timestamp, article ID, action, and result. Used for Layer 9 audit trail.
// ---------------------------------------------------------------------------
export const publishAuditLog = mysqlTable("publish_audit_log", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId").notNull().references(() => articles.id),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /**
   * Action performed by the automated system.
   * scheduled_publish_attempted: heartbeat fired and publish was attempted
   * scheduled_publish_succeeded: publish completed successfully
   * scheduled_publish_failed: publish attempt failed (first attempt)
   * retry_attempted: retry heartbeat fired (15 min after first failure)
   * retry_succeeded: retry publish completed successfully
   * retry_failed: retry also failed — article marked publish_failed
   * schedule_cancelled: user cancelled the scheduled job
   * schedule_rescheduled: user changed the scheduled publish date
   */
  action: mysqlEnum("action", [
    "scheduled_publish_attempted",
    "scheduled_publish_succeeded",
    "scheduled_publish_failed",
    "retry_attempted",
    "retry_succeeded",
    "retry_failed",
    "schedule_cancelled",
    "schedule_rescheduled",
  ]).notNull(),
  /** Outcome of the action. */
  result: mysqlEnum("result", ["success", "failure", "cancelled", "rescheduled"]).notNull(),
  /** Error message if the action failed. */
  errorMessage: text("errorMessage"),
  /** Which attempt this is: 1 = first attempt, 2 = retry. */
  attemptNumber: int("attemptNumber").default(1).notNull(),
  /** What triggered this action. */
  triggeredBy: mysqlEnum("triggeredBy", ["user", "heartbeat"]).default("heartbeat").notNull(),
  /** New scheduled date (for reschedule actions). */
  newScheduledAt: timestamp("newScheduledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const publishAuditLogRelations = relations(publishAuditLog, ({ one }) => ({
  article: one(articles, { fields: [publishAuditLog.articleId], references: [articles.id] }),
  business: one(businesses, { fields: [publishAuditLog.businessId], references: [businesses.id] }),
}));

export type PublishAuditLog = typeof publishAuditLog.$inferSelect;
export type InsertPublishAuditLog = typeof publishAuditLog.$inferInsert;

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// In-app notifications for the user. Created by the automated publish system
// on success, failure, and retry failure. Displayed in the notification bell.
// ---------------------------------------------------------------------------
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  businessId: int("businessId").references(() => businesses.id),
  articleId: int("articleId").references(() => articles.id),
  /** Type of notification. */
  type: mysqlEnum("type", [
    "publish_success",
    "publish_failed",
    "retry_failed",
    "schedule_cancelled",
    "schedule_rescheduled",
  ]).notNull(),
  /** Short notification title shown in the bell dropdown. */
  title: varchar("title", { length: 255 }).notNull(),
  /** Full notification message. */
  message: text("message").notNull(),
  /** Whether the user has read this notification. */
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  business: one(businesses, { fields: [notifications.businessId], references: [businesses.id] }),
  article: one(articles, { fields: [notifications.articleId], references: [articles.id] }),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferSelect;

// ---------------------------------------------------------------------------
// App Error Log — captures unhandled server errors and failed automated actions
// ---------------------------------------------------------------------------
export const appErrorLog = mysqlTable("app_error_log", {
  id: int("id").autoincrement().primaryKey(),
  /** User who triggered the error (null for system/cron errors). */
  userId: int("userId").references(() => users.id),
  /** Express route or job name where the error occurred. */
  route: varchar("route", { length: 255 }),
  /** Short error message. */
  errorMessage: text("errorMessage").notNull(),
  /** Full stack trace (truncated to 4000 chars). */
  stackTrace: text("stackTrace"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const appErrorLogRelations = relations(appErrorLog, ({ one }) => ({
  user: one(users, { fields: [appErrorLog.userId], references: [users.id] }),
}));

export type AppErrorLog = typeof appErrorLog.$inferSelect;
export type InsertAppErrorLog = typeof appErrorLog.$inferInsert;

// ---------------------------------------------------------------------------
// API Cost Log — tracks Claude LLM API calls with token counts and estimated cost
// ---------------------------------------------------------------------------
export const apiCostLog = mysqlTable("api_cost_log", {
  id: int("id").autoincrement().primaryKey(),
  /** User who triggered the API call. */
  userId: int("userId").references(() => users.id),
  /** Model name (e.g. claude-3-5-sonnet-20241022). */
  model: varchar("model", { length: 128 }).notNull(),
  /** Number of input tokens consumed. */
  inputTokens: int("inputTokens").default(0).notNull(),
  /** Number of output tokens generated. */
  outputTokens: int("outputTokens").default(0).notNull(),
  /** Estimated cost in USD (input + output at standard rates). */
  estimatedCostUsd: decimal("estimatedCostUsd", { precision: 10, scale: 6 }).default("0").notNull(),
  /** Feature that triggered this call. */
  feature: mysqlEnum("feature", [
    "article_generation",
    "keyword_research",
    "business_scrape",
    "seo_analysis",
    "other",
  ]).default("other").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const apiCostLogRelations = relations(apiCostLog, ({ one }) => ({
  user: one(users, { fields: [apiCostLog.userId], references: [users.id] }),
}));

export type ApiCostLog = typeof apiCostLog.$inferSelect;
export type InsertApiCostLog = typeof apiCostLog.$inferInsert;

// ---------------------------------------------------------------------------
// KEYWORD SEEDS
// Up to 10 seed keyword phrases per business, gathered during the business
// profile wizard. These seeds are used to drive DataForSEO keyword research
// so that primary keyword assignment is based on real search data rather than
// AI guesses.
// ---------------------------------------------------------------------------
export const keywordSeeds = mysqlTable("keyword_seeds", {
  id: int("id").autoincrement().primaryKey(),
  businessId: int("businessId").notNull().references(() => businesses.id),
  /** The seed keyword phrase, e.g. "pitch deck design". */
  keyword: varchar("keyword", { length: 255 }).notNull(),
  /** Display order (0-based). */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const keywordSeedsRelations = relations(keywordSeeds, ({ one }) => ({
  business: one(businesses, { fields: [keywordSeeds.businessId], references: [businesses.id] }),
}));
export type KeywordSeed = typeof keywordSeeds.$inferSelect;
export type InsertKeywordSeed = typeof keywordSeeds.$inferInsert;
