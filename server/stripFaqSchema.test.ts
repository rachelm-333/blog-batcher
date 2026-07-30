import { describe, it, expect } from "vitest";
import { stripFaqFromSchema } from "./articleEngine";

const graphWithFaq = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Article", headline: "X" },
    { "@type": "BreadcrumbList", itemListElement: [] },
    { "@type": "Organization", name: "Y" },
    { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?" }] },
  ],
});

describe("stripFaqFromSchema", () => {
  it("removes FAQPage from a @graph but keeps Article/Breadcrumb/Organization", () => {
    const out = stripFaqFromSchema(graphWithFaq);
    expect(out).not.toContain("FAQPage");
    expect(out).not.toContain('"Question"');
    expect(out).toContain("Article");
    expect(out).toContain("BreadcrumbList");
    expect(out).toContain("Organization");
  });

  it("leaves schema without FAQPage unchanged in meaning", () => {
    const noFaq = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Article" }] });
    const out = stripFaqFromSchema(noFaq);
    expect(JSON.parse(out)["@graph"]).toHaveLength(1);
  });

  it("returns empty string when the root node itself is a FAQPage", () => {
    const rootFaq = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] });
    expect(stripFaqFromSchema(rootFaq)).toBe("");
  });

  it("returns unparseable schema unchanged (never throws)", () => {
    expect(stripFaqFromSchema("not json {")).toBe("not json {");
    expect(stripFaqFromSchema("")).toBe("");
  });
});
