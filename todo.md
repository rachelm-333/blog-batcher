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
- [ ] Business profile UI (all fields from Section 3.2)
- [ ] AI-powered website scrape via Claude
- [ ] Brand voice builder (archetypes, persona, extracted voice, final brief)
- [ ] Social proof / E-E-A-T fields
- [ ] Competitor research section
- [ ] Publishing platform selector (CMS + SEO plugin)
- [ ] Save profile to DB, re-scan button

## Layer 4: Stage 2 — Blog Architecture
- [ ] Pack selection UI (20 or 50 articles)
- [ ] Architecture rules engine (Cornerstone → Pillar → Cluster)
- [ ] Visual architecture map (tree diagram)
- [ ] Slider-based adjustments with real-time guardrails
- [ ] Article type selection per pillar
- [ ] Save architecture to DB

## Layer 5: Stage 3 — SEO Keyword Research
- [ ] DataForSEO API integration
- [ ] Keyword assignment per article slot
- [ ] Cannibalization check
- [ ] People Also Ask (PAA) research
- [ ] Keyword review and approval UI
- [ ] PAA approval UI

## Layer 6: Stage 4 — Article Generation
- [ ] Article generation queue (one at a time per user)
- [ ] Claude prompt builder (all 16-point Authority Standard context)
- [ ] AI fingerprint scrub pass
- [ ] Rules-based scoring (Pass 1)
- [ ] AI quality scoring (Pass 2)
- [ ] Status badge system (Authority Ready / Strong / Needs Review)
- [ ] Progress visibility UI
- [ ] Auto-regeneration for articles below threshold

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
