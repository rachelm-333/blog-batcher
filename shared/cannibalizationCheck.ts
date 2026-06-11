/**
 * Cannibalization detection engine for Blog Batcher Stage 3.
 *
 * Rules (from Master Scope):
 *   - Zero tolerance for exact duplicate keywords (case-insensitive, normalised)
 *   - Semantic overlap warning when two keywords share the same core tokens
 *     in different word orders (e.g. "Gold Coast marketing agency" vs
 *     "marketing agency Gold Coast")
 *   - Distinct keywords that share a word but have different intent are NOT
 *     flagged (e.g. "growth agency Gold Coast" vs "marketing agency Gold Coast")
 *
 * Detection logic:
 *   - Exact duplicate: normalised strings are identical → always flagged
 *   - Semantic overlap: Jaccard similarity of meaningful token sets >= 0.75
 *     This means at least 75% of the unique meaningful words are shared.
 *     Example: "psychosocial hazards worksafe" (tokens: psychosocial, hazards, worksafe)
 *              "psychosocial hazards in the workplace" (tokens: psychosocial, hazards, workplace)
 *              Intersection = {psychosocial, hazards} = 2
 *              Union = {psychosocial, hazards, worksafe, workplace} = 4
 *              Jaccard = 2/4 = 0.50 → NOT flagged (below 0.75 threshold)
 *
 *     Example: "psychosocial hazards" vs "hazards psychosocial"
 *              Intersection = {psychosocial, hazards} = 2
 *              Union = {psychosocial, hazards} = 2
 *              Jaccard = 2/2 = 1.0 → flagged (identical token sets)
 *
 * Returns a list of conflict pairs so the UI can highlight them.
 */

export interface CannibalizationConflict {
  nodeIdA: number;
  keywordA: string;
  nodeIdB: number;
  keywordB: string;
  type: "exact_duplicate" | "semantic_overlap";
}

export interface CannibalizationResult {
  hasConflicts: boolean;
  conflicts: CannibalizationConflict[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a keyword: lowercase, strip punctuation, collapse whitespace. */
function normalise(kw: string): string {
  return kw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Common English stop words that carry no semantic meaning on their own.
 * Removed from token sets before comparison.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "how", "what",
  "when", "where", "why", "who", "which", "that", "this", "these", "those",
  "your", "our", "my", "their", "its", "all", "any", "some", "no", "not",
  "vs", "versus", "vs", "get", "make", "use", "using", "used",
]);

/** Return the set of meaningful tokens for a keyword. */
function tokenSet(kw: string): Set<string> {
  const tokens = normalise(kw)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/**
 * Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 if both sets are empty.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  Array.from(a).forEach((t) => {
    if (b.has(t)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface KeywordEntry {
  nodeId: number;
  keyword: string;
}

/**
 * Minimum Jaccard similarity to trigger a semantic_overlap warning.
 * 0.75 means 75% of the unique meaningful tokens must be shared.
 * This prevents false positives like "psychosocial hazards worksafe" vs
 * "psychosocial hazards in the workplace" (which share only 2/4 tokens = 0.50).
 */
const SEMANTIC_OVERLAP_THRESHOLD = 0.75;

export function checkCannibalization(
  entries: KeywordEntry[]
): CannibalizationResult {
  const conflicts: CannibalizationConflict[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;

      const normA = normalise(a.keyword);
      const normB = normalise(b.keyword);

      // Exact duplicate (after normalisation)
      if (normA === normB) {
        conflicts.push({
          nodeIdA: a.nodeId,
          keywordA: a.keyword,
          nodeIdB: b.nodeId,
          keywordB: b.keyword,
          type: "exact_duplicate",
        });
        continue;
      }

      // Semantic overlap: Jaccard similarity of meaningful token sets
      const tokA = tokenSet(a.keyword);
      const tokB = tokenSet(b.keyword);

      // Skip if either keyword has no meaningful tokens (e.g. very short phrases)
      if (tokA.size === 0 || tokB.size === 0) continue;

      const similarity = jaccardSimilarity(tokA, tokB);

      if (similarity >= SEMANTIC_OVERLAP_THRESHOLD) {
        conflicts.push({
          nodeIdA: a.nodeId,
          keywordA: a.keyword,
          nodeIdB: b.nodeId,
          keywordB: b.keyword,
          type: "semantic_overlap",
        });
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}
