import { describe, it, expect } from "vitest";
import { allocateKeywords, type SelectionInput, type NodeInput } from "../shared/keywordAllocation";

// Build the fixed architecture: 1 cornerstone, 3 pillars, `clustersPerPillar` clusters each.
function buildNodes(clustersPerPillar: number): NodeInput[] {
  const nodes: NodeInput[] = [];
  let id = 1;
  const csId = id++;
  nodes.push({ id: csId, level: "cornerstone", parentCornerstoneId: null, parentPillarId: null, sortOrder: 0 });
  let order = 1;
  for (let p = 0; p < 3; p++) {
    const pId = id++;
    nodes.push({ id: pId, level: "pillar", parentCornerstoneId: csId, parentPillarId: null, sortOrder: order++ });
    for (let c = 0; c < clustersPerPillar; c++) {
      nodes.push({ id: id++, level: "cluster", parentCornerstoneId: csId, parentPillarId: pId, sortOrder: order++ });
    }
  }
  return nodes;
}

// The SKT marketing keywords from the screenshot.
const sktSelections: SelectionInput[] = [
  { id: 10, keyword: "brand architecture", msv: 1000, sortOrder: 0 },
  { id: 11, keyword: "branding strategies", msv: 720, sortOrder: 1 },
  { id: 12, keyword: "brand strategist", msv: 720, sortOrder: 2 },
  { id: 13, keyword: "branding and strategy", msv: 720, sortOrder: 3 },
  { id: 14, keyword: "brand positioning", msv: 390, sortOrder: 4 },
  { id: 15, keyword: "branding and positioning", msv: 390, sortOrder: 5 },
  { id: 16, keyword: "brand positioning in marketing", msv: 390, sortOrder: 6 },
];

describe("allocateKeywords", () => {
  it("puts the user's chosen primary keyword on the cornerstone", () => {
    const nodes = buildNodes(5);
    const result = allocateKeywords(sktSelections, nodes, /* primary */ 11);
    const cornerstone = result.assignments.find((a) => a.level === "cornerstone")!;
    expect(cornerstone.keyword).toBe("branding strategies");
    expect(cornerstone.selectionId).toBe(11);
    expect(cornerstone.source).toBe("primary");
  });

  it("falls back to the broadest keyword when no primary is chosen", () => {
    const nodes = buildNodes(5);
    const result = allocateKeywords(sktSelections, nodes, null);
    const cornerstone = result.assignments.find((a) => a.level === "cornerstone")!;
    // All are 2-3 words; broadest 2-word term with highest MSV is "brand architecture".
    expect(cornerstone.keyword).toBe("brand architecture");
  });

  it("fills the 3 pillars with the next-broadest saved keywords", () => {
    const nodes = buildNodes(5);
    const result = allocateKeywords(sktSelections, nodes, 11);
    const pillars = result.assignments.filter((a) => a.level === "pillar");
    expect(pillars).toHaveLength(3);
    // Broadest remaining 2-word terms become pillars (segments).
    const pillarKws = pillars.map((p) => p.keyword);
    expect(pillarKws).toContain("brand architecture");
    expect(pillarKws).toContain("brand strategist");
    expect(pillarKws).toContain("brand positioning");
    pillars.forEach((p) => expect(p.source).toBe("pillar"));
  });

  it("gives the most specific (long-tail) keywords to clusters", () => {
    const nodes = buildNodes(5);
    const result = allocateKeywords(sktSelections, nodes, 11);
    const clusters = result.assignments.filter((a) => a.level === "cluster" && a.keyword);
    const clusterKws = clusters.map((c) => c.keyword);
    // The 3-4 word phrases are the most specific → clusters.
    expect(clusterKws).toContain("brand positioning in marketing");
    expect(clusterKws).toContain("branding and positioning");
    expect(clusterKws).toContain("branding and strategy");
  });

  it("flags empty cluster slots for AI derivation off their pillar", () => {
    const nodes = buildNodes(5); // 15 cluster slots, only 3 long-tail keywords left
    const result = allocateKeywords(sktSelections, nodes, 11);
    // 7 selections: 1 cornerstone + 3 pillars + 3 clusters = 7 used, 12 AI-pending clusters.
    expect(result.usedSelectionIds).toHaveLength(7);
    expect(result.aiClusterSlots).toHaveLength(12);
    // Every AI slot references a real pillar node.
    const pillarIds = new Set(nodes.filter((n) => n.level === "pillar").map((n) => n.id));
    result.aiClusterSlots.forEach((slot) => expect(pillarIds.has(slot.pillarNodeId)).toBe(true));
  });

  it("never assigns the same saved keyword to two nodes", () => {
    const nodes = buildNodes(5);
    const result = allocateKeywords(sktSelections, nodes, 11);
    const used = result.assignments.filter((a) => a.selectionId != null).map((a) => a.selectionId);
    expect(new Set(used).size).toBe(used.length);
  });

  it("assigns keywords verbatim (so the unassigned panel matches exactly)", () => {
    const nodes = buildNodes(3);
    const result = allocateKeywords(sktSelections, nodes, 11);
    // Every assigned keyword string is identical to a saved-selection string.
    const savedSet = new Set(sktSelections.map((s) => s.keyword));
    result.assignments
      .filter((a) => a.keyword)
      .forEach((a) => expect(savedSet.has(a.keyword!)).toBe(true));
  });

  it("handles having more saved keywords than slots (extras stay unused)", () => {
    const many: SelectionInput[] = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      keyword: `keyword phrase number ${i}`,
      msv: 500 - i,
      sortOrder: i,
    }));
    const nodes = buildNodes(3); // 1 + 3 + 9 = 13 slots
    const result = allocateKeywords(many, nodes, 100);
    expect(result.usedSelectionIds).toHaveLength(13);
    expect(result.aiClusterSlots).toHaveLength(0);
  });
});
