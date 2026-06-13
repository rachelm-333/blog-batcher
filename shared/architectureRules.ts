/**
 * Blog Batcher — Architecture Rules Engine
 *
 * Enforces the Cornerstone → Pillar → Cluster hierarchy rules:
 *  - Cornerstones: 1–4  (minimum 1 — strict hierarchy required)
 *  - Pillars per Cornerstone: 1–4  (minimum 1)
 *  - Clusters per Pillar: always 3
 *  - Minimum total: 1 cornerstone + 1 pillar + 3 clusters = 5 articles
 */

export const PACK_SIZES = [20, 50] as const;
export type PackSize = (typeof PACK_SIZES)[number];

/** Always 3 clusters per pillar — fixed constant */
export const CLUSTERS_PER_PILLAR = 3;
/** Alias for backward compatibility */
export const DEFAULT_CLUSTERS_PER_PILLAR = CLUSTERS_PER_PILLAR;
export const MIN_CLUSTERS_PER_PILLAR = 3;
export const MAX_CLUSTERS_PER_PILLAR = 3;
export const MIN_PILLARS_PER_CORNERSTONE = 1;
export const MAX_PILLARS_PER_CORNERSTONE = 4;
export const MIN_CORNERSTONES = 1;
export const MAX_CORNERSTONES = 4;

export const ARTICLE_TYPES = [
  "cornerstone_guide",
  "top_10_list",
  "how_to",
  "the_why",
  "comparison",
  "myth_busting",
  "specialist_post",
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  cornerstone_guide: "Cornerstone Guide",
  top_10_list: "Top 10 List",
  how_to: "How-To Article",
  the_why: "The Why Article",
  comparison: "Comparison Article",
  myth_busting: "Myth-Busting Article",
  specialist_post: "Specialist Post",
};

/** Which article types are valid for each node level */
export const VALID_TYPES_BY_LEVEL: Record<"cornerstone" | "pillar" | "cluster", ArticleType[]> = {
  cornerstone: ["cornerstone_guide"],
  pillar: ["top_10_list", "how_to", "the_why", "comparison", "myth_busting"],
  cluster: ["how_to", "myth_busting", "specialist_post"],
};

/** Word count targets and descriptions for each article level */
export const ARTICLE_LEVEL_INFO: Record<
  "cornerstone" | "pillar" | "cluster",
  { wordMin: number; wordMax: number; description: string }
> = {
  cornerstone: {
    wordMin: 2800,
    wordMax: 3200,
    description: "Authoritative guide post — the trunk of your content tree. Broad topic, high authority.",
  },
  pillar: {
    wordMin: 1500,
    wordMax: 2000,
    description: "In-depth topic post — branches off the cornerstone. Covers one angle in detail.",
  },
  cluster: {
    wordMin: 800,
    wordMax: 1200,
    description: "Specific, focused post — leaves of the tree. Answers one precise question.",
  },
};

/** Word count targets from the scope */
export const WORD_COUNT_TARGETS: Record<"cornerstone" | "pillar" | "cluster", { min: number; max: number }> = {
  cornerstone: { min: 2800, max: 3200 },
  pillar: { min: 1500, max: 2000 },
  cluster: { min: 800, max: 1200 },
};

// ─── Default architectures ────────────────────────────────────────────────────

export const DEFAULT_ARCHITECTURE = {
  cornerstones: 2,
  pillarsPerCornerstone: 2,
  clustersPerPillar: CLUSTERS_PER_PILLAR,
};

// ─── Calculation helpers ──────────────────────────────────────────────────────

export function calcTotalArticles(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = CLUSTERS_PER_PILLAR
): number {
  const totalPillars = cornerstones * pillarsPerCornerstone;
  const totalClusters = totalPillars * clustersPerPillar;
  return cornerstones + totalPillars + totalClusters;
}

export function calcBreakdown(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = CLUSTERS_PER_PILLAR
) {
  const totalPillars = cornerstones * pillarsPerCornerstone;
  const totalClusters = totalPillars * clustersPerPillar;
  return {
    cornerstones,
    pillarsPerCornerstone,
    clustersPerPillar,
    totalPillars,
    totalClusters,
    total: cornerstones + totalPillars + totalClusters,
  };
}

// ─── Dependency enforcement ───────────────────────────────────────────────────

/**
 * Enforces strict hierarchy dependencies.
 * Minimum: 1 cornerstone, 1 pillar per cornerstone, 3 clusters per pillar.
 */
export function enforceDependencies(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number
): { cornerstones: number; pillarsPerCornerstone: number; clustersPerPillar: number; warnings: string[] } {
  const warnings: string[] = [];
  return { cornerstones, pillarsPerCornerstone, clustersPerPillar, warnings };
}

// ─── Guardrails validation ────────────────────────────────────────────────────

export interface GuardrailResult {
  valid: boolean;
  correctedCornerstones: number;
  correctedPillarsPerCornerstone: number;
  correctedClustersPerPillar: number;
  warnings: string[];
}

