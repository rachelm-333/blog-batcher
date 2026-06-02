# Blog Batcher — Project TODO

## Layer 1: Database Schema
- [x] users table (extended with tier, credits, onboarding_complete)
- [x] businesses table (all Stage 1 profile fields)
- [x] business_audiences table (target audience groups per business)
- [x] business_services table (services/products per business)
- [x] business_cta_links table (internal CTA links stored on businesses table)
- [x] business_competitors table (competitor research per business)
- [x] business_existing_content table (scraped existing blog posts)
- [x] brand_voice table (voice archetype, persona, extracted voice, final brief)
- [x] blog_architectures table (pack size, cornerstone/pillar/cluster counts)
- [x] article_nodes table (each article slot in the architecture tree)
- [x] keywords table (primary keyword per article node, PAA questions)
- [x] articles table (generated article content, SEO metadata, status, scores)
- [x] article_images table (optional images per article)
- [x] schedules table (publish cadence and scheduled dates per article)
- [x] credits table + credit_transactions table (balance and full audit log per user)
- [x] integrations table (CMS connection credentials per business)
- [x] admin_log table (admin actions audit trail)
- [x] stripe_payments table (Stripe payment records)
- [x] Run Drizzle migration and apply to DB (migration 0001 applied, 18 tables verified)

## Layer 2: Auth (no Stripe yet)
- [x] Resend email helper (server/email.ts) — verification + reset emails
- [x] bcrypt password hashing utility
- [x] auth.register procedure (email+password, creates user + credits row, sends verification email)
- [x] auth.verifyEmail procedure (token validation, marks emailVerified=true)
- [x] auth.login procedure (email+password, JWT cookie, 30-day refresh)
- [x] auth.logout procedure (clears JWT cookie)
- [x] auth.forgotPassword procedure (sends reset email with token)
- [x] auth.resetPassword procedure (validates token, updates passwordHash)
- [x] auth.me procedure (returns current user from JWT)
- [x] Role system: role=admin|user + tier=standard|multi_business|agency (in schema)
- [x] Rachel Mackay pre-seeded as admin (rachel.m@noize.com.au) with unlimited credits
- [x] All users get full access after email verification — no purchase gate
- [x] Stripe placeholder comment block in routers.ts
- [x] Register page UI (/register)
- [x] Login page UI (/login)
- [x] Verify email page UI (/verify-email?token=...)
- [x] Forgot password page UI (/forgot-password)
- [x] Reset password page UI (/reset-password?token=...)
- [x] Post-login redirect to onboarding or dashboard
- [x] Auth guard: redirect unauthenticated users to /login
- [x] Vitest: register, login, logout, verifyEmail, forgotPassword, resetPassword (16/16 pass)

## Layer 3: Stage 1 — Business Profile & Website Scrape

### Backend procedures (server/routers/business.ts)
- [x] business.create — create a new business for the logged-in user
- [x] business.get — get the user's current business (or null)
- [x] business.update — update all business detail fields
- [x] business.scrape — AI scrape via Claude: returns prefilled fields for all sections
- [x] business.saveAudiences — upsert audience groups
- [x] business.saveServices — upsert services/products
- [x] business.saveCtaLinks — CTA links saved via business.update
- [x] business.saveCompetitors — upsert competitors (max 3)
- [x] business.saveBrandVoice — upsert brand_voice row
- [x] business.saveExistingContent — store scraped blog posts
- [x] business.markStageComplete — advance stage tracker

### Frontend — Stage 1 multi-step wizard (client/src/pages/onboarding/)
- [x] Step 0: Scrape input (business name + URL, trigger scrape, loading state)
- [x] Step 1: Business Details (name, industry, location, service area, address, ABN, UVP, keyword exclusions, target audiences)
- [x] Step 2: Services & Products (list with name + URL, add/remove rows)
- [x] Step 3: Internal CTA Links (contact, bookings, testimonials, shop, primary CTA text + URL)
- [x] Step 4: Brand Voice (archetype selector primary+secondary, persona name, formality, key phrases, phrases to avoid, style notes, final voice brief editable textarea)
- [x] Step 5: Competitor Research (up to 3 competitors, AI-suggested, accept/edit/remove)
- [x] Step 6: Publishing Platform (CMS selector + WordPress SEO plugin sub-selector)
- [x] Step 7: Social Proof / E-E-A-T (years in business, clients served, awards/certs)
- [x] Step 8: Review & Save (summary of all fields, Save Profile & Continue button)
- [x] Re-scan button on Step 0 to re-crawl and regenerate all fields
- [x] Progress stepper component showing current step
- [x] All fields pre-filled from scrape result, fully editable
- [x] Persist draft to DB on each step save (not just at the end)

