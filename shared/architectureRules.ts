/**
 * Blog Batcher — Architecture Rules Engine
 *
 * Enforces the Cornerstone → Pillar → Cluster hierarchy rules from the Master Scope:
 *  - Clusters per pillar: always exactly 3 (fixed)
 *  - Minimum ratio: 1 Cornerstone : 1 Pillar : 3 Clusters
 *  - Maximum per cornerstone: 1 Cornerstone : 4 Pillars : 12 Clusters
 *  - Total articles must equal packSize (20 or 50)
 *  - Pack is locked once selected
 */

export const PACK_SIZES = [20, 50] as const;
export type PackSize = (typeof PACK_SIZES)[number];

export const CLUSTERS_PER_PILLAR = 3; // fixed — never changes
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
  "case_study",
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  cornerstone_guide: "Cornerstone Guide",
  top_10_list: "Top 10 List",
  how_to: "How-To Article",
  the_why: "The Why Article",
  comparison: "Comparison Article",
  myth_busting: "Myth-Busting Article",
  case_study: "Case Study",
};

/** Which article types are valid for each node level */
export const VALID_TYPES_BY_LEVEL: Record<"cornerstone" | "pillar" | "cluster", ArticleType[]> = {
  cornerstone: ["cornerstone_guide"],
  pillar: ["top_10_list", "how_to", "the_why", "comparison", "myth_busting"],
  cluster: ["how_to", "myth_busting", "case_study"],
};

/** Word count targets from the scope */
export const WORD_COUNT_TARGETS: Record<"cornerstone" | "pillar" | "cluster", { min: number; max: number }> = {
  cornerstone: { min: 2500, max: 3200 },
  pillar: { min: 1500, max: 1800 },
  cluster: { min: 1000, max: 1200 },
};

// ─── Default architectures ────────────────────────────────────────────────────

export const DEFAULT_ARCHITECTURE: Record<PackSize, { cornerstones: number; pillarsPerCornerstone: number }> = {
  20: { cornerstones: 2, pillarsPerCornerstone: 2 },
  50: { cornerstones: 4, pillarsPerCornerstone: 3 },
};

// ─── Calculation helpers ──────────────────────────────────────────────────────

export function calcTotalArticles(cornerstones: number, pillarsPerCornerstone: number): number {
  const totalPillars = cornerstones * pillarsPerCornerstone;
  const totalClusters = totalPillars * CLUSTERS_PER_PILLAR;
  return cornerstones + totalPillars + totalClusters;
}

export function calcBreakdown(cornerstones: number, pillarsPerCornerstone: number) {
  const totalPillars = cornerstones * pillarsPerCornerstone;
  const totalClusters = totalPillars * CLUSTERS_PER_PILLAR;
  return {
    cornerstones,
    pillarsPerCornerstone,
    totalPillars,
    totalClusters,
    total: cornerstones + totalPillars + totalClusters,
  };
}

// ─── Guardrails validation ────────────────────────────────────────────────────

export interface GuardrailResult {
  valid: boolean;
  correctedCornerstones: number;
  correctedPillarsPerCornerstone: number;
  warnings: string[];
}

/**
 * Validates a proposed architecture configuration against all guardrail rules.
 * Returns the (possibly corrected) values and any warning messages to show the user.
 */
