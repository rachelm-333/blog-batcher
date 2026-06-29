# SEO & GEO Content Platform — Master Spec (Source of Truth)

This is the contract. Every item is built against this file, with a test per item.
Status: ✅ Done · 🔨 In progress · ⬜ To-do

Two billable modes on one shared core engine:
- **Creator** — generate new posts that score ~100/100.
- **Auditor** — audit a live URL / pasted post, score it, auto-fix.

Two deployments, same code: **ProDesk suite app** + **standalone**.

---

## A. The 29-Point Weighted Audit Engine (/100) — ✅ BUILT
Shared core used by BOTH modes. `server/auditEngine/` — rules verbatim from the
Gemini schema, weights sum to 100, cheerio analyzer + scorer, 12 tests.
Returns `{ total_score, normalized_score, failed_checks[], checks[] }`.
Live-only checks (MAC-12 CWV, MAC-13 llms.txt) normalize out when no URL.

| Phase | Checks | Points |
|---|---|---|
| Macro Architecture | MAC-01..13 | 40 |
| Micro Architecture | MIC-01..08 | 35 |
| E-E-A-T & Voice | EAT-01..08 | 25 |

Full rule list + weights live in `server/auditEngine/auditRules.ts` (do not edit weights without updating this spec).

---

## B. The Content Generator (writes to score 100) — 🔨 PARTIAL
Existing engine: `server/articleEngine.ts`. Upgrade to the Gemini "Master
Generation Prompt". Each item verified by generating a real article and running
it through the 29-point engine.

| ID | Requirement | Status |
|---|---|---|
| GEN-01 | Pre-gen inputs: primary keyword, target audience, ≥1 Non-Commodity Data item | ⬜ |
| GEN-02 | AI blocklist (delve, tapestry, bustling, testament, crucial, landscape, realm, beacon, seamless, navigating the complexities, moreover, firstly, in conclusion) | 🔨 most banned; add missing |
| GEN-03 | Active voice | 🔨 |
| GEN-04 | Paragraph density ≤4 sentences (~80–100 words) | ⬜ enforce + post-process |
| GEN-05 | First-hand experience phrasing — sourced from Fact Bank, never fabricated | ⬜ |
| GEN-06 | Integrate user Non-Commodity Data organically | ⬜ |
| GEN-07 | Exactly one H1 with keyword | ✅ |
| GEN-08 | ≥50% H2s framed as questions | 🔨 enforce |
| GEN-09 | Answer-first 40–60 words after EVERY H2 | ⬜ (only opening block today) |
| GEN-10 | Lists `<ul>/<ol>`; `<table>` when comparing 2+ items | ⬜ enforce |
| GEN-11 | H3 actionable sub-steps | 🔨 |
| GEN-12 | Hub-and-spoke internal link, exact-match anchor (see D) | ⬜ |
| GEN-13 | 1–2 outbound authority links via DataForSEO (see Module 7.1) | ⬜ |
| GEN-14 | URL slug `/category/primary-keyword`, strip stop words + dates | ⬜ |
| GEN-15 | Meta title ≤60 w/ keyword; meta desc ≤160 w/ keyword | ✅ |
| GEN-16 | Schema: Article/BlogPosting + Organization + Person(author) + FAQPage from H2 Q + answer paragraphs | 🔨 have Article+FAQPage; add Org+Person |

---

## C. Fact Bank / E-E-A-T Section — ⬜ TO-DO
Business-level (set up once, reused). A workflow section that educates + collects
verified facts so E-E-A-T is grounded, never invented.

| ID | Requirement | Status |
|---|---|---|
| FB-01 | Education panel: what E-E-A-T is + why it matters for SEO/GEO | ⬜ |
| FB-02 | "Build My Fact Bank" button: scrape website + blog → LLM EXTRACTS facts (verbatim) with source URL | ⬜ |
| FB-03 | Review list: approve / edit / delete auto-extracted facts | ⬜ |
| FB-04 | "Additional" section: manual add of stats, case studies, experiences, expert quotes | ⬜ |
| FB-05 | Fact Bank DB table (text, type, source, verified, addedBy) | ⬜ |
| FB-06 | Per-topic retrieval → injected into generator as "VERIFIED FACTS — use only these" | ⬜ |
| FB-07 | Social media: NO auto-scrape (ToS/fragile) — manual paste/add only | ⬜ |

---

## D. Hub-and-Spoke Internal Linking — ⬜ TO-DO
Upward linking only, to real published URLs (never 404). Resolved at PUBLISH time
using the parent's actual CMS URL.