### Routing & auth
- [x] /onboarding route — redirects to /dashboard if profile already complete
- [x] /dashboard redirects to /onboarding if no business profile exists
- [x] Auth guard on both /onboarding and /dashboard

### Tests
- [x] Vitest: business.create, business.get, business.update, business.scrape (mocked Claude), business.saveBrandVoice (24/24 pass)

## Layer 4: Stage 2 — Blog Architecture

### Architecture rules (from scope)
- Rules: clusters-per-pillar = always 3; min ratio 1:1:3; max per cornerstone 1:4:12
- 20-pack default: 2 cornerstones × 2 pillars × 3 clusters = 18 + 2 extra clusters
- 50-pack default: 4 cornerstones × 3 pillars × 3 clusters = 52 → adjusted to 50
- Pack is locked once selected (tied to Stripe purchase — placeholder for now)
- Article types: Cornerstone Guide, Top 10 List, How-To, The Why, Comparison, Myth-Busting, Case Study

### Backend (server/routers/architecture.ts)
- [x] architecture.getOrCreate — get existing architecture or create default for the business
- [x] architecture.update — update cornerstones/pillars counts, validate guardrails server-side
- [x] architecture.setArticleType — set article type for a specific article_node
- [x] architecture.confirm — lock the architecture, advance stage to 3
- [x] Guardrails engine (shared/architectureRules.ts): validate any config, return corrected values + explanation message
- [x] Auto-generate article_nodes rows when architecture is created/updated

### Frontend (client/src/pages/Architecture.tsx)
- [x] Pack selection card (20 or 50 articles) — locked after selection
- [x] Cornerstone slider (1–4) with live guardrail feedback
- [x] Pillars-per-cornerstone slider (1–4) with live guardrail feedback
- [x] Real-time article count display (cornerstones + pillars + clusters = total)
- [x] Visual tree map: cornerstones → pillars → clusters (collapsible)
- [x] Article type selector dropdown on each Pillar node
- [x] Cluster type shown as auto-assigned (read-only)
- [x] Guardrail warning banner when config is auto-corrected
- [x] 'Confirm Architecture & Continue' button (disabled until valid)
- [x] /architecture route, auth-guarded, redirects to /onboarding if no business
- [x] Dashboard Stage 2 'Continue' button links to /architecture

### Tests
- [x] Vitest: guardrails engine (20 tests), architecture procedures — 47/47 total tests pass

## Layer 5: Stage 3 — SEO Keyword Research

### DataForSEO integration (server/dataforseo.ts)
- [x] DataForSEO API helper: keyword data (MSV, competition, CPC) via Keywords Data API
- [x] DataForSEO PAA helper: People Also Ask questions via SERP API
- [x] Fallback: if DataForSEO key not set, use Claude to suggest keywords (graceful degradation)

### Backend (server/routers/keywords.ts)
- [x] keywords.assignAll — auto-assign one primary keyword to every article_node (DataForSEO + Claude fallback)
- [x] keywords.getAll — return all keywords for a business with node info
- [x] keywords.getSuggestions — return DataForSEO alternatives for a given keyword
- [x] keywords.swap — replace a keyword with a DataForSEO alternative or manual entry
- [x] keywords.approveOne — approve a single keyword row
- [x] keywords.approveAll — mark all keywords as approved, block if cannibalization found
- [x] keywords.fetchPAA — fetch PAA questions for all approved keywords
- [x] keywords.approvePAA — approve PAA question for a node, advance stage to 4 when all approved
- [x] Cannibalization engine (shared/cannibalizationCheck.ts): exact duplicate + semantic overlap detection

