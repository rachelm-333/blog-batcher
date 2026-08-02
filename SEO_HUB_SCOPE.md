# Scope — AI-Citation + SEO Blog Machine (Keyword → Hub → Writing)

_Purpose: define everything this part of Blog Batcher must achieve, so it can be built into the existing software as a true AI-citation + SEO engine. Written for a developer / Claude Code session to plan the implementation._

---

## 0. ARCHITECTURE = 2-TIER (flat, no cornerstone) — CURRENT DIRECTION

The architecture is now **flat, 2 tiers only: Pillar Pages (broad topics) → Cluster Posts (specific sub-topics). NO cornerstone.**
- **Shape:** N pillars (default 3, user-selectable) × **3 clusters per pillar**.
- **Seeding:** Step 1 batch purpose + Step 2 theme keyword → system pulls real DataForSEO terms → builds the pillars + their 3 clusters (no cornerstone article).
- **Linking (2-tier protocol):** Cluster → links UP to its parent Pillar; Pillar → links DOWN to its 3 Clusters. Flat silos — no cross-pillar links, no cornerstone.
- **Schema:** FAQPage lives on **Pillars** (was cornerstone). Article + Author(Person) on every post.
- **Generation order:** Pillars first → their clusters.
- **Non-destructive:** applies to NEW batches; existing cornerstone batches remain valid.

**Writing formula (2-tier, per post) — every draft must:**
1. Keyword in slug (lowercase-hyphen), H1, first 150 words; secondary/LSI woven into H2/H3.
2. GEO: question-format H2/H3 headings; a 40–60 word standalone answer immediately under each; extractable tables/lists. Each **secondary keyword → a question H2/H3 + 40–60 word answer** (§2.6b).
3. 2-tier linking (above); `<a href>` only; descriptive exact/partial-match anchors (never "click here"); links contextual in the upper half.
4. **≥2 external** authoritative non-competing links; ≥1 image placeholder with descriptive keyword alt; JSON-LD Article + FAQ + Author schema.
5. E-E-A-T authority, no fluff/robotic transitions; scannable (subheads, bold, short paras, tables); **no nested bullet points**.

## 1. The vision

Turn a single **cornerstone keyword + a batch goal** into a **coherent, connected set of blog posts** (a topic cluster) that:
- **ranks on Google Page 1** (traditional SEO), and
- **gets cited by AI answer engines** (ChatGPT, Google AI Overviews, Perplexity — "GEO"),

…where **every batch a customer produces strengthens their site instead of competing with itself.**

The customer's job is the strategy (pick the cornerstone + state the goal). The machine does the SEO-correct structure, keyword selection, titles, and writing.

---

## 2. Non-negotiable requirements

### 2.1 Hub-and-spoke topic cluster (per batch)
Each batch is **1 cornerstone → 3 pillars → 3–5 clusters/pillar** (13–19 posts). Everything **builds off the cornerstone**:
- Cornerstone = broad head term, authority guide.
- Pillars = distinct **segments** of the cornerstone (never "what is / why" — those live inside the cornerstone).
- Clusters = specific **long-tail** questions/scenarios under each pillar.
- Distinct search intent at every level — **no two pages target the same query.**

### 2.2 ⚠️ Cross-batch non-competition via a CONTENT REGISTER (CRITICAL)
**Customers publish every batch on the same blog.** So batches must **never compete with each other** — no keyword, pillar, cluster, title, or slug in a new batch may match (or semantically overlap) ANYTHING used in an earlier batch. This is the #1 requirement.

**The mechanism = a per-business Content Register.** A permanent ledger that records, for every article ever built for that business (across all batches):
- primary keyword,
- secondary / long-tail keywords,
- article title,
- URL slug.

Every new build-out **must consult the register** and is **not allowed to reuse** anything in it:
- On keyword search/selection: exclude registered keywords (exact + semantic overlap) from candidates.
- On title/slug generation: exclude registered titles/slugs.
- New picks are **written back to the register** when the batch is confirmed.
- A new batch is steered toward **fresh territory / a different angle** of the customer's world.

Today the keywords table already records every batch's keywords (a de-facto partial register); this must be formalised to also cover **titles + slugs** and enforced as a **hard rule**, not a soft flag.

### 2.3 Data-BACKED keyword architecture (every level, from real data)
Every keyword at every level must be **backed by real DataForSEO data (volume + competition)** — primary, secondary/LSI, AND long-tail. AI structures; data proves demand. Concretely, using the existing DataForSEO functions:
- **Candidate pool:** `getKeywordSuggestions(goal + cornerstone)` → real related keywords WITH volume/competition.
- **Structure:** AI arranges only these **data-backed candidates** into cornerstone / pillars / clusters by relevance + the batch goal (never invents a keyword with no data).
- **Opportunity selection:** score candidates on volume vs competition; the **user chooses the target strategy** (high-volume / low-comp long-tail / medium-volume+low-comp — default medium+low). Show volume + competition on each so the choice is informed. Drop zero-value ones.
- **Validate:** `getKeywordData` confirms MSV/competition on the final picks.

