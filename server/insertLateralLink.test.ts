import { describe, it, expect } from "vitest";
import { insertLateralLink } from "./articleEngine";

const SIB = { url: "/handling-a-second-warning", title: "handling a second written warning" };

describe("insertLateralLink — lateral sibling link (MAC-11)", () => {
  it("appends a descriptive lateral link before the CTA when missing", () => {
    const html = `<h2>Body</h2><p>text</p><h2>Ready?</h2><p>CTA</p>`;
    const r = insertLateralLink(html, SIB);
    expect(r.inserted).toBe(true);
    expect(r.bodyHtml).toContain(`<a href="${SIB.url}">${SIB.title}</a>`);
    expect(r.bodyHtml.indexOf(SIB.url)).toBeLessThan(r.bodyHtml.indexOf("Ready?"));
  });

  it("does not double-link if the sibling is already linked", () => {
    const html = `<p>See <a href="${SIB.url}">${SIB.title}</a>.</p>`;
    expect(insertLateralLink(html, SIB).inserted).toBe(false);
  });

  it("descriptive anchor text (not generic)", () => {
    const r = insertLateralLink(`<p>x</p>`, SIB);
    const anchor = (r.bodyHtml.match(/<a[^>]*>([^<]+)<\/a>/) ?? [])[1];
    expect(anchor).toBe(SIB.title);
    expect(anchor).not.toMatch(/click here|read more/i);
  });

  it("no-op when no sibling provided", () => {
    const html = `<p>x</p>`;
    expect(insertLateralLink(html, undefined).inserted).toBe(false);
  });
});