| ID | Requirement | Status |
|---|---|---|
| LINK-01 | Cluster links UP to its Pillar; Pillar links UP to its Cornerstone; Cornerstone links to nothing above | ⬜ |
| LINK-02 | Link inserted only if parent is already published (real live URL) | ✅ resolvePublishLinks (logic) · ⬜ publish wiring |
| LINK-03 | Use the parent's real CMS URL (Wix `/post/`, WordPress `/blog/…`) — never a guessed path | ✅ resolvePublishLinks (logic) · ⬜ publish wiring |
| LINK-04 | If parent not published → no link + warn the user | ✅ resolvePublishLinks (logic) · ⬜ publish wiring |
| LINK-08 | Publish-flow wiring: build linkMap (each batch slug → cmsPostUrl or null), call resolvePublishLinks before CMS conversion | ⬜ app integration |
| LINK-05 | Exact-match anchor text = parent's primary keyword (satisfies MAC-09) | ✅ variable-injection + insertHubLink guarantee |
| LINK-06 | Link validator (already fixed) strips any non-allowlisted/invented link | ✅ |
| LINK-07 | Variable injection: force-feed {{PILLAR_URL}}+{{PILLAR_KEYWORDS}} into prompt + few-shot good/bad anchor examples | ✅ |

## C2. Content Mapping — Cluster Topic Generation (Problem 1) — ⬜ TO-DO
Keyword tools surface head terms, NOT the specific problem/scenario sub-topics clusters need.
| ID | Requirement | Status |
|---|---|---|
| MAP-01 | Cornerstone/Pillar = head keyword from DataForSEO (volume) | ✅ exists |
| MAP-02 | Clusters = AI-generated specific sub-topics/scenarios under the pillar ("how to handle continual lateness"), NOT a picked head keyword | ⬜ |
| MAP-03 | Optionally validate generated cluster topics against PAA/keyword data | ⬜ |

## Generation gate (close model variance) — ⬜ TO-DO
| ID | Requirement | Status |
|---|---|---|
| GATE-AUDIT-01 | After generation + deterministic fixes, run the 29-point auditHtml(); if specific checks fail (lists, first-hand), run ONE targeted micro-fix so every article reliably scores high | ⬜ |

---

## E. Module 7.1 — DataForSEO Real Authority Links — ⬜ TO-DO
Replace model-invented external links with real ranking authoritative URLs.
Reuses existing DataForSEO integration (creds already configured).

| ID | Requirement | Status |
|---|---|---|
| DFS-01 | POST `/v3/serp/google/organic/live/advanced`, Basic Auth, location_code 2036 (AU), depth 10 | ⬜ |
| DFS-02 | Query builder: `[claim] (site:.gov OR site:.edu OR site:gartner.com OR site:pewresearch.org)` | ⬜ |
| DFS-03 | Use top real results as EAT-05/EAT-06 outbound authority links | ⬜ |
| DFS-04 | Call ≤2× per article (cost control) | ⬜ |

---

## F. Auditor & Auto-Fixer Mode — ⬜ TO-DO
Second billable mode. Same 29-point engine.

| ID | Requirement | Status |
|---|---|---|
| AUD-01 | Input: paste raw post OR fetch a live URL | ⬜ |
| AUD-02 | Score via `auditHtml()` (the shared engine) → /100 + per-check breakdown | ✅ engine ready |
| AUD-03 | Live checks: Core Web Vitals (PageSpeed API) + llms.txt fetch | ⬜ |
| AUD-04 | 1-click auto-fix per failed check (rewrite only the failed component) | ⬜ |
| AUD-05 | Output: fixed body + meta + JSON-LD + deployment checklist | ⬜ |

---

## G. Editing & Live Re-Scoring — 🔨 PARTIAL
| ID | Requirement | Status |
|---|---|---|
| EDIT-01 | Edit body, SEO fields, AI-edit instruction, Save Draft before publish | ✅ |
| EDIT-02 | Re-audit live on edit/save → score updates in real time against the 29 points | ⬜ |

---

## H. Platform / Business Model — ⬜ TO-DO
| ID | Requirement | Status |
|---|---|---|
| PLAT-01 | One shared core engine; Creator + Auditor as modes on top | 🔨 |
| PLAT-02 | Separate billing SKUs: Audit credits + Creation credits (Stripe already integrated) | ⬜ |
| PLAT-03 | Deployable embedded in ProDesk suite | 🔨 (already branded) |
| PLAT-04 | Deployable standalone (needs own auth — currently Manus OAuth coupling) | ⬜ |

---

