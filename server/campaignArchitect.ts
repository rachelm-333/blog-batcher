/**
 * campaignArchitect.ts — Module 10: Campaign Architect / Semantic Keyword Selector.
 *
 * Fixes the cluster-topic problem: instead of picking volume-ranked head terms
 * from a keyword pool, the LLM EXPANDS a broad topic into a Hub & Spoke matrix —
 * one broad pillar + N specific, distinct, long-tail cluster topics (the real
 * scenario/question searches). Cluster topics come from expanding the pillar,
 * not from a keyword tool.
 *
 * Pure helpers (prompt builder, parser, conflict check) are testable offline;
 * generateCampaignMatrix() orchestrates the single LLM call.
 */
import { invokeClaudeWithCost } from "./claudeLLM";
import { checkCannibalization } from "../shared/cannibalizationCheck";
import { RECOMMENDED_CLUSTERS_PER_PILLAR } from "../shared/architectureRules";

export interface CampaignInput {
  broadTopic: string;
  targetAudience: string;
  /** Number of cluster (spoke) posts. Defaults to the SEO-recommended 4. */
  clusterCount?: number;
}

export interface CampaignMatrix {
  pillar: { keyword: string; title: string };
  clusters: Array<{ keyword: string; title: string }>;
}

/** Build the strict matrix-generation prompt. Pure + testable. */
export function buildCampaignMatrixPrompt(input: CampaignInput): string {
  const count = input.clusterCount ?? RECOMMENDED_CLUSTERS_PER_PILLAR;
  return `You are an SEO Data Architect. Build a Topic Cluster around the broad concept "${input.broadTopic}" for the audience "${input.targetAudience}". Produce 1 Pillar Page and ${count} Cluster Pages.

RULES:
- Pillar Keyword: the broad, high-volume master term for the whole topic (1-4 words).
- Cluster Keywords: highly specific, long-tail derivatives — real scenario/question searches the audience makes (e.g. for "employment law": "how to handle continual lateness", "responding to a second written warning"). Each MUST be:
  - semantically related to the Pillar,
  - a SPECIFIC problem/scenario/question (not a broad head term),
  - COMPLETELY DISTINCT from every other cluster (no keyword cannibalization — no two clusters covering the same angle).
- Titles: compelling, specific article titles for each (the title may differ from the keyword).

Return ONLY valid JSON in exactly this shape:
{ "pillar": { "keyword": "...", "title": "..." }, "clusters": [ { "keyword": "...", "title": "..." } ] }
Produce exactly ${count} clusters.`;
}

/** Parse + validate the LLM's JSON matrix. Throws on invalid shape. Pure + testable. */
export function parseCampaignMatrix(raw: string): CampaignMatrix {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const data = JSON.parse(stripped);
  if (!data || typeof data !== "object") throw new Error("Matrix is not an object");
  const pillar = data.pillar;
  if (!pillar || typeof pillar.keyword !== "string" || typeof pillar.title !== "string") {
    throw new Error("Matrix missing a valid pillar { keyword, title }");
  }
  if (!Array.isArray(data.clusters) || data.clusters.length === 0) {
    throw new Error("Matrix missing clusters array");
  }
  const clusters = data.clusters.map((c: unknown, i: number) => {
    const cc = c as { keyword?: unknown; title?: unknown };
    if (typeof cc.keyword !== "string" || typeof cc.title !== "string") {
      throw new Error(`Cluster ${i} missing keyword/title`);
    }
    return { keyword: cc.keyword, title: cc.title };
  });
  return { pillar: { keyword: pillar.keyword, title: pillar.title }, clusters };
}

/**
 * Detect cannibalization within a matrix (pillar + clusters sharing too much).
 * Returns the conflicting cluster keywords. Pure + testable.
 */