export function validateArchitecture(
  packSize: PackSize,
  proposedCornerstones: number,
  proposedPillarsPerCornerstone: number
): GuardrailResult {
  const warnings: string[] = [];
  let cornerstones = proposedCornerstones;
  let pillarsPerCornerstone = proposedPillarsPerCornerstone;

  // ── Clamp cornerstones ────────────────────────────────────────────────────
  if (cornerstones < MIN_CORNERSTONES) {
    warnings.push(`Minimum 1 cornerstone required. Adjusted to 1.`);
    cornerstones = MIN_CORNERSTONES;
  }
  if (cornerstones > MAX_CORNERSTONES) {
    warnings.push(
      `Maximum ${MAX_CORNERSTONES} cornerstones allowed. Adjusted to ${MAX_CORNERSTONES}.`
    );
    cornerstones = MAX_CORNERSTONES;
  }

  // ── Clamp pillars per cornerstone ─────────────────────────────────────────
  if (pillarsPerCornerstone < MIN_PILLARS_PER_CORNERSTONE) {
    warnings.push(`Minimum 1 pillar per cornerstone required. Adjusted to 1.`);
    pillarsPerCornerstone = MIN_PILLARS_PER_CORNERSTONE;
  }
  if (pillarsPerCornerstone > MAX_PILLARS_PER_CORNERSTONE) {
    warnings.push(
      `Maximum ${MAX_PILLARS_PER_CORNERSTONE} pillars per cornerstone allowed. Adjusted to ${MAX_PILLARS_PER_CORNERSTONE}.`
    );
    pillarsPerCornerstone = MAX_PILLARS_PER_CORNERSTONE;
  }

  // ── Check total article count fits the pack ───────────────────────────────
  const total = calcTotalArticles(cornerstones, pillarsPerCornerstone);

  if (total > packSize) {
    // Reduce pillars first, then cornerstones, until we fit
    let adjusted = false;
    outer: for (let c = cornerstones; c >= MIN_CORNERSTONES; c--) {
      for (let p = pillarsPerCornerstone; p >= MIN_PILLARS_PER_CORNERSTONE; p--) {
        if (calcTotalArticles(c, p) <= packSize) {
          if (c !== cornerstones || p !== pillarsPerCornerstone) {
            warnings.push(
              `With ${packSize} articles, this configuration exceeds the pack size. ` +
                `Adjusted to ${c} cornerstone${c > 1 ? "s" : ""} × ${p} pillar${p > 1 ? "s" : ""} per cornerstone ` +
                `(${calcTotalArticles(c, p)} articles).`
            );
            cornerstones = c;
            pillarsPerCornerstone = p;
          }
          adjusted = true;
          break outer;
        }
      }
    }
    if (!adjusted) {
      cornerstones = MIN_CORNERSTONES;
      pillarsPerCornerstone = MIN_PILLARS_PER_CORNERSTONE;
      warnings.push(
        `Configuration could not fit within ${packSize} articles. Reset to minimum configuration.`
      );
    }
  }

  const finalTotal = calcTotalArticles(cornerstones, pillarsPerCornerstone);
  const valid =
    cornerstones === proposedCornerstones &&
    pillarsPerCornerstone === proposedPillarsPerCornerstone &&
    finalTotal <= packSize;

  return {
    valid: warnings.length === 0,
    correctedCornerstones: cornerstones,
    correctedPillarsPerCornerstone: pillarsPerCornerstone,
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
 * This is used to populate the article_nodes table.
 */
export function generateNodes(
  cornerstones: number,
  pillarsPerCornerstone: number
): ArchitectureNode[] {
  const nodes: ArchitectureNode[] = [];

  for (let c = 1; c <= cornerstones; c++) {
    // Cornerstone node
    nodes.push({
      level: "cornerstone",
      cornerstoneIndex: c,
      pillarIndex: null,
      clusterIndex: null,
      defaultArticleType: "cornerstone_guide",
      label: `Cornerstone ${c}`,
    });

    for (let p = 1; p <= pillarsPerCornerstone; p++) {
      // Pillar node
      nodes.push({
        level: "pillar",
        cornerstoneIndex: c,
        pillarIndex: p,
        clusterIndex: null,
        defaultArticleType: "how_to",
        label: `Pillar ${c}.${p}`,
      });

      for (let cl = 1; cl <= CLUSTERS_PER_PILLAR; cl++) {
        // Cluster node
        nodes.push({
          level: "cluster",
          cornerstoneIndex: c,
          pillarIndex: p,
          clusterIndex: cl,
          defaultArticleType: "case_study",
          label: `Cluster ${c}.${p}.${cl}`,
        });
      }
    }
  }

  return nodes;
}
