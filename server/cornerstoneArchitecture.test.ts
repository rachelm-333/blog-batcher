import { describe, it, expect } from "vitest";
import {
  buildCornerstoneArchitecturePrompt,
  parseCornerstoneArchitecture,
  architectureConflicts,
} from "./campaignArchitect";

const input = {
  cornerstoneKeyword: "brand architecture",
  targetAudience: "small business owners",
  businessName: "Acme",
  industry: "marketing",
  pillarCount: 3,
  clustersPerPillar: 3,
  avoidKeywords: ["brand positioning", "logo design"],
};

describe("buildCornerstoneArchitecturePrompt", () => {
  it("includes the cornerstone keyword, counts, and the SEO rules", () => {
    const p = buildCornerstoneArchitecturePrompt(input);
    expect(p).toContain("brand architecture");
    expect(p).toContain("exactly 3 pillars");
    expect(p).toContain("3 clusters per pillar");
    expect(p).toMatch(/BROAD, DISTINCT SEGMENT/i);
    expect(p).toMatch(/NEVER a definitional/i);
  });
  it("includes the cross-batch avoid list", () => {
    const p = buildCornerstoneArchitecturePrompt(input);
    expect(p).toContain("brand positioning");
    expect(p).toContain("logo design");
  });
  it("omits the avoid clause when no keywords to avoid", () => {
    const p = buildCornerstoneArchitecturePrompt({ ...input, avoidKeywords: [] });
    expect(p).not.toMatch(/already used in earlier content/i);
  });
});

const validJson = JSON.stringify({
  cornerstone: { keyword: "brand architecture", title: "Brand Architecture: The Complete Guide" },
  pillars: [
    { keyword: "brand architecture models", title: "Brand Architecture Models Explained", clusters: [
      { keyword: "monolithic brand architecture", title: "What Is a Monolithic Brand?" },
      { keyword: "house of brands vs branded house", title: "House of Brands vs Branded House" },
      { keyword: "hybrid brand architecture", title: "Hybrid Brand Architecture Guide" },
    ]},
    { keyword: "brand architecture strategy", title: "How to Build a Brand Architecture Strategy", clusters: [
      { keyword: "how to create a brand architecture", title: "How to Create a Brand Architecture" },
      { keyword: "brand architecture audit", title: "Running a Brand Architecture Audit" },
      { keyword: "brand architecture framework", title: "A Practical Brand Architecture Framework" },
    ]},
    { keyword: "brand architecture in marketing", title: "Brand Architecture in Marketing", clusters: [
      { keyword: "brand architecture for b2b", title: "Brand Architecture for B2B" },
      { keyword: "brand architecture examples", title: "10 Brand Architecture Examples" },
      { keyword: "rebranding and architecture", title: "Rebranding and Brand Architecture" },
    ]},
  ],
});

describe("parseCornerstoneArchitecture", () => {
  it("parses a valid hierarchy", () => {
    const a = parseCornerstoneArchitecture(validJson, 3, 3);
    expect(a.cornerstone.keyword).toBe("brand architecture");
    expect(a.pillars).toHaveLength(3);
    expect(a.pillars[0].clusters).toHaveLength(3);
    expect(a.pillars[0].clusters[0].title).toBeTruthy();
  });
  it("strips code fences", () => {
    const a = parseCornerstoneArchitecture("```json\n" + validJson + "\n```", 3, 3);
    expect(a.pillars).toHaveLength(3);
  });
  it("throws on missing cornerstone", () => {
    expect(() => parseCornerstoneArchitecture(JSON.stringify({ pillars: [] }), 3, 3)).toThrow();
  });
  it("throws on a cluster missing keyword/title", () => {
    const bad = JSON.parse(validJson);
    bad.pillars[0].clusters[0] = { keyword: "x" };
    expect(() => parseCornerstoneArchitecture(JSON.stringify(bad), 3, 3)).toThrow();
  });
});

describe("architectureConflicts", () => {
  it("returns no conflicts for a clean, distinct hierarchy", () => {
    const a = parseCornerstoneArchitecture(validJson, 3, 3);
    expect(architectureConflicts(a)).toHaveLength(0);
  });
  it("flags a duplicated keyword across pillars/clusters", () => {
    const dup = JSON.parse(validJson);
    dup.pillars[1].clusters[0] = { keyword: "monolithic brand architecture", title: "Dup" };
    const a = parseCornerstoneArchitecture(JSON.stringify(dup), 3, 3);
    expect(architectureConflicts(a).length).toBeGreaterThan(0);
    expect(architectureConflicts(a)).toContain("monolithic brand architecture");
  });
});