## Module 8 — Link Anti-Sabotage Gatekeeper — ✅ BUILT (engine)
`server/auditEngine/linkGatekeeper.ts` — pre-publish hard gatekeeper. Returns
blocking ERRORS + auto-fixed HTML. 10 tests. **Wiring:** call before publish/export;
block the action if `errors.length > 0`.

| ID | Rule | Action | Status |
|---|---|---|---|
| GATE-01 | Internal anchor == primary keyword | ERROR (cannibalization) | ✅ |
| GATE-02 | Generic anchor (click here/read more/learn more/link) | ERROR | ✅ |
| GATE-03 | External anchor == primary keyword | ERROR (keyword bleed) | ✅ |
| GATE-04 | First external link within first 100 words | ERROR (early exit) | ✅ |
| GATE-05 | External anchor is a naked URL (http/www) | ERROR | ✅ |
| GATE-06 | Link to a competitor domain (competitor_blocklist) | ERROR | ✅ |
| GATE-07 | External TLD in spam list (.info/.biz/.tk/.xyz…) | ERROR | ✅ |
| GATE-08 | External links missing target=_blank / rel=noopener | AUTO-FIX (inject) | ✅ |
| GATE-09 | Orphan prevention (no incoming link in sitemap) | needs CMS sitemap | ⬜ |
| GATE-10 | Wire gatekeeper into publish/export (block on errors) + UI errors | app integration | ⬜ |

## Module 9 — Performance & State (app integration) — ⬜ TO-DO
| ID | Requirement | Status |
|---|---|---|
| PERF-01 | DataForSEO result cache (Redis or DB table), 30-day TTL | ⬜ |
| PERF-02 | Tier 1 instant (DOM/regex/word counts) vs Tier 2 background (NLP, DataForSEO) via queue | ⬜ |
| PERF-03 | Skeleton/"Analyzing claims…" UX while Tier 2 runs | ⬜ |
| PERF-04 | Debounced live audit in editor (1500ms after typing stops) | ⬜ |

## Module 10 — Campaign Architect (semantic clustering) — ⬜ TO-DO
Fixes Problem 1 (cluster topics from keyword tools are wrong). LLM generates the Hub & Spoke matrix.
| ID | Requirement | Status |
|---|---|---|
| CAMP-00 | Series minimum: recommend 4–5 clusters, advisory warning at 1–3, 0 = deliberate standalone (RECOMMENDED_CLUSTERS_PER_PILLAR=4, getClusterSeriesWarning) | ✅ constants + warning |
| CAMP-01 | Input UI: Broad_Topic, Target_Audience, Cluster_Count (default 4) | ⬜ |
| CAMP-02 | LLM matrix: 1 pillar (broad term) + N distinct long-tail clusters as JSON | ✅ generateCampaignMatrix (verified on real run) |
| CAMP-03 | Cannibalization guard: run clusters through cannibalizationCheck, regenerate overlaps | ✅ findMatrixConflicts + 1 retry |
| CAMP-04 | Hybrid: validate pillar term volume via DataForSEO | ⬜ |
| CAMP-05 | Save Campaign_Instance to DB | ⬜ |

## Module 11 — Retroactive Link Debt Manager — ⬜ TO-DO
Publish-state link management. UP link already built; this adds DOWN links + state loop.
| ID | Requirement | Status |
|---|---|---|
| DEBT-01 | Track status (Draft/Published) + live_url per pillar & cluster | ✅ DB has status + cmsPostUrl |
| DEBT-02 | UP-link enforcer (cluster→pillar exact anchor; pending queue if pillar unpublished) | ✅ variable injection + resolvePublishLinks |
| DEBT-03 | DOWN-link snippet generator (40-word intro + exact cluster-keyword anchor → cluster URL) | ⬜ core buildable now |
| DEBT-04 | On cluster publish: if pillar is on a SUPPORTED connector → AUTO-UPDATE the live pillar via CMS API (primary path) | ⬜ needs per-connector "update post" op |
| DEBT-05 | If pillar on an UNSUPPORTED platform → copy-paste HTML alert (LAST-RESORT fallback only) | ⬜ |

## Build order (phased)
1. **B. Generator** → write to 100 (verify with the 29-point engine on real generations)
2. **C. Fact Bank** → grounds E-E-A-T (unblocks GEN-05/06 + EAT checks)
3. **E. DataForSEO links** → real authority links (EAT-05/06)
4. **D. Internal linking** → publish-safe hub-and-spoke
5. **G. Live re-scoring** in the editor
6. **F. Auditor mode** → second billable product
7. **H. Billing + standalone auth**
