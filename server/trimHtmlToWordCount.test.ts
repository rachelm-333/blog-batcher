import { describe, it, expect } from "vitest";
import { trimHtmlToWordCount, countHtmlWords } from "./articleEngine";

/** Build a realistic over-length pillar article (~2900 words). */
function buildLongArticle(keyword: string, targetWords: number): string {
  const parts: string[] = [];
  parts.push(`<h1>${keyword}: The Complete Guide</h1>`);
  parts.push(
    `<p><strong>What are the first steps to ${keyword}?</strong> The first steps include validating your idea, choosing a structure, and registering properly. This opening answer block must always be preserved.</p>`,
  );
  // Filler sentence pools — some paragraphs mention the keyword, most don't.
  const plain =
    "Australian founders face a maze of decisions when they begin. Many discover requirements late and pay for it. The right order matters more than most realise. Cash flow, compliance, and clarity all compound over time. ";
  const withKw = `Successfully managing ${keyword} requires a structured approach and steady execution over the first year. `;
  let words = countHtmlWords(parts.join("\n"));
  let i = 0;
  while (words < targetWords) {
    if (i % 4 === 0) parts.push(`<h2>Section ${i} heading</h2>`);
    const useKw = i % 3 === 0; // ~1/3 of paragraphs mention the keyword
    const body = (useKw ? withKw : "") + plain.repeat(3);
    parts.push(`<p>${body.trim()}</p>`);
    words = countHtmlWords(parts.join("\n"));
    i++;
  }
  return parts.join("\n");
}

describe("trimHtmlToWordCount — the recurring word-count bug", () => {
  const KEYWORD = "starting a startup";
  const PILLAR_MAX = 2200;

  it("trims a ~2900-word pillar down to <= the max", () => {
    const html = buildLongArticle(KEYWORD, 2900);
    const before = countHtmlWords(html);
    expect(before).toBeGreaterThan(2700); // sanity: we built an over-length article

    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);

    expect(result.wordCount).toBeLessThanOrEqual(PILLAR_MAX);
    expect(result.removed).toBeGreaterThan(0);
  });

  it("preserves the opening answer block (first paragraph)", () => {
    const html = buildLongArticle(KEYWORD, 2900);
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.bodyHtml).toContain("What are the first steps to starting a startup?");
  });

  it("keeps enough keyword mentions for Pass 1 density (>= 4)", () => {
    const html = buildLongArticle(KEYWORD, 2900);
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    const mentions = (result.bodyHtml.toLowerCase().match(/starting a startup/g) ?? []).length;
    expect(mentions).toBeGreaterThanOrEqual(4);
  });

  it("keeps headings intact (does not strip H2s)", () => {
    const html = buildLongArticle(KEYWORD, 2900);
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.bodyHtml).toMatch(/<h2/);
  });

  it("is a no-op when already under the max", () => {
    const html = `<h1>Short</h1><p>Just a few words about ${KEYWORD} here.</p>`;
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.removed).toBe(0);
    expect(result.bodyHtml).toBe(html);
  });

  it("handles an extreme overage (cornerstone-length into pillar range)", () => {
    const html = buildLongArticle(KEYWORD, 3600);
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.wordCount).toBeLessThanOrEqual(PILLAR_MAX);
  });

  it("never strips the closing CTA section or its link", () => {
    const body = buildLongArticle(KEYWORD, 3000);
    const cta = `\n<h2>Ready to Take the Next Step?</h2>\n<p>Get started today.</p>\n<p>Grab a Box: <a href="https://thestartupdeck.com.au/shop">Grab a Box</a></p>`;
    const html = body + cta;
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.bodyHtml).toContain("Ready to Take the Next Step?");
    expect(result.bodyHtml).toContain('href="https://thestartupdeck.com.au/shop"');
    expect(result.wordCount).toBeLessThanOrEqual(PILLAR_MAX);
  });

  it("never strips any paragraph containing a link", () => {
    const body = buildLongArticle(KEYWORD, 2900);
    const linked = `<p>See the official <a href="https://asic.gov.au">ASIC</a> guidance.</p>`;
    const html = body + linked;
    const result = trimHtmlToWordCount(html, PILLAR_MAX, KEYWORD);
    expect(result.bodyHtml).toContain('href="https://asic.gov.au"');
  });
});
