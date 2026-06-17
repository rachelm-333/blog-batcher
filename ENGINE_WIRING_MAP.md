# Blog Batcher — Article Engine Wiring Map

**Purpose:** This document maps every connection point between the article generation engine (`server/articleEngine.ts`) and the rest of the system. Use it as the integration contract when replacing the engine. No code was changed to produce this document.

---

## 1. INPUTS — What Data Flows INTO Generation

### 1.1 Entry Function

The replacement engine must expose this exact function signature:

```ts
export async function generateSingleArticle(
  businessId: number,
  nodeId: number,
  allOrderedNodes: OrderedNode[],
  userId?: number | null
): Promise<GenerationResult>
```

`allOrderedNodes` is the full ordered list for the batch (Cornerstone → Pillar → Cluster), pre-fetched by the caller. It is used to resolve parent/sibling URLs and to build the internal-link slug list. The `userId` is passed through for cost-tracking only; it is not used for access control inside the engine.

---

### 1.2 `buildArticleContext` — Full Return Shape

`buildArticleContext(businessId, nodeId, allOrderedNodes)` assembles every field the engine needs. The returned `ArticleContext` interface is:

| Field | Type | Source table / field |
|---|---|---|
| `businessName` | `string` | `businesses.name` |
| `industry` | `string` | `businesses.industry` |
| `location` | `string` | `businesses.location` |
| `uvp` | `string` | `businesses.uniqueValueProposition` |
| `socialProof` | `string` | Assembled from `businesses.yearsInBusiness`, `businesses.clientsServed`, `businesses.awardsAccreditations` |
| `voiceBrief` | `string` | `brand_voice.finalVoiceBrief` |
| `audiences` | `string[]` | `business_audiences.label` (all rows for this business) |
| `services` | `Array<{name, pageUrl?}>` | `business_services.name`, `business_services.pageUrl` |
| `ctaText` | `string` | `businesses.primaryCtaText` (fallback: `"Contact Us"`) |
| `ctaUrl` | `string` | `businesses.primaryCtaUrl` (fallback: `businesses.websiteUrl`) |
| `competitors` | `Array<{name, url?}>` | `business_competitors.name`, `business_competitors.websiteUrl` |
| `primaryKeyword` | `string` | `keywords.primaryKeyword` (row matched by `articleNodeId`) |
| `secondaryKeywords` | `string[]` | `keywords.secondaryKeywords` (JSON array, parsed) |
| `paaQuestion` | `string` | First item of `keywords.paaQuestions` JSON array |
| `articleType` | `string` | `article_nodes.articleType` |
| `level` | `"cornerstone" \| "pillar" \| "cluster"` | `article_nodes.level` |
| `wordCountMin` | `number` | Derived from `WORD_COUNT_RULES[level].min` |
| `wordCountMax` | `number` | Derived from `WORD_COUNT_RULES[level].max` |
| `urlSlug` | `string` | `article_nodes.urlSlug` (pre-generated before generation starts) |
| `parentCornerstoneUrl` | `string \| undefined` | `/${urlSlug}` of the node whose `id === article_nodes.parentCornerstoneId` |
| `parentPillarUrl` | `string \| undefined` | `/${urlSlug}` of the node whose `id === article_nodes.parentPillarId` |
| `siblingUrls` | `string[]` | `/${urlSlug}` of all cluster nodes sharing the same `parentPillarId` (excluding self) |
| `allBatchSlugs` | `string[]` | `/${urlSlug}` of every node in `allOrderedNodes` (up to 20 used in prompt) |
| `bookingsPageUrl` | `string \| undefined` | `businesses.bookingsPageUrl` |
| `contactPageUrl` | `string \| undefined` | `businesses.contactPageUrl` |
| `testimonialsPageUrl` | `string \| undefined` | `businesses.testimonialsPageUrl` |
| `shopUrl` | `string \| undefined` | `businesses.shopUrl` |
| `otherInternalLinks` | `Array<{label, url}> \| undefined` | `businesses.otherInternalLinks` (JSON) |
| `problemsSolved` | `string \| undefined` | `businesses.problems_solved` |
| `customerSituationBefore` | `string \| undefined` | `businesses.customer_situation_before` |
| `customerFrustrations` | `string \| undefined` | `businesses.customer_frustrations` |
| `customerTransformation` | `string \| undefined` | `businesses.customer_transformation` |
| `contentPlanDirection` | `string \| undefined` | `article_nodes.contentPlanDirection` |
| `linkedinUrl` | `string \| undefined` | `businesses.linkedinUrl` |
| `facebookUrl` | `string \| undefined` | `businesses.facebookUrl` |
| `instagramHandle` | `string \| undefined` | `businesses.instagramHandle` |

