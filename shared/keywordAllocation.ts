/**
 * keywordAllocation.ts — deterministic keyword → node allocation.
 *
 * Anchors the architecture to the user's chosen primary keyword:
 *   - The PRIMARY keyword (chosen on screen) → the cornerstone (the subject).
 *   - The next-broadest saved keywords → the 3 pillars (segments of the subject).
 *   - The most specific / long-tail saved keywords → the clusters (topics).
 *   - Any cluster slot with no saved keyword left is flagged for AI derivation
 *     (a distinct long-tail topic generated off its pillar's keyword).
 *
 * Pure + fully testable — no DB, no LLM. The server consumes the result:
 * keywords are written VERBATIM from the saved-selection strings, so the
 * "assigned vs unassigned" panel matches exactly (no fuzzy re-matching).
 */

export interface SelectionInput {
  /** selected_keywords.id */
  id: number;
  keyword: string;
  msv: number | null;
  /** user's display order from Step 8 (lower = earlier) */
  sortOrder: number;
}

export interface NodeInput {
  /** article_nodes.id */
  id: number;
  level: "cornerstone" | "pillar" | "cluster";
  parentCornerstoneId: number | null;
  parentPillarId: number | null;
  sortOrder: number;
}

export type AssignmentSource = "primary" | "pillar" | "cluster" | "ai-pending";

export interface Assignment {
  nodeId: number;
  level: "cornerstone" | "pillar" | "cluster";
  /** keyword to write to the node; null when source === "ai-pending" */
  keyword: string | null;
  /** the saved-selection row this came from; null for ai-pending slots */
  selectionId: number | null;
  source: AssignmentSource;
  /** for ai-pending cluster slots, the pillar node this cluster hangs off */
  pillarNodeId: number | null;
}

export interface AllocationResult {
  assignments: Assignment[];
  /** cluster nodes needing an AI-derived long-tail topic, grouped info inline */
  aiClusterSlots: Array<{ nodeId: number; pillarNodeId: number }>;
  /** selection ids actually placed onto a node */
  usedSelectionIds: number[];
}

const wordCount = (kw: string): number =>
  kw.trim().split(/\s+/).filter(Boolean).length;

/**
 * Broad-first comparator: fewer words = broader; tie-break on higher MSV.
 * Used to rank the pool so pillars take the broadest remaining terms and
 * clusters take the most specific.
 */
function byBreadthBroadFirst(a: SelectionInput, b: SelectionInput): number {
  const wc = wordCount(a.keyword) - wordCount(b.keyword);
  if (wc !== 0) return wc;
  return (b.msv ?? 0) - (a.msv ?? 0);
}

/**
 * Allocate saved keywords across the fixed architecture.
 *
 * @param selections  the user's saved keywords (Step 8)
 * @param nodes       article nodes for the batch (1 cornerstone, 3 pillars, clusters)
 * @param primarySelectionId  the saved keyword the user picked for the cornerstone;
 *                            falls back to the broadest selection if missing/invalid.
 */
export function allocateKeywords(
  selections: SelectionInput[],
  nodes: NodeInput[],
  primarySelectionId: number | null,
): AllocationResult {
  const assignments: Assignment[] = [];
  const aiClusterSlots: Array<{ nodeId: number; pillarNodeId: number }> = [];
  const usedSelectionIds: number[] = [];

  const cornerstones = nodes
    .filter((n) => n.level === "cornerstone")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const pillars = nodes
    .filter((n) => n.level === "pillar")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const clusters = nodes
    .filter((n) => n.level === "cluster")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Pool we can draw from; remove entries as they're consumed.
  const pool = [...selections];
  const take = (sel: SelectionInput) => {
    const idx = pool.findIndex((s) => s.id === sel.id);
    if (idx >= 0) pool.splice(idx, 1);
    usedSelectionIds.push(sel.id);
  };

  // ── Cornerstone ← the user's chosen primary (or broadest fallback) ──────────
  const cornerstone = cornerstones[0];
  if (cornerstone) {
    let primary =
      (primarySelectionId != null
        ? pool.find((s) => s.id === primarySelectionId)
        : undefined) ?? [...pool].sort(byBreadthBroadFirst)[0];
    if (primary) {
      take(primary);
      assignments.push({
        nodeId: cornerstone.id,
        level: "cornerstone",
        keyword: primary.keyword,
        selectionId: primary.id,
        source: "primary",
        pillarNodeId: null,
      });
    } else {
      assignments.push({
        nodeId: cornerstone.id,
        level: "cornerstone",
        keyword: null,
        selectionId: null,
        source: "ai-pending",
        pillarNodeId: null,
      });
    }
  }

  // ── Pillars ← next-broadest saved keywords (the segments) ───────────────────
  const broadFirst = [...pool].sort(byBreadthBroadFirst);
  for (const pillar of pillars) {
    const pick = broadFirst.find((s) => pool.some((p) => p.id === s.id));
    if (pick) {
      take(pick);
      assignments.push({
        nodeId: pillar.id,
        level: "pillar",
        keyword: pick.keyword,
        selectionId: pick.id,
        source: "pillar",
        pillarNodeId: null,
      });
    } else {
      // No saved keyword left for this pillar — flag for AI (off the cornerstone).
      assignments.push({
        nodeId: pillar.id,
        level: "pillar",
        keyword: null,
        selectionId: null,
        source: "ai-pending",
        pillarNodeId: null,
      });
    }
  }

  // ── Clusters ← most-specific saved keywords first; gaps → AI off the pillar ──
  const specificFirst = [...pool].sort((a, b) => -byBreadthBroadFirst(a, b));
  for (const cluster of clusters) {
    const pick = specificFirst.find((s) => pool.some((p) => p.id === s.id));
    if (pick) {
      take(pick);
      assignments.push({
        nodeId: cluster.id,
        level: "cluster",
        keyword: pick.keyword,
        selectionId: pick.id,
        source: "cluster",
        pillarNodeId: cluster.parentPillarId,
      });
    } else {
      assignments.push({
        nodeId: cluster.id,
        level: "cluster",
        keyword: null,
        selectionId: null,
        source: "ai-pending",
        pillarNodeId: cluster.parentPillarId,
      });
      if (cluster.parentPillarId != null) {
        aiClusterSlots.push({ nodeId: cluster.id, pillarNodeId: cluster.parentPillarId });
      }
    }
  }

  return { assignments, aiClusterSlots, usedSelectionIds };
}
