import { describe, it, expect } from "vitest";
import { keywordInRegister, titleInRegister, slugInRegister, normalizeTerm, type ContentRegister } from "./contentRegister";

function reg(keywords: string[], titles: string[] = [], slugs: string[] = []): ContentRegister {
  return {
    keywords,
    normKeywordSet: new Set(keywords.map(normalizeTerm)),
    titleSet: new Set(titles.map(normalizeTerm)),
    slugSet: new Set(slugs.map(normalizeTerm)),
  };
}

describe("keywordInRegister", () => {
  const r = reg(["brand strategy", "brand positioning", "logo design"]);
  it("matches exact (case/space-insensitive)", () => {
    expect(keywordInRegister("Brand Strategy", r)).toBe(true);
    expect(keywordInRegister("  brand   strategy ", r)).toBe(true);
  });
  it("matches semantic overlap (jaccard >= 0.75)", () => {
    // "brand positioning strategy" shares 2/3 meaningful tokens with "brand positioning" -> ~0.66, below
    // "brand positioning" vs "positioning brand" -> same tokens -> 1.0
    expect(keywordInRegister("positioning brand", r)).toBe(true);
  });
  it("does NOT match distinct keywords", () => {
    expect(keywordInRegister("brand architecture models", r)).toBe(false);
    expect(keywordInRegister("customer retention", r)).toBe(false);
  });
});

describe("titleInRegister / slugInRegister", () => {
  const r = reg([], ["Brand Strategy: The Complete Guide"], ["brand-strategy"]);
  it("matches titles case/punctuation-insensitively", () => {
    expect(titleInRegister("brand strategy the complete guide", r)).toBe(true);
    expect(titleInRegister("A Totally Different Title", r)).toBe(false);
  });
  it("matches slugs", () => {
    expect(slugInRegister("brand-strategy", r)).toBe(true);
    expect(slugInRegister("brand-architecture", r)).toBe(false);
  });
});
