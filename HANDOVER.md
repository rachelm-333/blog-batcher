# Blog Batcher — Handover Notes

_Last updated: 2026-07-30. Repo: github.com/rachelm-333/blog-batcher. Runs on Manus (`tsx watch server/_core/index.ts`), pulls from GitHub. Stack: React 19 + Vite + tRPC 11 + Drizzle (MySQL/TiDB), OpenRouter for generation, Wix Blog API v3 for publishing._

This doc covers the state as of the July 2026 hardening pass. For deeper history see `SEO_GEO_SPEC.md`.

---

## 1. Wix-specific behaviours a dev MUST know

Wix is the primary CMS and has three quirks that caused most of the recent bugs. All are handled in `server/cmsPublisher.ts`.

### 1a. Tables don't render — we convert them to bullet lists
Wix's blog renderer **silently drops** Ricos `TABLE` nodes (tried the documented `tableCellData`/`borderColors` schema — still dropped; the Ricos convert API 403s because the API key lacks the `DC-RICOS` scope). 
- **Fix:** `htmlToRicos()` converts every `<table>` into a **bold-label bulleted list** (`<strong>label</strong> — Header: value; …`). Extraction happens before block parsing (placeholder swap) so wrapper-flattening (`<figure>`/`<div>`) can't strip it.
- **Generation also changed:** rule G3 (`server/articleEngine.ts`) now tells the model to produce bold-label lists and **never** emit `<table>`. So new posts have no tables at source; the publish-time converter remains as a backstop for legacy posts.
- Other CMSes (WordPress, Shopify, etc.) keep real HTML tables — their renderers handle `<table>`.
- Tests: `server/htmlToRicosTable.test.ts`.

### 1b. Schema (JSON-LD) goes into `seoData.tags`, not the body
Ricos can't hold `<script>`, so structured data is attached via the draft post's `seoData.tags` as a `type: "script"` / `application/ld+json` tag.
- **Critical format:** Wix tags use the field **`disabled`** (NOT `isDisabled`) and every tag needs a **`children`** string. Wrong field names → Wix silently ignores the tag. (This was the bug that made FAQPage not appear.)
- Schema is attached **only on a fresh publish** (`publishToWix`). The "re-sync links" path (`updateWixPostBody`) patches `richContent` only — it does NOT add schema. So to (re)apply schema, reset + publish.
- The Wix editor's **"Structured data markup"** panel shows only Wix's *native* Article markup; our custom JSON-LD lands in the custom-tags slot and won't appear in that panel. **Verify with Google Rich Results Test on the LIVE url**, not the editor panel.
- ⚠️ **OPEN / UNVERIFIED:** readback (`getWixSeo.ts`) confirms Wix *stores* the FAQPage tag on the draft, but we have **not yet confirmed it renders on the live page** via Rich Results Test. If it doesn't render, switch to Wix's native structured-data mechanism. **First test to run at handover.**
- Wix rejects structured data **> 7,000 chars** (per-article schema is well under this).

### 1c. Post URLs & scheduling
- Wix v3 omits the post `url` unless you request `?fieldsets=URL`; stored `cmsPostId` is a **draft** id that won't resolve, so `resolveWixPublishedUrl` falls back to list-and-match-by-title.
- **Wix has no scheduling API.** Scheduled Wix posts use a **Manus-hosted cron ("Heartbeat/Forge")** job (`server/_core/heartbeat.ts`, `server/schedulerService.ts`) that fires on the date and calls `publishToWix`. Needs env `BUILT_IN_FORGE_API_URL` + `BUILT_IN_FORGE_API_KEY`.
  - ⚠️ **This is Manus-infra-specific.** When moving off Manus (e.g. to Render), scheduling must be re-wired to the new host's scheduler (or a self-hosted cron). It will silently break otherwise.
  - Known intermittent failure: "Failed to create publish schedule" = the Forge call failed. The generic message hides the real cause; the true error (status + detail) is logged as `[publishSingle] Failed to create Heartbeat job:`. Usually transient — retry works.

---

## 2. Schema rules (structured data)

Enforced in `server/articleEngine.ts` (Step 2.9 FAQPage, Step 2.10 HowTo) and gated by article level:

| Article level | Article | BreadcrumbList | Organization | FAQPage | HowTo |
|---|---|---|---|---|---|
| Cornerstone | ✅ | ✅ | ✅ | ✅ | – |
| Pillar | ✅ | ✅ | ✅ | ✅ | ✅ (if `how_to`) |
| Cluster | ✅ | ✅ | ✅ | ❌ (never) | ✅ (if `how_to`) |

- **Clusters must never have FAQPage** — they have no visible FAQ, and FAQPage schema without matching on-page Q&A is a Google structured-data violation. `stripFaqFromSchema()` enforces this; `scripts/repairClusterSchema.ts` fixed the existing 15.
- FAQ *content* (visible Q&A) is likewise cornerstone/pillar only.

---

## 3. Architecture (fixed shape)

Exactly **1 cornerstone × 3 pillars × 3–5 clusters/pillar** (13–19 total, 19 max). Constants in `shared/architectureRules.ts`. No multi-cornerstone / standalone modes.

Word counts: cornerstone 2,500–3,000 · pillar 1,500–1,800 · cluster 800–1,200 (`WORD_COUNT_RULES`).

Internal linking: publish-time resolution + auto-backfill, with a **no-broken-links guarantee** (`resolveBodyForPublish` / `server/publishLinkResolver.ts`) — any internal link that isn't a real published post or known business page is dropped to plain text so a 404 never goes live.

---

## 4. Verification scripts (run on Manus: `node --import tsx scripts/<name>`)

Only operational tools remain (spent one-off diagnostics were removed):
- `verifyGeneration.ts` — real-generation quality check (needs OpenRouter key).
- `diagnoseLinks.ts` — confirm every published post's links resolve.
- `resetPublishState.ts --confirm` — published → approved, clears Wix ids (to republish).
- `resetForRegeneration.ts` — clears generated output to regenerate.
- `resetBlogs.ts --confirm` — full blog wipe (keeps business profiles).

---

## 5. Known open items / launch gate

1. **Verify FAQPage renders on a LIVE Wix post** via Google Rich Results Test (see 1b). Highest priority — decides whether the seoData method is sufficient.
2. **Rotate the OpenRouter API key** — it was exposed in chat; rotate at openrouter.ai and update the Manus/host secret. `.env` is gitignored.
3. **Scheduling is Manus-infra-tied** (see 1c) — re-wire when moving hosts.
4. ✅ **Done** — debug scaffolding removed from `client/src/pages/PublishSchedule.tsx` (backfill preview, "Apply to this post (test)", diagnostics box, "Fix links" re-sync). Auto-backfill still runs automatically at publish. The `previewBackfill` / `applyBackfillOne` tRPC procedures remain on the server (unused by UI now) — a dev can delete them if desired.
5. **Existing 19 posts** were generated under the old rule (tables in source, converted to bullets at Wix publish). New posts generate as bullets. Regenerate the 19 only if you want bullets in the source everywhere.
6. WordPress publish is not live-tested; Shopify/Webflow/Squarespace/Ghost route via Zapier.
8. **Data consistency: `articles.batchNumber` vs `articleNodes.batchNumber`.** Today's resets left these two out of sync for the SKT business (articles=1, nodes≠1). All queries now scope by `articles.batchNumber` consistently (getAll, dashboard), so it's not user-visible — but a dev may want a one-off script to realign `articleNodes.batchNumber` to the linked article's batch, and to check the reset/regeneration scripts don't reintroduce the drift.

7. ✅ **Done** — batch switcher added. `activeBatch` is now the *currently viewed* batch (not just the highest). `business.batchInfo` returns `{activeBatch, maxBatch}`; `business.setActiveBatch` switches it (lands on Stage 6, fully editable). The "Batch N" label in the sidebar is now a dropdown (1..maxBatch). `startNewBatch` bases the new batch on the true max, so it's correct even when viewing an older batch.

---

## 6. Workflow rule

Fixes go through code review + tests, then push to GitHub; the runner **pulls** — it must not edit code (two editors on one repo caused hours of divergence). If a dev-tool popup offers "Fix it / Fix All," don't use it on the running instance.