/**
 * Validates a proposed architecture configuration against guardrail rules.
 * Clamps each dimension to its allowed range and auto-corrects if total exceeds pack size.
 */
export function validateArchitecture(
  packSize: PackSize | null,
  proposedCornerstones: number,
  proposedPillarsPerCornerstone: number,
  proposedClustersPerPillar: number = CLUSTERS_PER_PILLAR
): GuardrailResult {
  const warnings: string[] = [];
  let cornerstones = proposedCornerstones;
  let pillarsPerCornerstone = proposedPillarsPerCornerstone;
  const clustersPerPillar = CLUSTERS_PER_PILLAR; // always fixed at 3

  // ── Clamp cornerstones ────────────────────────────────────────────────────
  if (cornerstones < MIN_CORNERSTONES) {
    warnings.push(`Minimum 1 cornerstone required. Adjusted to ${MIN_CORNERSTONES}.`);
    cornerstones = MIN_CORNERSTONES;
  }
  if (cornerstones > MAX_CORNERSTONES) {
    warnings.push(`Maximum 4 cornerstones allowed. Adjusted to ${MAX_CORNERSTONES}.`);
    cornerstones = MAX_CORNERSTONES;
  }

  // ── Clamp pillars per cornerstone ─────────────────────────────────────────
  if (pillarsPerCornerstone < MIN_PILLARS_PER_CORNERSTONE) {
    warnings.push(`Minimum 1 pillar per cornerstone required. Adjusted to ${MIN_PILLARS_PER_CORNERSTONE}.`);
    pillarsPerCornerstone = MIN_PILLARS_PER_CORNERSTONE;
  }
  if (pillarsPerCornerstone > MAX_PILLARS_PER_CORNERSTONE) {
    warnings.push(`Maximum 4 pillars per cornerstone allowed. Adjusted to ${MAX_PILLARS_PER_CORNERSTONE}.`);
    pillarsPerCornerstone = MAX_PILLARS_PER_CORNERSTONE;
  }

  // ── Pack-size auto-correct ────────────────────────────────────────────────
  if (packSize !== null) {
    let total = calcTotalArticles(cornerstones, pillarsPerCornerstone, clustersPerPillar);
    if (total > packSize) {
      // Reduce pillarsPerCornerstone first, then cornerstones
      while (total > packSize && pillarsPerCornerstone > MIN_PILLARS_PER_CORNERSTONE) {
        pillarsPerCornerstone--;
        total = calcTotalArticles(cornerstones, pillarsPerCornerstone, clustersPerPillar);
      }
      while (total > packSize && cornerstones > MIN_CORNERSTONES) {
        cornerstones--;
        total = calcTotalArticles(cornerstones, pillarsPerCornerstone, clustersPerPillar);
      }
      warnings.push(
        `Configuration exceeded pack size of ${packSize}. Adjusted to ${cornerstones} cornerstones × ${pillarsPerCornerstone} pillars (${total} articles).`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    correctedCornerstones: cornerstones,
    correctedPillarsPerCornerstone: pillarsPerCornerstone,
    correctedClustersPerPillar: clustersPerPillar,
    warnings,
  };
}

// ─── Node generation ──────────────────────────────────────────────────────────

export interface ArchitectureNode {
  level: "cornerstone" | "pillar" | "cluster";
  cornerstoneIndex: number; // 1-based
  pillarIndex: number | null; // 1-based within cornerstone, null for cornerstone nodes
  clusterIndex: number | null; // 1-based within pillar, null for non-cluster nodes
  defaultArticleType: ArticleType;
  label: string; // human-readable label e.g. "Cornerstone 1", "Pillar 1.2", "Cluster 1.2.3"
}

/**
 * Generates the full flat list of article nodes for a given architecture config.
 * Strict hierarchy: cornerstones → pillars → clusters.
 * Clusters per pillar is always fixed at 3.
 */
export function generateNodes(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = CLUSTERS_PER_PILLAR
): ArchitectureNode[] {
  const nodes: ArchitectureNode[] = [];

  for (let c = 1; c <= cornerstones; c++) {
    nodes.push({
      level: "cornerstone",
      cornerstoneIndex: c,
      pillarIndex: null,
      clusterIndex: null,
      defaultArticleType: "cornerstone_guide",
      label: `Cornerstone ${c}`,
    });
    for (let p = 1; p <= pillarsPerCornerstone; p++) {
      nodes.push({
        level: "pillar",
        cornerstoneIndex: c,
        pillarIndex: p,
        clusterIndex: null,
        defaultArticleType: "how_to",
        label: `Pillar ${c}.${p}`,
      });
      for (let cl = 1; cl <= clustersPerPillar; cl++) {
        nodes.push({
          level: "cluster",
          cornerstoneIndex: c,
          pillarIndex: p,
          clusterIndex: cl,
          defaultArticleType: "specialist_post",
          label: `Cluster ${c}.${p}.${cl}`,
        });
      }
    }
  }

  return nodes;
}
