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
 * Return the sorted set of meaningful tokens (stop-words removed).
 * Two keywords are semantically overlapping if their token sets are identical.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "how", "what",
  "when", "where", "why", "who", "which", "that", "this", "these", "those",
]);

function tokenSet(kw: string): string {
  return normalise(kw)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .sort()
    .join("|");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface KeywordEntry {
  nodeId: number;
  keyword: string;
}

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

      // Semantic overlap: same tokens, different order
      const tokA = tokenSet(a.keyword);
      const tokB = tokenSet(b.keyword);

      if (tokA.length > 0 && tokA === tokB) {
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
