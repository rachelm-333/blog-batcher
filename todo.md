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

## Layer 7: Stage 5 — Review
- [ ] Article review UI (left panel: article body, right panel: SEO fields)
- [ ] Inline editing of article body
- [ ] Technical SEO fields (slug, meta title, meta description, schema, FAQ)
- [ ] Image section (URL or upload)
- [ ] Approval flow

## Layer 8: Stage 5 — Publish
- [ ] WordPress CMS connection (REST API + Application Password)
- [ ] Wix, Shopify, Webflow, Squarespace, Ghost connections
- [ ] Zapier webhook integration
- [ ] Export ZIP package
- [ ] Publish failure handling and notifications

## Layer 9: Stage 5 — Schedule
- [ ] Publishing calendar UI
- [ ] Cadence selector (daily, every 2/3 days, weekly, twice weekly)
- [ ] Send articles to CMS as drafts with scheduled publish dates

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
