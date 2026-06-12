/**
 * Blog Batcher — Architecture Rules Engine
 *
 * Enforces the Cornerstone → Pillar → Cluster hierarchy rules:
 *  - Cornerstones: 0–5  (0 = pillar-only mode, no cornerstone)
 *  - Pillars per Cornerstone: 0–5  (0 = cornerstone-only, no pillars)
 *  - Clusters per Pillar: 0–5  (0 = no clusters)
 *  - Dependency rule: clusters require pillars; pillars require cornerstones
 *  - No fixed pack size — total is determined by the three sliders
 */

export const PACK_SIZES = [20, 50] as const;
export type PackSize = (typeof PACK_SIZES)[number];

export const DEFAULT_CLUSTERS_PER_PILLAR = 3;
export const MIN_CLUSTERS_PER_PILLAR = 0;
export const MAX_CLUSTERS_PER_PILLAR = 5;
export const MIN_PILLARS_PER_CORNERSTONE = 0;
export const MAX_PILLARS_PER_CORNERSTONE = 5;
export const MIN_CORNERSTONES = 0;
export const MAX_CORNERSTONES = 5;

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
  clustersPerPillar: DEFAULT_CLUSTERS_PER_PILLAR,
};

// ─── Calculation helpers ──────────────────────────────────────────────────────

export function calcTotalArticles(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = DEFAULT_CLUSTERS_PER_PILLAR
): number {
  // Hierarchy articles: cornerstones + (cornerstones × pillars) + (cornerstones × pillars × clusters)
  const hierarchyPillars = cornerstones * pillarsPerCornerstone;
  const hierarchyClusters = hierarchyPillars * clustersPerPillar;
  // Standalone articles: pillars with no cornerstone, clusters with no pillar
  const standalonePillars = cornerstones === 0 ? pillarsPerCornerstone : 0;
  const standaloneClusters = (cornerstones === 0 && pillarsPerCornerstone === 0) ? clustersPerPillar : 0;
  return cornerstones + hierarchyPillars + hierarchyClusters + standalonePillars + standaloneClusters;
}