---

### 1.3 Keywords — Source Table and Fields

Keywords are stored in the `keywords` table, one row per `article_nodes.id`. The engine reads:

| Field | Purpose in generation |
|---|---|
| `keywords.primaryKeyword` | H1, H2, meta title, meta description, density checks |
| `keywords.secondaryKeywords` | JSON array of LSI keywords; passed into prompt |
| `keywords.paaQuestions` | JSON array; first item used as the opening answer block question |
| `keywords.approvedPaaQuestion` | Stored but not currently used by the engine (PAA approval is a gate, not a content field) |

---

### 1.4 Customer Intelligence — Source Fields

The three raw interview-answer fields come from the `businesses` table:

| DB column | `ArticleContext` field | Usage in prompt |
|---|---|---|
| `businesses.customer_situation_before` | `customerSituationBefore` | Opens the first body section ("If you've ever found yourself…") |
| `businesses.customer_frustrations` | `customerFrustrations` | Sections about common mistakes, what to avoid |
| `businesses.customer_transformation` | `customerTransformation` | Conclusion and CTA — what the reader can achieve |
| `businesses.problems_solved` | `problemsSolved` | Gate: if this field is non-empty, all four customer-intelligence fields are injected into the prompt |

---

### 1.5 `contentPlanDirection` — Source and Flow

`contentPlanDirection` originates in the Content Plan screen (Stage 3.5). The user edits a per-article direction field, which is saved to `article_nodes.contentPlanDirection` via `trpc.articles.saveContentPlanItem`. The engine reads it from `article_nodes.contentPlanDirection` through `buildArticleContext` and injects it into the prompt under the heading `WRITER DIRECTION FROM PUBLISHER`. It takes priority over general guidelines.

---

### 1.6 Internal-Link Slugs — Source and Flow

Real URL slugs are pre-generated before any article is written, via `preGenerateSlugs(businessId, batchNumber)`. This function:

1. Queries all `article_nodes` for the batch that have a null `urlSlug`.
2. Derives a slug from `keywords.primaryKeyword` using `generateSlug()`.
3. Writes the slug back to `article_nodes.urlSlug`.

The engine then reads slugs from `allOrderedNodes` (which was fetched after `preGenerateSlugs` ran). The prompt includes the full list of batch slugs so the LLM can insert real internal links — never placeholders.

---

### 1.7 `article_nodes` Fields Passed to the Engine

| `article_nodes` field | Used for |
|---|---|
| `id` | Node identity throughout the engine |
| `level` | Word count rules, FAQ schema eligibility, prompt framing |
| `articleType` | Article type label in prompt (e.g. "How-To Article", "Top 10 List") |
| `urlSlug` | Canonical URL for this article; injected into prompt |
| `parentCornerstoneId` | Resolves `parentCornerstoneUrl` for internal linking |
| `parentPillarId` | Resolves `parentPillarUrl` and sibling cluster URLs |
| `contentPlanDirection` | Per-article publisher direction (see §1.5) |
| `sortOrder` | Used by `getOrderedNodes` to sequence generation |

---

### 1.8 Current Year

The current year is **not** injected into the generation prompt by the engine. There is no `new Date().getFullYear()` call in `articleEngine.ts`. The year appears in the article only if the LLM includes it naturally or if the business's `yearsInBusiness` field is used in the social proof string.