### Frontend (client/src/pages/Keywords.tsx)
- [x] Stage progress bar showing: Assign → Keyword Review → PAA Review → Approved
- [x] Keyword review table: one row per article node (type, node label, keyword, MSV, competition, status)
- [x] Swap button per row: opens modal with DataForSEO alternatives + manual entry
- [x] Approve button per row (individual approval)
- [x] 'Approve All' button — blocked if any cannibalization warnings exist
- [x] Cannibalization warning banner listing conflicting keyword pairs
- [x] Duplicate keyword warning (exact match)
- [x] Progress gate: 'Proceed to PAA Review' shown only when all keywords approved
- [x] PAA review step: select dropdown per article from PAA questions list
- [x] Progress gate: 'Proceed to Article Generation' shown only when all PAA approved
- [x] /keywords route, auth-guarded, redirects to /architecture if stage < 3
- [x] Dashboard Stage 3 'Continue' button links to /keywords

### Tests
- [x] Vitest: cannibalization engine (8 tests), keywords.getAll, keywords.approveOne, keywords.approveAll (blocks on cannibalization), keywords.approvePAA (stageAdvanced flag) — 70/70 total pass

## Layer 6: Stage 4 — Article Generation

### Word count rules (from scope)
- Cornerstone: 2,500–3,200 words (hard max 3,200)
- Pillar: 1,500–1,800 words
- Cluster: 1,000–1,200 words

### Generation engine (server/articleEngine.ts)
- [x] Pre-generate URL slugs for all article_nodes before writing begins
- [x] Generation order: Cornerstone → Pillar (grouped by parent) → Cluster (grouped by parent pillar)
- [x] Claude prompt builder: sends all 16 Authority Standard rules + full business context + internal link URLs
- [x] Explicit no-fabrication instruction in every prompt
- [x] Word count enforcement: prompt specifies range, post-generation check truncates/flags if exceeded
- [x] AI fingerprint scrub pass (second Claude call): remove em dashes, rhetorical openers, banned phrases, repetitive structures
- [x] Pass 1 rules-based scorer: keyword density, keyword in H1/H2/H3/first-100-words/slug, meta title ≤60 chars, meta description 140–160 chars, word count in range, external link present, internal CTA link present, schema present
- [x] Pass 2 AI quality scorer: search intent resolution, human authenticity, title territory, E-E-A-T, batch cohesion
- [x] Combined score → status badge: Authority Ready (all 16), Strong (14–15), Needs Review (<14)
- [x] Auto-regeneration: articles scoring <80/100 internal queued for one retry; if still <80 flagged for manual review
- [x] One article at a time per user (no parallel generation for same user)
- [x] FAQ schema only on Cornerstones and Pillars — never Clusters

### Backend procedures (server/routers/articles.ts)
- [x] articles.startGeneration — validates stage=4, pre-generates slugs, enqueues all nodes in correct order, returns jobId
- [x] articles.getGenerationStatus — returns progress (written/scored/ready/failed counts, current article title)
- [x] articles.getAll — return all articles for a business with status badges
- [x] articles.get — return single article with full content, SEO fields, schema, score breakdown
- [x] articles.regenerate — re-run generation for a single flagged article
- [x] articles.updateStatus — admin/manual status override

### Frontend (client/src/pages/ArticleGeneration.tsx)
- [x] 'Start Generation' button (disabled if stage < 4)
- [x] Live progress bar: articles written / articles scored / articles ready
- [x] Current article being written displayed by title
- [x] Article cards grid: each card shows title, type, status badge (Authority Ready / Strong / Needs Review)
- [x] Failed articles shown separately with 'Retry' button
- [x] 'Proceed to Review' button (enabled when all articles ≥ Needs Review or manually reviewed)
- [x] /generate route, auth-guarded, redirects to /keywords if stage < 4
- [x] Dashboard Stage 4 'Continue' button links to /generate

### Acceptance criteria (all must pass before checkpoint)
- [x] Articles generate in correct order: Cornerstone → Pillar → Cluster
- [x] Word counts enforced: Cornerstone ≤3,200 / Pillar 1,500–1,800 / Cluster 1,000–1,200
- [x] All 16 Authority Standard points applied in prompt
- [x] Status badge displays correctly based on score
- [x] Articles saved to DB with correct status
- [x] No fabricated stats instruction present in every prompt
- [x] AI fingerprint scrub pass runs after generation

### Tests
- [x] Vitest: articleEngine slug generation, generation order, word count enforcement, Pass 1 scorer (all 16 rules), status badge thresholds, scrub pass (banned phrase removal) — 65/65 pass

## Layer 7: Stage 5 — Review, Edit, Approve, Publish & Schedule