export function calcBreakdown(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = DEFAULT_CLUSTERS_PER_PILLAR
) {
  const hierarchyPillars = cornerstones * pillarsPerCornerstone;
  const hierarchyClusters = hierarchyPillars * clustersPerPillar;
  const standalonePillars = cornerstones === 0 ? pillarsPerCornerstone : 0;
  const standaloneClusters = (cornerstones === 0 && pillarsPerCornerstone === 0) ? clustersPerPillar : 0;
  const totalPillars = hierarchyPillars + standalonePillars;
  const totalClusters = hierarchyClusters + standaloneClusters;
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
 * Enforces hierarchy dependencies.
 * Standalone pillars (no cornerstone) and standalone clusters (no pillar) are now allowed.
 * The only hard rule: if cornerstones = 0 AND pillars = 0, clusters can still exist as standalone.
 * No forced zeroing — just informational warnings.
 */
export function enforceDependencies(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number
): { cornerstones: number; pillarsPerCornerstone: number; clustersPerPillar: number; warnings: string[] } {
  // No hard dependencies enforced — standalone pillars and clusters are valid.
  return { cornerstones, pillarsPerCornerstone, clustersPerPillar, warnings: [] };
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
 * No pack-size constraint — just clamps each dimension to its allowed range
 * and enforces hierarchy dependencies.
 */
export function validateArchitecture(
  _packSize: PackSize | null,
  proposedCornerstones: number,
  proposedPillarsPerCornerstone: number,
  proposedClustersPerPillar: number = DEFAULT_CLUSTERS_PER_PILLAR
): GuardrailResult {
  const warnings: string[] = [];
  let cornerstones = proposedCornerstones;
  let pillarsPerCornerstone = proposedPillarsPerCornerstone;
  let clustersPerPillar = proposedClustersPerPillar;

  // ── Clamp cornerstones ────────────────────────────────────────────────────
  if (cornerstones < MIN_CORNERSTONES) {
    cornerstones = MIN_CORNERSTONES;
  }
  if (cornerstones > MAX_CORNERSTONES) {
    warnings.push(`Maximum ${MAX_CORNERSTONES} cornerstones allowed. Adjusted to ${MAX_CORNERSTONES}.`);
    cornerstones = MAX_CORNERSTONES;
  }

  // ── Clamp pillars per cornerstone ─────────────────────────────────────────
  if (pillarsPerCornerstone < MIN_PILLARS_PER_CORNERSTONE) {
    pillarsPerCornerstone = MIN_PILLARS_PER_CORNERSTONE;
  }
  if (pillarsPerCornerstone > MAX_PILLARS_PER_CORNERSTONE) {
    warnings.push(`Maximum ${MAX_PILLARS_PER_CORNERSTONE} pillars per cornerstone allowed. Adjusted to ${MAX_PILLARS_PER_CORNERSTONE}.`);
    pillarsPerCornerstone = MAX_PILLARS_PER_CORNERSTONE;
  }

  // ── Clamp clusters per pillar ─────────────────────────────────────────────
  if (clustersPerPillar < MIN_CLUSTERS_PER_PILLAR) {
    clustersPerPillar = MIN_CLUSTERS_PER_PILLAR;
  }
  if (clustersPerPillar > MAX_CLUSTERS_PER_PILLAR) {
    warnings.push(`Maximum ${MAX_CLUSTERS_PER_PILLAR} clusters per pillar allowed. Adjusted to ${MAX_CLUSTERS_PER_PILLAR}.`);
    clustersPerPillar = MAX_CLUSTERS_PER_PILLAR;
  }

  // ── Enforce hierarchy dependencies ───────────────────────────────────────
  const deps = enforceDependencies(cornerstones, pillarsPerCornerstone, clustersPerPillar);
  warnings.push(...deps.warnings);
  cornerstones = deps.cornerstones;
  pillarsPerCornerstone = deps.pillarsPerCornerstone;
  clustersPerPillar = deps.clustersPerPillar;

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
 * Supports:
 *  - Full hierarchy: cornerstones > 0 && pillarsPerCornerstone > 0
 *  - Standalone pillars: cornerstones = 0, pillarsPerCornerstone > 0 (no parent cornerstone)
 *  - Standalone clusters: cornerstones = 0 && pillarsPerCornerstone = 0, clustersPerPillar > 0
 */
export function generateNodes(
  cornerstones: number,
  pillarsPerCornerstone: number,
  clustersPerPillar: number = DEFAULT_CLUSTERS_PER_PILLAR
): ArchitectureNode[] {
  const nodes: ArchitectureNode[] = [];

  if (cornerstones > 0) {
    // ── Full hierarchy mode ──────────────────────────────────────────────────
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
  } else if (pillarsPerCornerstone > 0) {
    // ── Standalone pillar mode (no cornerstone) ──────────────────────────────
    for (let p = 1; p <= pillarsPerCornerstone; p++) {
      nodes.push({
        level: "pillar",
        cornerstoneIndex: 0, // no parent cornerstone
        pillarIndex: p,
        clusterIndex: null,
        defaultArticleType: "how_to",
        label: `Pillar ${p}`,
      });
      for (let cl = 1; cl <= clustersPerPillar; cl++) {
        nodes.push({
          level: "cluster",
          cornerstoneIndex: 0,
          pillarIndex: p,
          clusterIndex: cl,
          defaultArticleType: "specialist_post",
          label: `Cluster ${p}.${cl}`,
        });
      }
    }
  } else if (clustersPerPillar > 0) {
    // ── Standalone cluster mode (no cornerstone, no pillar) ──────────────────
    for (let cl = 1; cl <= clustersPerPillar; cl++) {
      nodes.push({
        level: "cluster",
        cornerstoneIndex: 0,
        pillarIndex: null,
        clusterIndex: cl,
        defaultArticleType: "specialist_post",
        label: `Post ${cl}`,
      });
    }
  }

  return nodes;
}