### 2.4 Secondary / LSI + long-tail per post — FROM DATA (not invented)
Every article = **1 primary + 3–5 secondary/LSI keywords + long-tail**, all sourced from real data:
- **Secondary/LSI:** `getKeywordSuggestions(primary)` → pick top real related terms (by volume + relevance), excluding anything in the Content Register.
- **Long-tail:** real long-tail suggestions + **`getPAAQuestions`** (People Also Ask) for question-based terms.
- The writer weaves primary + secondaries + long-tail naturally for topical depth.
- ⚠️ Current state: secondary keywords are **AI-invented (no volume behind them)** and long-tail is AI-derived — this must move to the DataForSEO sources above.
- Note: DataForSEO calls cost money/time — batch requests and cache per business/batch.

### 2.5 Titles are a contract — and must be compelling (title rules)
Titles are **proposed, reviewed, and approved before writing**; the writer must **100% deliver on the approved title** — no drift. Title, keyword, and content must always agree. **AND every title must be worth clicking:**
- **Benefit / outcome-driven** — say what the reader gains, not just the topic. (❌ "Brand Architecture Implementation" → ✅ "How to Roll Out a Brand Architecture Without Confusing Your Customers".)
- **Specific & concrete** — real numbers, frameworks, or steps where genuine (no fake stats).
- **Instantly clear** — a reader understands the value in one glance.
- **Contains the keyword naturally**, but is NEVER just "[keyword]: The Complete Guide" for every post.
- **Intent + AI-citation** — phrased around a real question/need the article fully answers.