### Backend Procedures (articles router extensions)
- [x] articles.updateSeoFields — save edits to urlSlug, metaTitle, metaDescription, focusKeyword, schemaMarkup, faqItems
- [x] articles.approve — advance status to approved, set approvedAt
- [x] articles.approveAll — approve all generated articles for a business in one call
- [x] articles.saveImage — save image URL or upload to S3, store in article_images, auto-generate alt text
- [x] articles.exportZip — generate ZIP with HTML, Markdown, meta .txt, schema JSON-LD, schedule CSV
- [x] schedule.save — save publishing cadence + startDate for a business
- [x] schedule.get — return current schedule with calculated publish dates per article
- [x] schedule.confirm — lock schedule, set scheduledPublishAt on each article, advance business to stage 5

### Frontend Pages
- [x] /review route — Stage 5 Review & Publish page (auth-guarded, redirects to /generate if stage < 5)
- [x] Left panel: article list sidebar (Cornerstone/Pillar/Cluster labels, status badges matching mockup)
- [x] Right panel: article body (rendered HTML, Position Zero Answer Block highlighted, inline edit)
- [x] SEO panel: URL Slug, Meta Title (char counter), Meta Description (char counter), Focus Keyword, Image upload/URL, Schema (advanced)
- [x] Score badge: Authority Ready / Strong / Needs Review with correct colours
- [x] Warning box: "Over-editing keyword placement can reduce your ranking potential. We recommend publishing as-is."
- [x] Save Draft button and Approve & Publish → button
- [x] Regenerate button (only before approval)
- [x] Publish & Schedule screen: Publishing Method cards (Wix, WordPress, Zapier, Export ZIP)
- [x] Publish As: Scheduled / Drafts toggle
- [x] Publishing Cadence selector (Daily / 2 days / 3 days / 1/week / 2/week)
- [x] Publishing Calendar Preview (month view with article titles on publish dates)
- [x] Send All to CMS & Schedule → button
- [x] Export ZIP download (HTML + Markdown + meta .txt + schema JSON-LD + schedule CSV)
- [x] Dashboard Stage 5 'Continue' button links to /review

### Verification
- [x] All articles must be approved before publish options unlock
- [x] Regenerate locked after approval
- [x] Export ZIP contains all required files
- [x] Schedule cadence correctly distributes articles across dates
- [x] Status badges display correctly in article list
- [x] Vitest: SEO field validation, schedule date calculation, ZIP contents, approval gate — 37/37 pass
- [ ] Integration test: articles.saveImage persists to article_images with alt text
- [ ] Integration test: real ZIP produced by exportZip endpoint verified for all required files
- [ ] Route-level test: /review auth guard and stage<5 redirect verified
- [ ] Real UI gate test: publish options locked until all approved (currently unit-tested only)
- [ ] Real UI gate test: regenerate blocked after approval (currently unit-tested only)

## Layer 10: Dashboard
- [ ] Status badges per article
- [ ] Publishing calendar view
- [ ] Article progress tracker
- [ ] Failure notifications

## Layer 11: Support Centre
- [ ] All help articles
- [ ] Question mark (?) anchor links throughout app
- [ ] Search bar

## Layer 12: Admin Panel
- [ ] User management view
- [ ] Business and article overview
- [ ] Stripe payment history
- [ ] API usage and cost tracking
- [ ] Credit override and manual grant
- [ ] Test mode (flagged test articles excluded from billing)

## Layer 13: Free Trial
- [ ] 1-article free flow
- [ ] Email verification gate
- [ ] Conversion prompt post-generation
- [ ] Block second free trial attempt

## Layer 14: Multi-Business
- [ ] Business selector dropdown in top nav
- [ ] Isolated workspaces per business

## Layer 8: Publishing & CMS Delivery

### CMS Publisher Service (server/cmsPublisher.ts)
- [ ] WordPress publisher: POST to /wp-json/wp/v2/posts with title, content, slug, status, date
- [ ] WordPress SEO meta: Yoast (_yoast_wpseo_title, _yoast_wpseo_metadesc, _yoast_wpseo_focuskw), RankMath (rank_math_title, rank_math_description, rank_math_focus_keyword), AIOSEO (_aioseo_title, _aioseo_description, _aioseo_keywords), None (standard post meta)
- [ ] WordPress schema: inject JSON-LD as custom field _blog_batcher_schema
- [ ] WordPress image: upload featured image via /wp-json/wp/v2/media if imageUrl provided
- [ ] Wix publisher: POST to Wix Blog API v3 (create draft, set SEO fields, publish)
- [ ] Zapier publisher: POST article payload JSON to user-supplied webhookUrl
- [ ] Publish failure: catch all errors, return structured { success, cmsPostId, cmsPostUrl, error } result
- [ ] Connection test: testConnection(integration) — lightweight HEAD/GET to verify credentials before publish

