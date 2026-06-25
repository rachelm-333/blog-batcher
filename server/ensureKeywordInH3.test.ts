import { describe, it, expect } from "vitest";
import { ensureKeywordInH3, kwPresentInText } from "./articleEngine";

describe("ensureKeywordInH3 — the p4_keyword_in_h3 miss", () => {
  const KW = "starting a startup";

  it("inserts the keyword into an H3 when H3s exist but none have it", () => {
    const html = `<h2>Steps</h2><h3>Validate Your Idea</h3><p>body</p><h3>Register</h3><p>body</p>`;
    const result = ensureKeywordInH3(html, KW);
    expect(result.changed).toBe(true);
    const firstH3 = (result.bodyHtml.match(/<h3[^>]*>.*?<\/h3>/i) ?? [""])[0];
    expect(kwPresentInText(KW, firstH3)).toBe(true);
    expect(result.bodyHtml).not.toContain("A Guide to");
  });

  it("does nothing when there are no H3s (Pass 1 passes anyway)", () => {
    const html = `<h2>Steps</h2><p>No H3s here about ${KW}.</p>`;
    const result = ensureKeywordInH3(html, KW);
    expect(result.changed).toBe(false);
    expect(result.bodyHtml).toBe(html);
  });

  it("does nothing when an H3 already contains the keyword", () => {
    const html = `<h2>Steps</h2><h3>Starting a Startup: First Moves</h3><p>body</p>`;
    const result = ensureKeywordInH3(html, KW);
    expect(result.changed).toBe(false);
  });
});