---

## 2. OUTPUTS — What Generation Writes Back

### 2.1 `GenerationResult` — The Engine's Return Object

`generateSingleArticle` returns a `GenerationResult` object. The caller (`generateAndSave` in `server/routers/articles.ts`) maps every field directly to the `articles` table:

| `GenerationResult` field | `articles` DB column | Notes |
|---|---|---|
| `title` | `articles.title` | H1 heading |
| `metaTitle` | `articles.metaTitle` | Max 60 chars |
| `metaDescription` | `articles.metaDescription` | 140–160 chars |
| `bodyHtml` | `articles.bodyHtml` | Full article as clean HTML |
| `bodyMarkdown` | `articles.bodyMarkdown` | Full article as Markdown (for export) |
| `schemaMarkup` | `articles.schemaMarkup` | JSON-LD string |
| `faqItems` | `articles.faqItems` | `Array<{question, answer}>` for Cornerstone/Pillar; `null` for Cluster |
| `wordCount` | `articles.wordCount` | Integer word count of `bodyHtml` |
| `urlSlug` | `articles.urlSlug` | Lowercase hyphenated slug |
| `internalScore` | `articles.internalScore` | Pass 1 score (0–100) |
| `statusBadge` | `articles.statusBadge` | `"authority_ready"`, `"strong"`, or `"needs_review"` |
| `pass1Points` | `articles.pass1Details` (as `{ points, metrics }`) | `Record<string, boolean>` — per-check pass/fail |
| `pass1Metrics` | `articles.pass1Details` (as `{ points, metrics }`) | `Record<string, string>` — per-check detail strings |
| `pass2Score` | `articles.pass2Score` | AI quality score (0–100) |
| `pass2Reason` | `articles.pass2Details` | One-sentence explanation of the main weakness |

After saving the engine result, the caller also backfills:

- `articles.focusKeyword` ← `keywords.primaryKeyword` (separate query)
- `articles.status` ← `"generated"` (hard-coded by the caller, not the engine)
- `articles.approvedAt` ← `null` (cleared on regeneration)
- `articles.errorMessage` ← `null` (cleared on success)

---

### 2.2 `articles` Table — All Status Values

| Value | Set by | Meaning |
|---|---|---|
| `pending_generation` | `startGeneration` (batch init) | Article slot created, not yet started |
| `generating` | `generateAndSave` (start of each article) | LLM calls in progress |
| `generated` | `generateAndSave` (on success) | Engine finished, article ready for review |
| `pending_approval` | `updateStatus` mutation | User has marked it ready |
| `approved` | `updateStatus` mutation | User has approved for publishing |
| `scheduled` | Scheduling logic | Queued for CMS publish at a future time |
| `published` | CMS publish logic | Successfully published to CMS |
| `failed` | `generateAndSave` (on error) or server restart recovery | Generation or publish failed |

On server restart, any article stuck in `generating` or `pending_generation` is reset to `failed` with an explanatory `errorMessage` (handled in `server/_core/index.ts`).

---

### 2.3 What the Article Review Page Reads

The Article Review page (`client/src/pages/ArticleReview.tsx`) reads article data via two tRPC queries:

- **`trpc.articles.getAll`** — list view, polls every 4 seconds while any article is `generating` or `pending_generation`. Fields consumed: `id`, `title`, `status`, `statusBadge`, `internalScore`, `pass2Score`, `pass2Details`, `pass1Details`, `wordCount`, `level`, `articleType`, `urlSlug`, `focusKeyword`, `metaTitle`, `metaDescription`, `errorMessage`.
- **`trpc.articles.get`** — full article detail. Additional fields: `bodyHtml`, `bodyMarkdown`, `schemaMarkup`, `faqItems`, `approvedAt`, `scheduledPublishAt`, `publishedAt`, `cmsPostId`, `cmsPostUrl`, `imageUrl`, `imageAltText`.

