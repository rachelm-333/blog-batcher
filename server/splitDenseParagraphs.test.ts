import { describe, it, expect } from "vitest";
import { splitDenseParagraphs } from "./articleEngine";

describe("splitDenseParagraphs — GEO paragraph density (MIC-08)", () => {
  it("splits a >4-sentence paragraph into multiple <p> blocks", () => {
    const dense = "<p>One. Two. Three. Four. Five. Six.</p>";
    const out = splitDenseParagraphs(dense, 4);
    const ps = out.match(/<p[\s>]/g) ?? [];
    expect(ps.length).toBe(2); // 6 sentences -> 4 + 2
    expect(out).toContain("One. Two. Three. Four.");
    expect(out).toContain("Five. Six.");
  });

  it("leaves a <=4-sentence paragraph untouched", () => {
    const ok = "<p>One. Two. Three. Four.</p>";
    expect(splitDenseParagraphs(ok, 4)).toBe(ok);
  });

  it("does not split paragraphs containing lists or tables", () => {
    const withList = "<p>Intro. Then. More. Even. Lots.<ul><li>a</li></ul></p>";
    expect(splitDenseParagraphs(withList, 4)).toBe(withList);
  });

  it("preserves paragraph attributes", () => {
    const dense = '<p class="x">A. B. C. D. E. F.</p>';
    const out = splitDenseParagraphs(dense, 4);
    expect(out).toContain('<p class="x">');
  });
});
