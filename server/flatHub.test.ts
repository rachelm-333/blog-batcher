import { describe, it, expect } from "vitest";
import { buildFlatHubPrompt, parseFlatHub, flatFormatConflicts, CLUSTER_FORMATS, type FlatHubInput } from "./campaignArchitect";

const input: FlatHubInput = {
  themeKeyword: "marketing strategy",
  targetAudience: "small business owners",
  businessName: "Acme",
  industry: "marketing",
  services: ["brand strategy"],
  batchPurpose: "educate on marketing strategy",
  pillarCount: 2,
  clustersPerPillar: 3,
};
const pool = [
  { keyword: "content marketing", msv: 5000, competition: "medium" as const },
  { keyword: "how to build a content plan", msv: 300, competition: "low" as const },
  { keyword: "content marketing vs ads", msv: 200, competition: "low" as const },
  { keyword: "best content marketing tools", msv: 400, competition: "low" as const },
];

describe("buildFlatHubPrompt", () => {
  it("says NO cornerstone, lists real pool, forces distinct formats", () => {
    const p = buildFlatHubPrompt(input, pool);
    expect(p).toMatch(/NO CORNERSTONE/i);
    expect(p).toMatch(/FLAT 2-TIER/i);
    expect(p).toContain("content marketing");
    expect(p).toContain("volume: 5000");
    expect(p).toMatch(/DIFFERENT format/i);
    for (const f of CLUSTER_FORMATS) expect(p).toContain(f.key);
    expect(p).toContain("educate on marketing strategy");
  });
});

const validJson = JSON.stringify({
  pillars: [
    { keyword: "content marketing", title: "Content Marketing That Converts", format: "how_to", secondaryKeywords: ["content plan"],
      clusters: [
        { keyword: "how to build a content plan", title: "How to Build a Content Plan in 5 Steps", format: "how_to", secondaryKeywords: [] },
        { keyword: "content marketing vs ads", title: "Content Marketing vs Ads: Which Wins?", format: "comparison", secondaryKeywords: [] },
        { keyword: "best content marketing tools", title: "9 Best Content Marketing Tools", format: "top_10_list", secondaryKeywords: [] },
      ] },
  ],
});

describe("parseFlatHub", () => {
  it("parses pillars + clusters with formats, no cornerstone", () => {
    const a = parseFlatHub(validJson, 1, 3);
    expect(a.pillars).toHaveLength(1);
    expect(a.pillars[0].clusters).toHaveLength(3);
    expect(a.pillars[0].clusters.map((c) => c.format)).toEqual(["how_to", "comparison", "top_10_list"]);
  });
  it("throws on missing pillars", () => {
    expect(() => parseFlatHub(JSON.stringify({}), 1, 3)).toThrow();
  });
});

describe("flatFormatConflicts", () => {
  it("passes when every cluster format is distinct", () => {
    expect(flatFormatConflicts(parseFlatHub(validJson, 1, 3))).toHaveLength(0);
  });
  it("flags a duplicated format within a pillar", () => {
    const dup = JSON.parse(validJson);
    dup.pillars[0].clusters[1].format = "how_to"; // now two how_to
    expect(flatFormatConflicts(parseFlatHub(JSON.stringify(dup), 1, 3)).length).toBeGreaterThan(0);
  });
});