### Backend Procedures
- [ ] integrations.save — upsert CMS credentials (encrypted) for a business+platform
- [ ] integrations.get — return all integrations for a business (credentials redacted)
- [ ] integrations.testConnection — test live connection to CMS, update status + lastTestedAt
- [ ] integrations.delete — remove an integration
- [ ] articles.publish — publish one article to connected CMS, update status/cmsPostId/cmsPostUrl/publishedAt or set failed+errorMessage
- [ ] articles.publishAll — publish all approved articles for a business (respects scheduledPublishAt)
- [ ] articles.retryPublish — retry a single failed article publish
- [ ] Publish failure notification: call notifyOwner + send email to user on publish failure
- [ ] ZIP export integration test: verify real archive from /api/articles/export-zip contains all 5 file types

### Frontend Pages
- [ ] /integrations route — CMS Integrations settings page (auth-guarded)
- [ ] WordPress connection form: Site URL, Username, Application Password, SEO Plugin selector (Yoast/RankMath/AIOSEO/None), Test Connection button
- [ ] Wix connection form: API Key, Site ID, Test Connection button
- [ ] Zapier connection form: Webhook URL, Test Connection button
- [ ] Shopify/Webflow/Squarespace/Ghost: Coming Soon cards (greyed out)
- [ ] Connection status badge per integration (Connected / Not Connected / Failed)
- [ ] Test Connection result shown inline (success message or error detail)
- [ ] PublishSchedule page: wire Send All to CMS button to articles.publishAll
- [ ] PublishSchedule page: show publish progress (X of Y articles published)
- [ ] ArticleReview sidebar: show publish status badge (Scheduled / Published / Failed) per article
- [ ] ArticleReview sidebar: show CMS post URL as clickable link when published
- [ ] Failed publish error detail shown in ArticleReview sidebar with Retry button
- [ ] Dashboard: link to /integrations from navigation sidebar
- [ ] Integrations link in DashboardLayout sidebar nav

### Verification
- [ ] WordPress publish end-to-end: article appears in WP with correct SEO fields
- [ ] ZIP download: open real archive, assert HTML + Markdown + meta.txt + schema.json + schedule.csv present
- [ ] Deliberate publish failure: error notification appears in dashboard
- [ ] Publish status updates correctly in article sidebar
- [ ] Vitest: cmsPublisher (all 4 WP plugin modes, Zapier payload, failure handling, connection test)

## Layer 8: Publishing & CMS Delivery

### Backend
- [x] server/cmsPublisher.ts — WordPress REST API (Yoast/RankMath/AIOSEO/None), Wix Content API, Zapier webhook
- [x] integrations router — save/test/get CMS credentials (platform, siteUrl, username, password, webhookUrl, seoPlugin)
- [x] articles.publish — publish single article to configured CMS, update status/cmsPostId/cmsPostUrl/publishedAt/errorMessage
- [x] articles.retryPublish — clear error and re-attempt publish for failed articles
- [x] articles.publishAll — publish all approved articles for a business
- [x] Failed publish handling — error stored on article, notifyOwner called with specific error message
- [x] Publish status tracking — articles.status enum includes scheduled/published/failed

### Frontend
- [x] /integrations route — Integrations settings page (WordPress, Wix, Zapier connection forms with Test Connection)
- [x] WordPress form: Site URL, Username, Application Password, SEO Plugin selector (Yoast/RankMath/AIOSEO/None)
- [x] Wix form: Site ID, API Key
- [x] Zapier form: Webhook URL
- [x] Test Connection button — validates credentials against live CMS endpoint
- [x] Coming Soon cards: Shopify, Webflow, Squarespace, Ghost
- [x] PublishSchedule.tsx — Send All to CMS button uses real articles.publishAll mutation
- [x] ArticleReview.tsx — publish status badges in sidebar (published/scheduled/failed)
- [x] ArticleReview.tsx — Retry Publish button for failed articles
- [x] ArticleReview.tsx — CMS post URL link for published articles
- [x] ArticleReview.tsx — publish error message displayed in SEO panel

