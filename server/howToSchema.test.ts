import { describe, it, expect } from "vitest";
import { ensureHowToSchema } from "./articleEngine";

const ARTICLE_URL = "https://www.skrt.com.au/post/how-to-build-a-brand";
const baseGraph = () => ({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Article", "@id": `${ARTICLE_URL}#article`, "headline": "How to build a brand" },
    { "@type": "FAQPage", "@id": `${ARTICLE_URL}#faq`, "mainEntity": [] },
  ],
});
const opts = (articleType: string) => ({
  articleType,
  title: "How to Build a Brand in Australia",
  description: "A step-by-step guide to building a brand.",
  articleUrl: ARTICLE_URL,
});
const bodyWithOl = `<h2>Steps</h2><ol><li>Define your positioning.</li><li>Design your identity.</li><li>Launch and measure.</li></ol>`;

function graphOf(schema: string) {
  return (JSON.parse(schema)["@graph"] ?? []) as Array<Record<string, any>>;
}

describe("ensureHowToSchema", () => {
  it("builds HowTo schema from <ol> when missing from schema", () => {
    const r = ensureHowToSchema(JSON.stringify(baseGraph()), bodyWithOl, opts("how_to"));
    const howTo = graphOf(r.schema).find((n) => n["@type"] === "HowTo");
    expect(howTo).toBeTruthy();
    expect(howTo!.step).toHaveLength(3);
    expect(howTo!.step[0]).toMatchObject({ "@type": "HowToStep", position: 1, text: "Define your positioning." });
    // existing entries preserved
    expect(graphOf(r.schema).some((n) => n["@type"] === "Article")).toBe(true);
    expect(graphOf(r.schema).some((n) => n["@type"] === "FAQPage")).toBe(true);
  });

  it("does not add HowTo when a HowTo block is already present", () => {
    const g = baseGraph();
    g["@graph"].push({ "@type": "HowTo", "@id": `${ARTICLE_URL}#howto`, "name": "x", "step": [] } as any);
    const r = ensureHowToSchema(JSON.stringify(g), bodyWithOl, opts("how_to"));
    expect(r.outcome).toBe("already present");
    expect(graphOf(r.schema).filter((n) => n["@type"] === "HowTo")).toHaveLength(1);
  });

  it("is skipped when there is no <ol> in the body", () => {
    const r = ensureHowToSchema(JSON.stringify(baseGraph()), `<h2>Steps</h2><p>Do things in prose.</p>`, opts("how_to"));
    expect(r.outcome).toContain("no <ol>");
    expect(graphOf(r.schema).some((n) => n["@type"] === "HowTo")).toBe(false);
  });

  it("is not added for non-how_to article types", () => {
    const r = ensureHowToSchema(JSON.stringify(baseGraph()), bodyWithOl, opts("the_why"));
    expect(r.outcome).toContain("not a how-to");
    expect(graphOf(r.schema).some((n) => n["@type"] === "HowTo")).toBe(false);
  });

  it("truncates HowToStep name to the first sentence when the li text is long", () => {
    const longOl = `<ol><li>Define your positioning statement. This means writing one clear sentence about who you serve and why you are different from everyone else.</li></ol>`;
    const r = ensureHowToSchema(JSON.stringify(baseGraph()), longOl, opts("how_to"));
    const step = graphOf(r.schema).find((n) => n["@type"] === "HowTo")!.step[0];
    expect(step.name).toBe("Define your positioning statement.");
    expect(step.text).toContain("who you serve"); // full text kept
  });

  it("uses the correct articleUrl for the HowTo @id", () => {
    const r = ensureHowToSchema(JSON.stringify(baseGraph()), bodyWithOl, opts("how_to"));
    const howTo = graphOf(r.schema).find((n) => n["@type"] === "HowTo")!;
    expect(howTo["@id"]).toBe(`${ARTICLE_URL}#howto`);
  });
});