The review page displays `pass2Details` when `pass2Score < 75`. It reads `pass1Details` in two shapes (legacy flat-boolean or the current `{ points, metrics }` object) and re-derives the 16-point checklist display from the stored data. The `statusBadge` field drives the badge colour and the "Needs Review" filter bucket.

---

## 3. TRIGGERS — What Calls Generation

### 3.1 Batch Start — `trpc.articles.startGeneration`

**Defined in:** `server/routers/articles.ts`  
**Called from:** `ArticleGeneration.tsx` via `trpc.articles.startGeneration.useMutation()`  
**Input:** `{ businessId: number }`

Pre-conditions checked before generation starts:

1. User owns the business.
2. `businesses.currentStage >= 4`.
3. Trial/credit guard — free trial not already used, or paid user has ≥ 1 credit.
4. `article_nodes` rows exist for the active batch.
5. All `keywords.keywordApproved` are `true`; all `keywords.paaApproved` are `true` where PAA questions exist.
6. No article in the batch is already `generating`.

If all checks pass:

1. `preGenerateSlugs(businessId, activeBatch)` — writes slugs to `article_nodes.urlSlug`.
2. `getOrderedNodes(businessId, activeBatch)` — returns nodes in Cornerstone → Pillar → Cluster order.
3. Inserts `articles` rows for any nodes that don't have one yet, with `status: "pending_generation"`.
4. Launches background work: `setImmediate(async () => { for (const node of orderedNodes) await generateAndSave(...) })`.
5. Returns immediately: `{ started: true, totalArticles: number, jobId: string }`.

After all articles complete, the batch handler advances `businesses.currentStage` to 5 and marks the free trial as used if applicable.

### 3.2 Single Regenerate — `trpc.articles.regenerate`

**Input:** `{ articleId: number }`  
**Behaviour:** Fetches the article's `businessId` and `articleNodeId`, gets the full ordered node list, then calls `setImmediate(() => generateAndSave(businessId, nodeId, orderedNodes, false))`. Returns `{ started: true }` immediately.

### 3.3 Bulk Under-Target Regenerate — `trpc.articles.regenerateUnderTarget`

**Input:** `{ businessId: number }`  
**Behaviour:** Finds all articles below their per-level word count minimum that are not currently `generating` or `approved`, then runs them sequentially in a `setImmediate` background loop.

### 3.4 Execution Model

All generation is **fire-and-forget via `setImmediate`**. The tRPC mutation returns immediately; the actual LLM work runs in the background. Articles are processed **one at a time, sequentially** — never in parallel.

### 3.5 Frontend Polling

The frontend detects completion by polling `trpc.articles.getAll` every 3–4 seconds while a local `generating` flag is `true`. The flag is cleared once no article row remains in `pending_generation` or `generating` status. The `ArticleGeneration.tsx` page also calls `trpc.articles.getGenerationStatus` which returns aggregate counts (`total`, `completed`, `failed`, `generating`, `isComplete`).

---

## 4. THE CHECKS THAT MUST SURVIVE

### 4.1 Pass 1 — Rules-Based SEO Scorer

**Function:** `runPass1Scorer(params)` — exported from `articleEngine.ts`  
**Type:** Pure synchronous function (no LLM call)

**Input parameters:**

| Parameter | Type |
|---|---|
| `bodyHtml` | `string` |
| `bodyMarkdown` | `string` |
| `title` | `string` |
| `metaTitle` | `string` |
| `metaDescription` | `string` |
| `urlSlug` | `string` |
| `wordCount` | `number` |
| `level` | `"cornerstone" \| "pillar" \| "cluster"` |
| `primaryKeyword` | `string` |
| `externalLinkPresent` | `boolean` |
| `internalCtaLinkPresent` | `boolean` |
| `internalBlogLinksPresent` | `boolean` |
| `schemaPresent` | `boolean` |

**Return type — `Pass1Result`:**