### Tests (34/34 pass)
- [x] WordPress payload: all 4 SEO plugin modes (Yoast, RankMath, AIOSEO, None)
- [x] Wix payload: title, slug, richContent, seoData
- [x] Zapier payload: all required fields
- [x] Export ZIP: real archive with all 5 file types verified (adm-zip)
- [x] Failed publish: 401 error stored, status set to 'failed', publishedAt null
- [x] Successful publish: status set to 'published', cmsPostId/cmsPostUrl stored, publishedAt set

### Verification (48/48 pass)
- [x] V1: WordPress payload — all 4 SEO plugin modes correct
- [x] V2: Wix payload — title, slug, seoData, richContent correct
- [x] V3: Zapier payload — all 11 fields correct
- [x] V4: Export ZIP — real 1085-byte archive, all 5 files present and correct
- [x] V5: Deliberate publish failure — 401 received, error stored, status=failed
- [x] V6: Publish status badge update — published/failed badges correct

### Honest Gap
- [ ] Real WordPress site publish test — requires a live WordPress URL + application password from user
  (mocked HTTP server used instead: verifies exact request structure, auth header, payload, and error handling)

### Real Wix Integration (10/10 pass — live site verified)
- [x] Draft created via POST /blog/v3/draft-posts with title, memberId, seoData, richContent
- [x] Draft published via POST /blog/v3/draft-posts/{id}/publish
- [x] Published post verified in /blog/v3/posts/{id} (title, memberId, slug confirmed)
- [x] Test post deleted via DELETE /blog/v3/draft-posts/{id}
- [x] Deletion confirmed (post no longer accessible)
- NOTE: Wix auto-generates slugs from title — custom slugs not supported via 3rd-party API (documented in Integrations UI)
- NOTE: Wix does not echo seoData.tags in GET /posts response — tags applied to page HTML head on live site (confirmed Wix API behaviour)

## Layer 9: Scheduling & Automation

### Schema changes
- [x] Add `publish_audit_log` table: id, articleId, businessId, action (enum), result (enum), errorMessage, attemptNumber, triggeredBy (enum: user/heartbeat), newScheduledAt, createdAt
- [x] Add `scheduleCronTaskUid` varchar(65) column to `articles` table (Heartbeat job UID for cancel/reschedule)
- [x] Add `retryScheduledAt` timestamp column to `articles` table (when the retry heartbeat fires)
- [x] Add `publishRetryCount` int column to `articles` table (0 = no retries yet, 1 = one retry attempted)
- [x] Run Drizzle migration and apply to DB (migration 0003 applied)

### Backend — Heartbeat handler
- [x] `/api/scheduled/publish-article` Express handler: authenticate via sdk.authenticateRequest (isCron check), look up article by scheduleCronTaskUid, call executeScheduledPublish(), write to publish_audit_log, on success update status=published, on failure create retry heartbeat (15 min) if retryCount=0, else mark publish_failed + notifyOwner
- [x] Register handler in server/_core/index.ts before Vite fallthrough
- [x] Retry heartbeat: create new heartbeat job for 15 minutes later, store new taskUid in article.scheduleCronTaskUid, increment publishRetryCount

### Backend — tRPC procedures (server/routers/scheduler.ts)
- [x] scheduler.scheduleArticle — create heartbeat job for article's scheduledPublishAt, store taskUid on article
- [x] scheduler.cancelSchedule — delete heartbeat job, clear scheduleCronTaskUid, set article status back to approved
- [x] scheduler.reschedule — update heartbeat job cron to new date, update scheduledPublishAt on article
- [x] scheduler.getAuditLog — return publish_audit_log entries for a business (paginated)
- [x] scheduler.getSchedule — return all scheduled/published/failed articles for a business with their scheduled dates and job status
- [x] scheduler.getNotifications, markNotificationRead, markAllRead
- [x] scheduler.simulatePublish — directly invokes executeScheduledPublish for testing without waiting for heartbeat
- [x] Wire schedulerRouter into server/routers.ts

### In-app notifications
- [x] `notifications` table: id, userId, businessId, type (enum), title, message, articleId, read, createdAt
- [x] scheduler.getNotifications — return notifications for the logged-in user (unreadOnly filter, limit)
- [x] scheduler.markNotificationRead — mark one notification as read
- [x] scheduler.markAllRead — mark all notifications for user as read
- [x] NotificationBell component in DashboardLayout header (unread count badge, dropdown)
- [x] Notification dropdown: list of recent notifications with type icon, title, message, timestamp
- [x] Auto-create notification on: scheduled publish success, retry failure (NOT on first failure — only after retry also fails)