export function findMatrixConflicts(matrix: CampaignMatrix): string[] {
  const entries = [
    { nodeId: 0, keyword: matrix.pillar.keyword },
    ...matrix.clusters.map((c, i) => ({ nodeId: i + 1, keyword: c.keyword })),
  ];
  const result = checkCannibalization(entries);
  const conflicting = new Set<string>();
  for (const c of result.conflicts) {
    // Only flag cluster-vs-cluster or cluster-vs-pillar overlaps
    if (c.nodeIdA > 0) conflicting.add(c.keywordA);
    if (c.nodeIdB > 0) conflicting.add(c.keywordB);
  }
  return Array.from(conflicting);
}

/**
 * Generate the full campaign matrix via one LLM call, then run a cannibalization
 * check. If clusters overlap, make ONE regeneration attempt asking for distinct
 * replacements. Returns the matrix + any residual conflict warnings.
 */
export async function generateCampaignMatrix(
  input: CampaignInput,
  userId?: number | null,
): Promise<{ matrix: CampaignMatrix; warnings: string[] }> {
  const callLLM = async (prompt: string): Promise<string> => {
    const res = await invokeClaudeWithCost(
      { messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 2000 },
      { userId, feature: "keyword_research" },
    );
    const c = res.choices[0]?.message?.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  };

  let matrix = parseCampaignMatrix(await callLLM(buildCampaignMatrixPrompt(input)));
  let conflicts = findMatrixConflicts(matrix);

  if (conflicts.length > 0) {
    const fixPrompt = `${buildCampaignMatrixPrompt(input)}\n\nThe following cluster keywords overlapped and cannibalize each other — regenerate the WHOLE matrix making every cluster completely distinct: ${conflicts.join(", ")}`;
    try {
      const retry = parseCampaignMatrix(await callLLM(fixPrompt));
      if (findMatrixConflicts(retry).length < conflicts.length) {
        matrix = retry;
        conflicts = findMatrixConflicts(retry);
      }
    } catch { /* keep first matrix if retry fails */ }
  }

  const warnings = conflicts.length > 0
    ? [`${conflicts.length} cluster keyword(s) may still overlap: ${conflicts.join(", ")}. Review before generating.`]
    : [];
  return { matrix, warnings };
}

// ===========================================================================
// FULL CORNERSTONE ARCHITECTURE (hub-and-spoke, one keyword → whole hierarchy)
// User provides ONLY the cornerstone (head) keyword. The AI expands it into the
// full 1 cornerstone → N pillars → M clusters/pillar hierarchy with titles,
// following strict SEO rules (distinct intent at every level, no cannibalization,
// avoid keywords already used in earlier batches).
// ===========================================================================

export interface CornerstoneArchInput {
  cornerstoneKeyword: string;
  targetAudience: string;
  businessName: string;
  industry?: string;
  /** The business's real services — hard grounding so topics can't drift off-industry. */
  services?: string[];
  /** Short business description / value proposition for extra grounding. */
  businessDescription?: string;
  /** The batch goal — every node must serve it (cohesion + on-topic guardrail). */
  batchPurpose?: string;
  pillarCount: number;          // fixed shape = 3
  clustersPerPillar: number;    // 3–5
  /** Secondary/LSI keywords to generate per node (default 4). */
  secondaryPerNode?: number;
  /** Keywords already used in earlier batches — must NOT be reused. */
  avoidKeywords?: string[];
}

export interface ArchNode {
  keyword: string;
  title: string;
  /** 3–5 semantically-related secondary/LSI keywords the article weaves in. */
  secondaryKeywords: string[];
}
export interface ArchPillar extends ArchNode {
  clusters: ArchNode[];
}
export interface CornerstoneArchitecture {
  cornerstone: ArchNode;
  pillars: ArchPillar[];
}