```ts
interface Pass1Result {
  score: number;           // 0–100 (each of 16 points ≈ 6.25 pts)
  points: Record<string, boolean>;   // e.g. { p1_keyword_density: true, p2_keyword_in_h1: false, ... }
  details: Record<string, string>;   // human-readable per-check detail strings
}
```

**Where it is called:** Inside `generateSingleArticle`, after all post-processing passes (scrub, expansion, mechanical enforcement). The result is passed directly into `GenerationResult` as `pass1Points` and `pass1Metrics`.

**The 16 check IDs** (keys in `points`): `p1_keyword_density`, `p2_keyword_in_h1`, `p3_keyword_in_h2`, `p4_keyword_in_h3`, `p5_keyword_first_100`, `p6_keyword_in_slug`, `p7_meta_title`, `p8_meta_description`, `p9_opening_answer`, `p10_external_link`, `p11_internal_cta`, `p12_internal_blog_links`, `p13_schema`, `p14_eeat`, `p15_human_authenticity`, `p16_word_count`.

**Badge thresholds (from `BADGE_THRESHOLDS`):**

| Badge | Pass 1 score threshold |
|---|---|
| `authority_ready` | ≥ 94 (≈ 15–16 / 16 checks passed) |
| `strong` | ≥ 81 (≈ 13–14 / 16 checks passed) |
| `needs_review` | < 81 (≤ 12 / 16 checks passed) |

The `ArticleReview.tsx` page mirrors this logic client-side in `computePass1Checks` to display the live checklist from stored `pass1Details`. Both the server scorer and the client mirror must remain in sync.

---

### 4.2 Pass 2 — AI Quality Scorer

**Function:** `runPass2Scorer(bodyHtml, primaryKeyword, userId?)` — exported from `articleEngine.ts`  
**Type:** Async function (makes one LLM call)

**Signature:**
```ts
export async function runPass2Scorer(
  bodyHtml: string,
  primaryKeyword: string,
  userId?: number | null
): Promise<{ score: number; reason: string }>
```

**Return type:** `{ score: number; reason: string }` where `score` is 0–100 and `reason` is a one-sentence explanation of the main weakness.

**Scoring criteria (5 dimensions × 20 pts each):**

| Dimension | Points |
|---|---|
| Search Intent Resolution | 20 |
| Human Authenticity | 20 |
| E-E-A-T Signals | 20 |
| Depth & Specificity | 20 |
| Clarity & Flow | 20 |

**Where it is called:** Inside `generateSingleArticle`, after Pass 1. If `pass2.score < 80`, the improvement loop runs up to 3 attempts, each injecting the exact scorer `reason` text into the improvement prompt. If the score is still < 80 after all attempts, `statusBadge` is overridden to `"needs_review"` regardless of Pass 1 score.

**Stored fields:**

- `articles.pass2Score` ← `pass2.score`
- `articles.pass2Details` ← `pass2.reason` (displayed in the review UI when `pass2Score < 75`)

---

## 5. SUMMARY — What the Replacement Engine Must Provide

The replacement engine must:

1. **Export `generateSingleArticle`** with the exact signature in §1.1 and return a `GenerationResult` object with all fields in §2.1.
2. **Call `buildArticleContext`** (or replicate its logic) to assemble the `ArticleContext` from the database before generating.
3. **Call `runPass1Scorer`** after generation and return `pass1Points` and `pass1Metrics` in the result.
4. **Call `runPass2Scorer`** after generation and return `pass2Score` and `pass2Reason` in the result.
5. **Derive `statusBadge` and `internalScore`** via `deriveStatusBadge(pass1.score, pass2.score)`, then override `statusBadge` to `"needs_review"` if `pass2.score < 80` after improvement attempts.
6. **Not change the caller** (`generateAndSave` in `server/routers/articles.ts`) — it handles all DB writes, status transitions, and `focusKeyword` backfill.
7. **Not change the two scorer functions** — they are tested independently and consumed by both the server and the client-side review page mirror.

The engine is a pure computation unit: it receives IDs, builds context, calls the LLM, runs post-processing, scores, and returns a typed result object. All persistence and status management lives in the caller.