### Frontend — Schedule Management page (/schedule-management)
- [x] Schedule management page: list all articles with scheduled dates, status badges (Scheduled/Published/Failed)
- [x] Cancel button per article (removes heartbeat job, returns to approved)
- [x] Reschedule date picker per article (dialog with datetime-local input, updates heartbeat job to new date)
- [x] Audit log tab: table of all automated publish attempts with timestamp, action badge, result, error, attemptNumber
- [x] Simulate Publish button (play icon) for testing without waiting for heartbeat
- [x] /schedule-management route registered in App.tsx
- [x] Dashboard sidebar nav link to /schedule-management
- [x] Stats row: Scheduled / Published / Failed counts

### Verification (4/4 PASSED)
- [x] V1: dateToCron("2 minutes from now") generates correct 6-field UTC cron string
- [x] V2: Publish success path → article=published, audit log written, notification created, heartbeat deleted
- [x] V3: Publish failure → retry in 15min, audit log written, no premature notification; retry failure → article=publish_failed, 2 audit entries, failure notification
- [x] V4: Cancel → heartbeat deleted, article=approved, audit log written

### Tests (16 new tests, 240/240 total pass)
- [x] Vitest: dateToCron (8 tests), cancelSchedule (4 tests), reschedule (3 tests), getAuditLog (2 tests), getNotifications (1 test), markNotificationRead (1 test), markAllRead (1 test)
- NOTE: Heartbeat jobs fire on the deployed site (production URL). simulatePublish tRPC procedure allows testing publish logic in dev without waiting for a heartbeat.

## Layer 10: User Dashboard

### Backend — tRPC procedures (server/routers/dashboard.ts)
- [x] dashboard.getSummary — returns for selected businessId: currentStage, article status counts (total, authority_ready, strong, needs_review, approved, scheduled, published, failed), credit balance, business name/industry/location
- [x] dashboard.getRecentActivity — returns last 10 actions across articles (generated, approved, published, failed, rescheduled) with timestamp, articleTitle, action, result
- [x] dashboard.listBusinesses — returns all businesses for the logged-in user (id, name, currentStage, article counts) for the multi-business switcher
- [x] Wire dashboardRouter into server/routers.ts

### Frontend — Dashboard page (client/src/pages/Dashboard.tsx — full rebuild)
- [x] Multi-business switcher: dropdown in header showing all user businesses; selecting one refreshes all dashboard data
- [x] Stage progress indicator: 5-stage pipeline showing complete/active/locked with correct current stage
- [x] Article status summary: stat cards for Total / Authority Ready / Strong / Needs Review / Approved / Scheduled / Published / Failed
- [x] Quick actions: context-aware buttons — Continue to Stage N, Review Articles, View Schedule, View Integrations
- [x] Credit balance display: shows remaining credits from DB (even if 0)
- [x] Recent activity feed: last 10 actions with icon, article title, action label, relative timestamp
- [x] Notifications panel: unread notifications from Layer 9 (publish success/failure) with mark-read and mark-all-read
- [x] Publishing calendar: mini month view showing articles on their scheduled publish dates
- [x] Loading skeletons for all panels while data fetches
- [x] Empty states for each panel (no articles yet, no notifications, no activity)

### Verification (5/5 PASSED)
- [x] V1: User with articles in mixed statuses — all counts display correctly (verified in test suite: 251/251)
- [x] V2: Stage progress indicator shows correct current stage (getSummary returns currentStage; quick action routes verified)
- [x] V3: Notifications from Layer 9 appear in notifications panel (scheduler.getNotifications wired; polls every 30s)
- [x] V4: Multi-business switcher updates all dashboard data when switching businesses (selectedBusinessId state drives all 3 queries)
- [x] V5: Credit balance displays (even if 0) (creditRow?.balance ?? 0 default confirmed in tests)

### Tests (11 new tests, 251/251 total pass)
- [x] Vitest: dashboard.getSummary (5 tests: correct counts, badge counts, credit=0, quick action stage 1, quick action stage 5, FORBIDDEN)
- [x] Vitest: dashboard.getRecentActivity (3 tests: returns entries with titles, empty array, FORBIDDEN)
- [x] Vitest: dashboard.listBusinesses (3 tests: empty, single business with counts, multiple businesses)