/** Build the strict, GROUNDED full-hierarchy prompt. Pure + testable. */
export function buildCornerstoneArchitecturePrompt(input: CornerstoneArchInput): string {
  const avoid = (input.avoidKeywords ?? []).filter(Boolean);
  const avoidText = avoid.length
    ? `\n- DO NOT reuse or semantically overlap with any of these keywords already used in earlier content (they would cannibalize existing posts): ${avoid.join(", ")}.`
    : "";
  const secondaryN = input.secondaryPerNode ?? 4;
  const services = (input.services ?? []).filter(Boolean);
  const grounding = [
    input.industry ? `Industry: ${input.industry}` : "",
    services.length ? `Services offered: ${services.join(", ")}` : "",
    input.businessDescription ? `About the business: ${input.businessDescription}` : "",
    input.batchPurpose ? `GOAL OF THIS BATCH (every article must serve this): ${input.batchPurpose}` : "",
  ].filter(Boolean).join("\n");

  return `You are an expert SEO content architect. Build a complete Hub-and-Spoke topic cluster for ${input.businessName}, whose audience is "${input.targetAudience}".

BUSINESS GROUNDING (you MUST stay strictly within this — do NOT drift to unrelated topics like generic "portfolios", "templates", or anything outside this business's world):
${grounding || "(no extra grounding provided)"}

The CORNERSTONE (head) keyword is: "${input.cornerstoneKeyword}".

Produce: 1 cornerstone, exactly ${input.pillarCount} pillars, and exactly ${input.clustersPerPillar} clusters per pillar. EVERYTHING must be a coherent sub-topic that builds off the cornerstone "${input.cornerstoneKeyword}" — a reader should see the whole set as one connected body of work on that topic.

STRICT SEO RULES (each level targets a MORE SPECIFIC, DISTINCT search intent — no two pages may compete for the same query):
- CORNERSTONE: keeps the head keyword "${input.cornerstoneKeyword}". Comprehensive authoritative guide (it internally covers "what is" and "why" — so those must NOT be separate pillars).
- PILLARS (${input.pillarCount}): each a BROAD, DISTINCT SEGMENT *of the cornerstone* (e.g. for "brand architecture": models / strategy / application). 2-4 words, broad enough to support ${input.clustersPerPillar} clusters. NEVER a "what is X"/"why X" question. NEVER the cornerstone term itself. Must clearly be a part of the cornerstone topic.
- CLUSTERS (${input.clustersPerPillar} per pillar): highly specific, long-tail questions/scenarios drilling into their pillar (3-6 words, real searches). Each completely distinct from every other cluster and pillar.
- SECONDARY KEYWORDS: for EVERY node, provide ${secondaryN} secondary/LSI keywords — semantically-related supporting terms the article will weave in for topical depth (NOT duplicates of the node's own keyword or other nodes' primary keywords).
- TITLES: benefit/outcome-driven (say what the reader GAINS — NOT "[keyword]: The Complete Guide"), specific & concrete, instantly clear, contains the keyword naturally but never a bare restatement, framed around a real question the article fully answers.${avoidText}

Return ONLY valid JSON in exactly this shape (no markdown fences):
{
  "cornerstone": { "keyword": "${input.cornerstoneKeyword}", "title": "...", "secondaryKeywords": ["...", "..."] },
  "pillars": [
    { "keyword": "...", "title": "...", "secondaryKeywords": ["..."], "clusters": [ { "keyword": "...", "title": "...", "secondaryKeywords": ["..."] } ] }
  ]
}
Exactly ${input.pillarCount} pillars, each with exactly ${input.clustersPerPillar} clusters, and ${secondaryN} secondaryKeywords on every node.`;
}

