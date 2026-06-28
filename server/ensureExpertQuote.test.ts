import { describe, it, expect } from "vitest";
import { ensureExpertQuote } from "./articleEngine";

const QUOTE = { quote: "Treat your first 90 days as experiments.", author: "Sarah Chen" };

describe("ensureExpertQuote — EAT-04 (attributed expert quote)", () => {
  it("inserts an attributed blockquote before the CTA when missing", () => {
    const html = `<h2>Body</h2><p>text</p><h2>Ready to start?</h2><p>CTA</p>`;
    const r = ensureExpertQuote(html, QUOTE);
    expect(r.inserted).toBe(true);
    expect(r.bodyHtml).toMatch(/<blockquote>[\s\S]*Sarah Chen[\s\S]*<\/blockquote>/);
    // inserted before the CTA H2
    expect(r.bodyHtml.indexOf("blockquote")).toBeLessThan(r.bodyHtml.indexOf("Ready to start"));
  });

  it("does nothing when an attributed blockquote already exists", () => {
    const html = `<p>x</p><blockquote>"Already here." — Jane Doe</blockquote>`;
    const r = ensureExpertQuote(html, QUOTE);
    expect(r.inserted).toBe(false);
  });

  it("never invents — no quote provided means no insertion", () => {
    const html = `<h2>Body</h2><p>text</p>`;
    const r = ensureExpertQuote(html, undefined);
    expect(r.inserted).toBe(false);
    expect(r.bodyHtml).toBe(html);
  });
});