## Layer 11: Support Centre

### Help content data (shared/helpContent.ts)
- [x] 8 topic categories: Getting Started, Business Profile, Blog Architecture, Keyword Research, Article Generation, Review & Editing, Publishing & Scheduling, Account & Billing
- [x] ~3-5 articles per topic, each with: id, topicId, title, slug, body (content blocks), tags[]
- [x] Articles cover: 5-stage walkthrough, CMS connections (WordPress/Wix/Zapier), API keys/Application Passwords, 16-point Authority Standard, architecture types, publish failure recovery, credits

### Backend — tRPC procedures (server/routers/support.ts)
- [x] support.search — full-text search across article titles, body, and tags; returns matching articles with snippet
- [x] support.getArticle — return a single help article by slug
- [x] support.getTopics — return all topics with their article list (for sidebar navigation)
- [x] support.submitContactForm — validate name/email/subject/message, send email to rachel.m@noize.com.au via Resend, return success
- [x] Wire supportRouter into server/routers.ts

### Frontend — Support Centre page (client/src/pages/SupportCentre.tsx)
- [x] Route: /support — accessible from dashboard sidebar nav (HelpCircle icon)
- [x] Search bar at top — debounced, searches across all articles, shows results inline
- [x] Empty state for no search results — "No articles found for X. Try a different term or contact support."
- [x] Topic sidebar: 8 categories with article count badges
- [x] Article viewer: renders article body with headings, paragraphs, code blocks, tips, warnings
- [x] Contact form section: name, email, subject, message — submits via support.submitContactForm
- [x] Contact form success state: "Your message has been sent. We'll get back to you within 1 business day."
- [x] URL hash navigation: /support#article-slug opens the article directly (for contextual help links)
- [x] /support route registered in App.tsx
- [x] Dashboard sidebar nav link: "Help" with HelpCircle icon

### Contextual help icons (HelpCircle) in app pages
- [x] Shared HelpLink component: small HelpCircle icon that opens /support#article-slug in a new tab
- [x] Step1BusinessDetails.tsx: help icons on Industry, Target Audience, Brand Voice fields
- [x] Architecture.tsx: help icons on Cornerstone/Pillar/Cluster article type selector
- [x] Keywords.tsx: help icons on Keyword Research, PAA sections
- [x] ArticleReview.tsx: help icons on status badge, SEO score fields
- [x] PublishSchedule.tsx: help icons on publish cadence selector, scheduling calendar
- [x] Integrations.tsx: help icons on API Key, Application Password, SEO Plugin, Wix API Key fields

### Error messages with actionable next-step instructions
- [x] Integrations page: CMS connection errors include "Double-check your credentials and make sure your CMS is accessible" + help link
- [x] Article generation errors: include "Make sure your business profile and keyword research are complete" + HelpLink in error state
- [x] Publish failure errors: include "Check your CMS connection in Integrations and try again"
- [x] Keywords errors: include DataForSEO connection instructions
- [x] All error toasts include duration:8000ms so users have time to read the instruction

### Verification (5/5 PASSED — 26/26 sub-checks)
- [x] V1: Search for a term in a help article — results appear (searchHelpArticles("keyword") returns >0 results)
- [x] V2: Search for a non-existent term — empty array returned, UI shows empty state message
- [x] V3: HelpLink component used in 6/6 complex pages, navigates to /support#slug
- [x] V4: submitContactForm sends to rachel.m@noize.com.au via Resend, replyTo set to submitter email
- [x] V5: ArticleGeneration, Keywords, Integrations, PublishSchedule all have actionable error messages

### Tests (16 new tests, 267/267 total pass)
- [x] Vitest: searchHelpArticles (4 tests: known term, unknown term, case-insensitive, tag matching)
- [x] Vitest: getArticleSnippet (1 test)
- [x] Vitest: support.search (2 tests: results for known query, empty for unknown)
- [x] Vitest: support.getArticle (2 tests: valid slug, unknown slug)
- [x] Vitest: support.getTopics (1 test: 8 topics with articles)
- [x] Vitest: support.submitContactForm (4 tests: name missing, invalid email, message too short, success with mock)
- [x] Vitest: HELP_ARTICLES integrity (2 tests: unique slugs, valid topicIds)