function parseSecondary(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

/** Parse + validate the full-hierarchy JSON. Throws on invalid shape. Pure + testable. */
export function parseCornerstoneArchitecture(
  raw: string,
  pillarCount: number,
  clustersPerPillar: number,
): CornerstoneArchitecture {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const data = JSON.parse(stripped);
  if (!data?.cornerstone || typeof data.cornerstone.keyword !== "string" || typeof data.cornerstone.title !== "string") {
    throw new Error("Missing valid cornerstone { keyword, title }");
  }
  if (!Array.isArray(data.pillars) || data.pillars.length === 0) throw new Error("Missing pillars array");
  const pillars: ArchPillar[] = data.pillars.map((p: any, i: number) => {
    if (typeof p?.keyword !== "string" || typeof p?.title !== "string") throw new Error(`Pillar ${i} missing keyword/title`);
    if (!Array.isArray(p.clusters)) throw new Error(`Pillar ${i} missing clusters`);
    const clusters: ArchNode[] = p.clusters.map((c: any, j: number) => {
      if (typeof c?.keyword !== "string" || typeof c?.title !== "string") throw new Error(`Cluster ${i}.${j} missing keyword/title`);
      return { keyword: c.keyword.trim(), title: c.title.trim(), secondaryKeywords: parseSecondary(c.secondaryKeywords) };
    });
    return { keyword: p.keyword.trim(), title: p.title.trim(), secondaryKeywords: parseSecondary(p.secondaryKeywords), clusters };
  });
  return {
    cornerstone: { keyword: data.cornerstone.keyword.trim(), title: data.cornerstone.title.trim(), secondaryKeywords: parseSecondary(data.cornerstone.secondaryKeywords) },
    pillars,
  };
}

/** Flatten all keywords in the hierarchy into cannibalization entries (index = position). */
export function architectureConflicts(arch: CornerstoneArchitecture): string[] {
  const entries: Array<{ nodeId: number; keyword: string }> = [];
  let idx = 0;
  entries.push({ nodeId: idx++, keyword: arch.cornerstone.keyword });
  for (const p of arch.pillars) {
    entries.push({ nodeId: idx++, keyword: p.keyword });
    for (const c of p.clusters) entries.push({ nodeId: idx++, keyword: c.keyword });
  }
  const result = checkCannibalization(entries);
  const byId = new Map(entries.map((e) => [e.nodeId, e.keyword]));
  const conflicting = new Set<string>();
  for (const c of result.conflicts) {
    if (byId.has(c.nodeIdA)) conflicting.add(byId.get(c.nodeIdA)!);
    if (byId.has(c.nodeIdB)) conflicting.add(byId.get(c.nodeIdB)!);
  }
  return Array.from(conflicting);
}

/** Generate the full hierarchy via one LLM call, then a cannibalization pass + one repair. */
export async function generateCornerstoneArchitecture(
  input: CornerstoneArchInput,
  userId?: number | null,
): Promise<{ architecture: CornerstoneArchitecture; warnings: string[] }> {
  const callLLM = async (prompt: string): Promise<string> => {
    const res = await invokeClaudeWithCost(
      { messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 3000 },
      { userId, feature: "keyword_research" },
    );
    const c = res.choices[0]?.message?.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  };

  let arch = parseCornerstoneArchitecture(
    await callLLM(buildCornerstoneArchitecturePrompt(input)),
    input.pillarCount, input.clustersPerPillar,
  );
  let conflicts = architectureConflicts(arch);

  if (conflicts.length > 0) {
    const fixPrompt = `${buildCornerstoneArchitecturePrompt(input)}\n\nThese keywords overlapped and cannibalize each other — regenerate the WHOLE hierarchy making every keyword completely distinct: ${conflicts.join(", ")}`;
    try {
      const retry = parseCornerstoneArchitecture(await callLLM(fixPrompt), input.pillarCount, input.clustersPerPillar);
      if (architectureConflicts(retry).length < conflicts.length) { arch = retry; conflicts = architectureConflicts(retry); }
    } catch { /* keep first */ }
  }

  const warnings = conflicts.length > 0
    ? [`${conflicts.length} keyword(s) may still overlap: ${conflicts.join(", ")}. Review before generating.`]
    : [];
  return { architecture: arch, warnings };
}

// ===========================================================================
// DATA-FIRST HUB — organise a REAL DataForSEO keyword pool into the hierarchy.
// Instead of inventing keywords (which mostly return no search volume), the AI
// SELECTS from a pool of keywords that already have proven demand, and only
// writes the titles + picks secondary terms. Enforces the title rules (§2.5).
// ===========================================================================

export interface PoolCandidate {
  keyword: string;
  msv: number | null;
  competition: "high" | "medium" | "low" | null;
}

const TITLE_RULES = `TITLE RULES (every title must be worth clicking — NOT "[keyword]: The Complete Guide"):
- Benefit/outcome-driven: say what the reader GAINS (e.g. "How to Roll Out Brand Architecture Without Confusing Customers"), not just the topic.
- Specific & concrete: real steps/frameworks/numbers where genuine (never fabricate stats).
- Instantly clear: understandable in one glance.
- Contains the keyword naturally, but is never a bare "[keyword]" restatement.
- Framed around a real question/need the article fully answers (for AI-citation).`;

/** Build the data-first prompt: select + organise from a real keyword pool. */
export function buildHubFromPoolPrompt(input: CornerstoneArchInput, pool: PoolCandidate[]): string {
  const secondaryN = input.secondaryPerNode ?? 4;
  const services = (input.services ?? []).filter(Boolean);
  const grounding = [
    input.industry ? `Industry: ${input.industry}` : "",
    services.length ? `Services: ${services.join(", ")}` : "",
    input.businessDescription ? `About: ${input.businessDescription}` : "",
    input.batchPurpose ? `GOAL OF THIS BATCH (every article must serve this): ${input.batchPurpose}` : "",
  ].filter(Boolean).join("\n");
  const poolText = pool
    .map((p) => `- "${p.keyword}" (volume: ${p.msv ?? "?"}, competition: ${p.competition ?? "?"})`)
    .join("\n");
  const strategy = input.batchPurpose ? "" : "";

  return `You are an expert SEO content architect for ${input.businessName}. Audience: "${input.targetAudience}".

${grounding}

CORNERSTONE (head) keyword: "${input.cornerstoneKeyword}".

Below is a list of REAL keywords with actual search volume (from a keyword tool). You MUST build the hub by SELECTING from THIS LIST — do NOT invent keywords that aren't here (invented keywords have no proven demand):

CANDIDATE KEYWORDS:
${poolText || "(none — you may fall back to the cornerstone only)"}

Build exactly ${input.pillarCount} pillars and ${input.clustersPerPillar} clusters per pillar, ALL selected from the candidates, all coherently building off "${input.cornerstoneKeyword}". ASSIGN BY TIER:
- CORNERSTONE = the head term "${input.cornerstoneKeyword}" (broadest, highest volume).
- PILLARS = the NEXT TIER of higher-volume, broad categorical candidates that are distinct segments of the cornerstone.
- CLUSTERS = specific, LOWER-competition long-tail candidates (questions/scenarios) under the right pillar — these can have lower volume; that's expected and good (easy-win long-tail).
- Distinct search intent at every level (no two target the same query).
- SECONDARY KEYWORDS: for each node, choose ${secondaryN} OTHER candidates from the list that are semantically related (do not repeat any node's primary).
- NEVER use competitor- or brand-navigational queries (e.g. "Apple brand architecture", "Nike ...") as a primary keyword for any node — those are examples to mention inside articles, not article targets. You MAY use them as secondary keywords.
${TITLE_RULES}

Return ONLY valid JSON (no fences):
{
  "cornerstone": { "keyword": "${input.cornerstoneKeyword}", "title": "...", "secondaryKeywords": ["..."] },
  "pillars": [ { "keyword": "...", "title": "...", "secondaryKeywords": ["..."], "clusters": [ { "keyword": "...", "title": "...", "secondaryKeywords": ["..."] } ] } ]
}
Exactly ${input.pillarCount} pillars, each with ${input.clustersPerPillar} clusters.${strategy}`;
}

/** Generate the hub by organising a real keyword pool (data-first). */
export async function generateHubFromPool(
  input: CornerstoneArchInput,
  pool: PoolCandidate[],
  userId?: number | null,
): Promise<{ architecture: CornerstoneArchitecture; warnings: string[] }> {
  const callLLM = async (prompt: string): Promise<string> => {
    const res = await invokeClaudeWithCost(
      { messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 3000 },
      { userId, feature: "keyword_research" },
    );
    const c = res.choices[0]?.message?.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  };
  const arch = parseCornerstoneArchitecture(
    await callLLM(buildHubFromPoolPrompt(input, pool)),
    input.pillarCount, input.clustersPerPillar,
  );
  const conflicts = architectureConflicts(arch);
  const warnings = conflicts.length > 0
    ? [`${conflicts.length} keyword(s) may still overlap: ${conflicts.join(", ")}.`]
    : [];
  return { architecture: arch, warnings };
}

// ===========================================================================
// FLAT 2-TIER HUB — Pillars → Clusters only (NO cornerstone). Each pillar's
// clusters are forced into DISTINCT formats (A–E) for strict anti-cannibalization.
// Selects from a real DataForSEO pool (data-first). Pure prompt/parse + generator.
// ===========================================================================

export const CLUSTER_FORMATS = [
  { key: "how_to", label: "How-To (step-by-step tutorial)" },
  { key: "comparison", label: "Comparison (X vs Y / alternatives)" },
  { key: "top_10_list", label: "Listicle/Examples (roundup, tools, stats)" },
  { key: "specialist_post", label: "Troubleshooting (fix a specific problem)" },
  { key: "the_why", label: "Cost/ROI (pricing, value, investment)" },
] as const;

export interface FlatNode { keyword: string; title: string; secondaryKeywords: string[]; format?: string; }
export interface FlatPillar extends FlatNode { clusters: FlatNode[]; }
export interface FlatArchitecture { pillars: FlatPillar[]; }

export interface FlatHubInput {
  themeKeyword: string;        // seeds the topic; NOT a cornerstone page
  targetAudience: string;
  businessName: string;
  industry?: string;
  services?: string[];
  businessDescription?: string;
  batchPurpose?: string;
  pillarCount: number;         // default 3
  clustersPerPillar: number;   // e.g. 3
  secondaryPerNode?: number;
  avoidKeywords?: string[];
}

/** Build the flat 2-tier prompt from a real keyword pool. Pure + testable. */
export function buildFlatHubPrompt(input: FlatHubInput, pool: PoolCandidate[]): string {
  const secondaryN = input.secondaryPerNode ?? 4;
  const services = (input.services ?? []).filter(Boolean);
  const grounding = [
    input.industry ? `Industry: ${input.industry}` : "",
    services.length ? `Services: ${services.join(", ")}` : "",
    input.businessDescription ? `About: ${input.businessDescription}` : "",
    input.batchPurpose ? `GOAL OF THIS BATCH (every article must serve this): ${input.batchPurpose}` : "",
  ].filter(Boolean).join("\n");
  const poolText = pool.map((p) => `- "${p.keyword}" (volume: ${p.msv ?? "?"}, competition: ${p.competition ?? "?"})`).join("\n");
  const avoid = (input.avoidKeywords ?? []).filter(Boolean);
  const avoidText = avoid.length ? `\n- Never reuse or overlap with these (used in earlier batches): ${avoid.join(", ")}.` : "";
  const formatList = CLUSTER_FORMATS.map((f, i) => `  ${String.fromCharCode(65 + i)} — ${f.label} (article type: ${f.key})`).join("\n");

  return `You are an expert SEO content architect for ${input.businessName}. Audience: "${input.targetAudience}".

${grounding}

Theme keyword: "${input.themeKeyword}". Build a FLAT 2-TIER structure — Pillar Pages (broad topics) and Cluster Posts (specific sub-topics) only. THERE IS NO CORNERSTONE.

Below are REAL keywords with actual search volume. You MUST SELECT from THIS LIST — do NOT invent keywords (invented ones have no proven demand):
CANDIDATE KEYWORDS:
${poolText || "(none)"}

Produce exactly ${input.pillarCount} pillars, each with exactly ${input.clustersPerPillar} clusters, all from the candidates and coherent with the theme.
- PILLARS = the broadest, higher-volume distinct topics.
- CLUSTERS = specific long-tail candidates under the right pillar.
STRICT ANTI-CANNIBALIZATION — every cluster under a pillar MUST use a DIFFERENT format (never the same format twice under one pillar), each a distinct search intent (no two share a SERP). Formats:
${formatList}
Assign a "format" article-type key to EACH cluster (from the list) and to each pillar (pillars use "how_to" or "the_why" or "top_10_list" as fits).
- SECONDARY KEYWORDS: ${secondaryN} per node, chosen from OTHER candidates, semantically related, no repeats of any primary.
${TITLE_RULES}${avoidText}

Return ONLY valid JSON (no fences):
{
  "pillars": [
    { "keyword": "...", "title": "...", "format": "how_to", "secondaryKeywords": ["..."],
      "clusters": [ { "keyword": "...", "title": "...", "format": "comparison", "secondaryKeywords": ["..."] } ] }
  ]
}
Exactly ${input.pillarCount} pillars, each with ${input.clustersPerPillar} clusters, every cluster a UNIQUE format within its pillar.`;
}

/** Parse + validate the flat 2-tier JSON. Throws on invalid shape. Pure + testable. */
export function parseFlatHub(raw: string, pillarCount: number, clustersPerPillar: number): FlatArchitecture {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const data = JSON.parse(stripped);
  if (!Array.isArray(data?.pillars) || data.pillars.length === 0) throw new Error("Missing pillars array");
  const validFormats = new Set(CLUSTER_FORMATS.map((f) => f.key));
  const pillars: FlatPillar[] = data.pillars.map((p: any, i: number) => {
    if (typeof p?.keyword !== "string" || typeof p?.title !== "string") throw new Error(`Pillar ${i} missing keyword/title`);
    if (!Array.isArray(p.clusters)) throw new Error(`Pillar ${i} missing clusters`);
    const clusters: FlatNode[] = p.clusters.map((c: any, j: number) => {
      if (typeof c?.keyword !== "string" || typeof c?.title !== "string") throw new Error(`Cluster ${i}.${j} missing keyword/title`);
      return {
        keyword: c.keyword.trim(), title: c.title.trim(),
        secondaryKeywords: parseSecondary(c.secondaryKeywords),
        format: validFormats.has(c.format) ? c.format : "specialist_post",
      };
    });
    return {
      keyword: p.keyword.trim(), title: p.title.trim(),
      secondaryKeywords: parseSecondary(p.secondaryKeywords),
      format: validFormats.has(p.format) ? p.format : "how_to",
      clusters,
    };
  });
  return { pillars };
}

/** Detect duplicate formats within any pillar (anti-cannibalization check). Pure. */
export function flatFormatConflicts(arch: FlatArchitecture): string[] {
  const issues: string[] = [];
  arch.pillars.forEach((p, i) => {
    const seen = new Set<string>();
    for (const c of p.clusters) {
      const f = c.format ?? "specialist_post";
      if (seen.has(f)) issues.push(`Pillar ${i + 1} "${p.keyword}" reuses format "${f}"`);
      seen.add(f);
    }
  });
  return issues;
}

/** Generate the flat 2-tier hub from a real pool (data-first), one repair on format clashes. */
export async function generateFlatHub(
  input: FlatHubInput,
  pool: PoolCandidate[],
  userId?: number | null,
): Promise<{ architecture: FlatArchitecture; warnings: string[] }> {
  const callLLM = async (prompt: string): Promise<string> => {
    const res = await invokeClaudeWithCost(
      { messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: 3500 },
      { userId, feature: "keyword_research" },
    );
    const c = res.choices[0]?.message?.content;
    return typeof c === "string" ? c : JSON.stringify(c);
  };
  let arch = parseFlatHub(await callLLM(buildFlatHubPrompt(input, pool)), input.pillarCount, input.clustersPerPillar);
  let clashes = flatFormatConflicts(arch);
  if (clashes.length) {
    const fix = `${buildFlatHubPrompt(input, pool)}\n\nThese pillars reused a cluster format — regenerate so every cluster under a pillar uses a DIFFERENT format: ${clashes.join("; ")}`;
    try { const retry = parseFlatHub(await callLLM(fix), input.pillarCount, input.clustersPerPillar); if (flatFormatConflicts(retry).length < clashes.length) { arch = retry; clashes = flatFormatConflicts(retry); } } catch { /* keep */ }
  }
  const warnings = clashes.length ? [`Some clusters may share a format: ${clashes.join("; ")}`] : [];
  return { architecture: arch, warnings };
}
