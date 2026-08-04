import { describe, it, expect } from "vitest";
import {
  isQuestionHeading, ensureQuestionH2s, trimAnswersAfterH2,
  hasList, hasComparisonData, hasGovEduLink,
} from "./articleEngine";

describe("MIC-03 ensureQuestionH2s", () => {
  it("leaves the body unchanged when >=50% of H2s are already questions", () => {
    const html = "<h2>How do you start?</h2><p>x</p><h2>Pricing guide</h2><p>y</p>";
    expect(ensureQuestionH2s(html).changed).toBe(false);
  });
  it("converts non-question H2s until at least half are questions", () => {
    const html = "<h2>Brand Strategy Framework</h2><p>a</p><h2>Build a Brand Plan</h2><p>b</p>";
    const r = ensureQuestionH2s(html);
    expect(r.changed).toBe(true);
    const h2s = Array.from(r.bodyHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)).map(m => m[1]);
    expect(h2s.filter(isQuestionHeading).length / h2s.length).toBeGreaterThanOrEqual(0.5);
    expect(r.bodyHtml).toMatch(/What is Brand Strategy Framework\?|How do you build a Brand Plan\?/);
  });
});

describe("MIC-05 trimAnswersAfterH2", () => {
  it("trims a >60-word answer to a sentence boundary at/under 60 words", () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ") + ". " + Array.from({ length: 40 }, () => "word").join(" ") + ".";
    const html = `<h2>What is it?</h2><p>${long}</p>`;
    const r = trimAnswersAfterH2(html, 60);
    expect(r.changed).toBe(true);
    const p = r.bodyHtml.match(/<p>([\s\S]*?)<\/p>/)![1];
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(p.trim().endsWith(".")).toBe(true); // no mid-sentence cut
  });
  it("leaves short answers alone", () => {
    expect(trimAnswersAfterH2("<h2>Q?</h2><p>Short answer here.</p>", 60).changed).toBe(false);
  });
});

describe("MIC-06 / MIC-07 / EAT-05 detectors", () => {
  it("hasList detects ul/ol", () => {
    expect(hasList("<p>x</p>")).toBe(false);
    expect(hasList("<ul><li>a</li></ul>")).toBe(true);
  });
  it("hasComparisonData detects table or bold-label li", () => {
    expect(hasComparisonData("<ul><li>plain</li></ul>")).toBe(false);
    expect(hasComparisonData("<ul><li><strong>A:</strong> x</li></ul>")).toBe(true);
    expect(hasComparisonData("<table><tr><td>a</td></tr></table>")).toBe(true);
  });
  it("hasGovEduLink detects .gov/.gov.au/.edu links only", () => {
    expect(hasGovEduLink('<a href="https://www.example.com">x</a>')).toBe(false);
    expect(hasGovEduLink('<a href="https://business.gov.au">x</a>')).toBe(true);
    expect(hasGovEduLink('<a href="https://www.ato.gov.au/">x</a>')).toBe(true);
    expect(hasGovEduLink('<a href="https://mit.edu">x</a>')).toBe(true);
  });
});
