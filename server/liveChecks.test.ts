import { describe, it, expect } from "vitest";
import { buildLlmsTxt } from "./llmsTxt";
import { interpretPageSpeed } from "./liveChecks";

describe("buildLlmsTxt", () => {
  it("builds a valid llms.txt with heading, description, key pages, and blog", () => {
    const out = buildLlmsTxt({
      businessName: "SKT Marketing",
      description: "Brand strategy for Australian SMEs.",
      websiteUrl: "https://sktmarketing.com.au",
      keyPages: [{ label: "Contact", url: "https://sktmarketing.com.au/contact" }],
      posts: [{ title: "What Brand Strategy Costs", url: "https://sktmarketing.com.au/post/cost" }],
    });
    expect(out).toMatch(/^# SKT Marketing/);
    expect(out).toContain("> Brand strategy for Australian SMEs.");
    expect(out).toContain("## Key Pages");
    expect(out).toContain("[Home](https://sktmarketing.com.au)"); // homepage auto-added first
    expect(out).toContain("[Contact](https://sktmarketing.com.au/contact)");
    expect(out).toContain("## Blog");
    expect(out).toContain("[What Brand Strategy Costs](https://sktmarketing.com.au/post/cost)");
  });
  it("omits sections with no data", () => {
    const out = buildLlmsTxt({ businessName: "Acme" });
    expect(out).toContain("# Acme");
    expect(out).not.toContain("## Blog");
    expect(out).not.toContain("## Key Pages");
  });
});

describe("interpretPageSpeed", () => {
  it("passes when CrUX field metrics are all within thresholds", () => {
    const json = { loadingExperience: { metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2000 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 }, // ×100 → 0.05
      INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
    } } };
    expect(interpretPageSpeed(json)).toBe(true);
  });
  it("fails when a CrUX metric exceeds its threshold", () => {
    const json = { loadingExperience: { metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200 }, // > 2500
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
    } } };
    expect(interpretPageSpeed(json)).toBe(false);
  });
  it("falls back to Lighthouse lab metrics when no field data", () => {
    const json = { lighthouseResult: { audits: {
      "largest-contentful-paint": { numericValue: 1800 },
      "cumulative-layout-shift": { numericValue: 0.03 },
    } } };
    expect(interpretPageSpeed(json)).toBe(true);
  });
  it("returns null when neither data source is present", () => {
    expect(interpretPageSpeed({})).toBeNull();
  });
});
