import { describe, it, expect } from "vitest";
import {
  buildCampaignMatrixPrompt,
  parseCampaignMatrix,
  findMatrixConflicts,
} from "./campaignArchitect";

describe("Module 10 — Campaign Architect", () => {
  it("prompt defaults to 5 clusters and includes the topic + audience", () => {
    const p = buildCampaignMatrixPrompt({ broadTopic: "employment law", targetAudience: "AU small business" });
    expect(p).toContain("employment law");
    expect(p).toContain("AU small business");
    expect(p).toContain("5 Cluster Pages");
    expect(p).toContain("COMPLETELY DISTINCT");
  });

  it("prompt honours a custom cluster count", () => {
    const p = buildCampaignMatrixPrompt({ broadTopic: "x", targetAudience: "y", clusterCount: 6 });
    expect(p).toContain("6 Cluster Pages");
    expect(p).toContain("exactly 6 clusters");
  });

  it("parses a valid matrix JSON", () => {
    const raw = JSON.stringify({
      pillar: { keyword: "employment law", title: "The Complete Guide to Employment Law" },
      clusters: [
        { keyword: "how to handle continual lateness", title: "Handling Continual Lateness" },
        { keyword: "responding to a second written warning", title: "The Second Warning" },
      ],
    });
    const m = parseCampaignMatrix(raw);
    expect(m.pillar.keyword).toBe("employment law");
    expect(m.clusters).toHaveLength(2);
  });

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"pillar":{"keyword":"a","title":"A"},"clusters":[{"keyword":"b","title":"B"}]}\n```';
    expect(parseCampaignMatrix(raw).pillar.keyword).toBe("a");
  });

  it("throws on invalid matrix shape", () => {
    expect(() => parseCampaignMatrix('{"pillar":{}}')).toThrow();
    expect(() => parseCampaignMatrix("not json")).toThrow();
  });

  it("detects cannibalizing (duplicate) cluster topics", () => {
    const matrix = {
      pillar: { keyword: "employment law", title: "Guide" },
      clusters: [
        { keyword: "how to handle continual lateness", title: "A" },
        { keyword: "how to handle continual lateness", title: "B" }, // exact dupe
      ],
    };
    const conflicts = findMatrixConflicts(matrix);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("passes a clean, distinct matrix with no conflicts", () => {
    const matrix = {
      pillar: { keyword: "employment law", title: "Guide" },
      clusters: [
        { keyword: "how to handle continual lateness", title: "A" },
        { keyword: "responding to a second written warning", title: "B" },
        { keyword: "managing remote worker timesheets", title: "C" },
        { keyword: "annual leave loading rules", title: "D" },
      ],
    };
    expect(findMatrixConflicts(matrix)).toHaveLength(0);
  });
});
