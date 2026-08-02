# Scope — AI-Citation + SEO Blog Machine (Keyword → Hub → Writing)

_Purpose: define everything this part of Blog Batcher must achieve, so it can be built into the existing software as a true AI-citation + SEO engine. Written for a developer / Claude Code session to plan the implementation._

---

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

### 2.3 Data-driven keyword selection (SEO-led, not just SEO-shaped)
Keywords must be **chosen because the data says they're worth ranking for**, not just because they sound relevant:
- AI proposes candidate keywords for each slot (grounded in the business's industry + services + the batch goal).
- Pull **real monthly search volume (MSV) + competition** for candidates (DataForSEO).
- **Select the best-opportunity terms** (meaningful volume, achievable competition); swap out zero/low-value ones.
- Result: "data-chosen, AI-structured" — genuinely SEO-led.

### 2.4 Secondary / LSI keywords per post
Every article targets **one primary keyword + 3–5 secondary/LSI (semantically-related) keywords**, woven in naturally for topical depth (helps rank for variations, reads as thorough to Google).

### 2.5 Titles are a contract
Titles are **proposed, reviewed, and approved before writing**. The writer must **100% deliver on the approved title** — no drift. Title, keyword, and content must always agree.

### 2.6 Batch purpose grounds everything
A short **batch goal** (e.g. "educate on brand architecture: what it is, how to use it in marketing, why") is set up front and **steers keyword selection, titles, and writing** so all posts serve one aim and read as one campaign — always kept **inside the business's real industry + services** (no drift to generic/unrelated topics).

### 2.7 AI-citation + SEO writing (GEO)
Each article is written to be **extractable and citable**:
- Answer-first blocks (question asked + answered in the opening / under each H2).
- H2s as real questions; lists + comparison data.
- Structured data (Article, Breadcrumb; FAQPage on cornerstone/pillars; HowTo on how-tos).
- Clean, skimmable formatting that survives on the customer's CMS (e.g. tables → bullet lists on Wix).

### 2.8 Internal linking (the "spoke" wiring)
Cornerstone ↔ pillars ↔ clusters are **internally linked** so authority flows through the cluster — with a **no-broken-links** guarantee (links only go live once their target post is published).

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

## 6. Open questions for the product owner

1. Cross-batch overlap: **hard block** (can't proceed) or **auto-replace** (system swaps in a distinct alternative)? 
2. Should starting a new batch **require fresh keyword research** (new seeds) rather than reusing the previous pool?
3. Opportunity scoring: what's the preferred balance of **volume vs competition** (e.g. favour low-competition long-tail, or chase a few higher-volume heads)?
4. How many total posts per batch is the target sweet spot (13 vs 19)?
