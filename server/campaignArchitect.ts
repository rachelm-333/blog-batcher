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