### 2.6 Keyword data rule — NO keyword without proven demand
Every keyword (primary especially) must have **real DataForSEO search volume**. Reject/replace any term with no or negligible volume (suggested floor: primaries ≥ ~30 MSV; clusters can be lower long-tail but must still register *some* volume or come from PAA). "—" (no data) keywords must not survive into the plan. This is enforced by the data-FIRST flow in §2.3 (source from data, don't invent-then-check).

### 2.6 Batch purpose grounds everything
A short **batch goal** (e.g. "educate on brand architecture: what it is, how to use it in marketing, why") is set up front and **steers keyword selection, titles, and writing** so all posts serve one aim and read as one campaign — always kept **inside the business's real industry + services** (no drift to generic/unrelated topics).

### 2.6b Secondary keywords become question H2/H3s + 40–60 word answers
Each **secondary/LSI keyword** must be turned into a **conversational question** used as an **H2 or H3 heading**, with a **40–60 word direct answer** immediately beneath (present tense, standalone, snippet-able). So every secondary keyword = one extractable Q&A block. This maps the secondaries onto the heading structure (not just sprinkled) and maximises AI-Overview / AI-engine citation. The writer prompt must enforce this mapping.

### 2.7 AI-citation + SEO writing (GEO)
Each article is written to be **extractable and citable**:
- Answer-first blocks (question asked + answered in the opening / under each H2).
- H2s as real questions; lists + comparison data.
- Structured data (Article, Breadcrumb; FAQPage on cornerstone/pillars; HowTo on how-tos).
- Clean, skimmable formatting that survives on the customer's CMS (e.g. tables → bullet lists on Wix).

### 2.8 Internal linking (the "spoke" wiring) — SILO-STRICT
Cornerstone ↔ pillars ↔ clusters are **internally linked** so authority flows through the cluster — with a **no-broken-links** guarantee (links only go live once their target post is published). **Silo discipline (industry best practice):**
- Every **cluster links UP to its pillar** (exact/partial-match anchor); every **pillar links DOWN to all its clusters**.
- **Spoke-to-spoke only within the same pillar** — clusters under Pillar 1 may link to each other, but **NOT** to clusters/pillars in Pillar 2 or 3 (no cross-pollination). Keep each silo tight.

### 2.9 The Keyword Map (the blueprint artifact)
The keyword architecture is a **data-driven Keyword Map** — the review screen should present it as such, one row per article, columns:
**Hierarchy Level · Target Slug · Primary Keyword · Search Volume · Keyword Difficulty (KD) · Secondary Keywords · Search Intent · Status · Internal-Links-To.**
This is the blueprint that prevents cannibalization and makes the whole 1-3-9(+) structure visible before a word is written.

### 2.10 Search Intent + Keyword Difficulty (metrics to add)
- **Search Intent** classified per keyword (Informational / Commercial / Transactional / Navigational / How-to). Used to (a) match each post's content type and (b) sharpen cannibalization checks (same term + same intent = same page).
- **Keyword Difficulty (KD)** — a numeric difficulty (DataForSEO has an endpoint) alongside volume, driving the opportunity score (favour good volume + low KD). Today we use DataForSEO *competition* (low/med/high) as a proxy; upgrade to numeric KD.
- **(Aspirational) SERP-overlap clustering** — the gold standard for cannibalization ("if two keywords return the same SERP, they belong on one page"). Needs ranking data (extra cost); our token-overlap check is the interim proxy.

---

## 3. What already exists today (starting point)

- ✅ Fixed hub shape (1×3×3–5), nodes created at the Architecture stage.
- ✅ Keyword assignment — manual (pick from saved keywords) **and** AI hub ("Build a coherent hub with AI": one cornerstone keyword + batch purpose → whole hierarchy, grounded in industry + services + goal).
- ✅ **Within-batch** cannibalization guard.
- ✅ **Cross-batch** guard — partial: AI-derived clusters avoid prior batches, and reused keywords are flagged on the review screen. (Not yet a hard block or opportunity-based re-selection.)
- ✅ DataForSEO MSV **validation** (after the AI picks) + low-volume flagging.
- ✅ Secondary/LSI keywords generated per node (AI hub path) and used by the writer.
- ✅ Batch purpose steers content-plan titles + writing.
- ✅ Titles: proposed on the Content Plan step, approved, and **honored** by the writer (`plannedTitle`).
- ✅ GEO writing (answer-first, schema, tables→lists on Wix), internal linking + auto-backfill, no-broken-links guarantee.

---

## 4. Gaps to close (the ask)

1. **Build the Content Register + make cross-batch non-competition airtight (2.2).** A per-business register of keywords + secondary/long-tail + titles + slugs across all batches. Move from "flag on review" to hard-block/auto-replace against the register; write new picks back on confirm; steer new batches to fresh territory. Priority #1 — posts share one blog.
2. **Data-driven selection (2.3).** Add the "AI proposes → DataForSEO scores → pick best-opportunity" loop so keyword choice is led by real volume/competition, not just semantics.
3. **Secondary keywords on the manual path too (2.4).** Currently populated only on the AI hub path; add to the manual assignment flow for parity.
4. **Opportunity view for the user.** Surface MSV + competition + an "opportunity" signal on the review screen so the user can make informed swaps.
5. **(Decision) Where the batch purpose lives** — currently on both Keyword and Content Plan steps (same value). Confirm the single source of truth.

---

## 5. Success criteria

- Two batches for the same business share **zero overlapping/competing keywords** (verifiable by a report).
- Every assigned keyword has **real search volume** and a visible competition/opportunity signal.
- Every article: one primary + 3–5 secondary keywords; title approved and delivered on.
- The set reads as **one coherent, interlinked cluster** on a single blog, each post distinct.
- Articles are structured for **both** Google Page 1 **and** AI-engine citation.

---

## 5e. The DataForSEO sequence (canonical method)

The keyword engine must follow this exact sequence (metrics always from DataForSEO — the LLM never invents numbers):
1. **Seed query** — from the business description + cornerstone, pull 50–100 real related terms, each with **Search Volume · Search Intent (Informational/Commercial/Transactional) · Keyword Difficulty (KD)**. Raw data only.
2. **Qualify** — remove KD > threshold (default 60), zero-volume, and competitor/brand-navigational queries; group the survivors semantically by intent (long-tail under their parent).
3. **Map** — from the *filtered* pool only, assign into the hub: cornerstone = highest-volume broadest parent; pillars = next tier of core categorical terms; clusters = specific lower-KD long-tail supporting their pillar. Output: Level · Slug · Primary · Volume · KD · Intent.
4. **GEO H2s** — for each cluster (and pillar), generate the conversational H2 question ("How do I…", "What is the best…") aligned to the keyword's intent, to trigger AI-Overview citations; feed these into the writer as required headings.

Single flow only: "Build Hub" (cornerstone in → data-first hub out). The legacy saved-pool Auto-Assign is removed (it reused terms across batches and ignored the goal).

## 6. Product decisions

1. **Cross-batch overlap → AUTO-REPLACE + notify. [DECIDED]** When a pick matches the Content Register, the system automatically swaps in the next-best data-backed alternative and tells the user, e.g.: *"'brand strategy' was already used in a previous post — to protect your SEO, we've selected the next best option: 'brand strategy framework'."* Never silently, never blocking.
2. **Opportunity scoring → USER CHOOSES THE STRATEGY. [DECIDED]** Present the options and let the user pick what to target per keyword/batch:
   - High volume (accept higher competition),
   - Low-competition long-tail (easier wins),
   - **Medium volume + low competition** (the balanced sweet spot).
   Show volume + competition on each candidate so the choice is informed; default to medium-volume/low-competition.
3. **Fresh research per batch → REUSE POOL by default; optional paid "Fresh research". [DECIDED]** A new batch reuses the existing keyword pool by default (no extra cost). A **"Run fresh keyword research"** option triggers a new DataForSEO search (goal + cornerstone → fresh candidates) but **consumes credits** (it's real API spend). Make the credit cost clear before running. This also gives billing a natural paid action.
4. **Posts per batch (13 vs 19) → OPEN.**
