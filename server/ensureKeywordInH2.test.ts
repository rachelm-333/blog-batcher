import { describe, it, expect } from "vitest";
import { ensureKeywordInH2, titleCaseKeyword, kwPresentInText } from "./articleEngine";

describe("titleCaseKeyword", () => {
  it("title-cases a multi-word keyword", () => {
    expect(titleCaseKeyword("psychosocial hazards")).toBe("Psychosocial Hazards");
    expect(titleCaseKeyword("starting a startup")).toBe("Starting A Startup");
  });
});

describe("ensureKeywordInH2 — the recurring keyword-in-H2 bug", () => {
  const KW = "psychosocial hazards";

  it("inserts the keyword cleanly as a topic prefix when no H2 has it", () => {
    const html = `<h1>Title</h1><p>Intro.</p><h2>Legal Definition and Scope</h2><p>Body.</p>`;
    const result = ensureKeywordInH2(html, KW);
    expect(result.changed).toBe(true);
    expect(result.bodyHtml).toContain("<h2>Psychosocial Hazards: Legal Definition and Scope</h2>");
    // Crucially: NO ugly band-aid suffix
    expect(result.bodyHtml).not.toContain("A Guide to");
  });

  it("the inserted H2 satisfies the Pass 1 checker's own matcher", () => {
    const html = `<h1>Title</h1><h2>Legal Definition and Scope</h2><p>Body.</p>`;
    const result = ensureKeywordInH2(html, KW);
    const h2 = (result.bodyHtml.match(/<h2[^>]*>.*?<\/h2>/i) ?? [""])[0];
    expect(kwPresentInText(KW, h2)).toBe(true); // would now PASS p3_keyword_in_h2
  });

  it("does nothing when an H2 already contains the keyword (exact)", () => {
    const html = `<h1>Title</h1><h2>Understanding Psychosocial Hazards</h2><p>Body.</p>`;
    const result = ensureKeywordInH2(html, KW);
    expect(result.changed).toBe(false);
    expect(result.bodyHtml).toBe(html);
  });

  it("does nothing when an H2 already contains the keyword tokens (token match)", () => {
    // checker uses token-presence; 'hazards that are psychosocial' has both tokens
    const html = `<h1>Title</h1><h2>Hazards that are psychosocial in nature</h2><p>Body.</p>`;
    const result = ensureKeywordInH2(html, KW);
    expect(result.changed).toBe(false);
  });

  it("only edits the FIRST h2, leaves later h2s untouched", () => {
    const html = `<h1>T</h1><h2>First Section</h2><p>a</p><h2>Second Section</h2><p>b</p>`;
    const result = ensureKeywordInH2(html, KW);
    expect(result.bodyHtml).toContain("<h2>Psychosocial Hazards: First Section</h2>");
    expect(result.bodyHtml).toContain("<h2>Second Section</h2>");
  });

  it("is a no-op when there are no H2s", () => {
    const html = `<h1>Title</h1><p>No subheadings here about ${KW}.</p>`;
    const result = ensureKeywordInH2(html, KW);
    expect(result.changed).toBe(false);
    expect(result.bodyHtml).toBe(html);
  });
});
