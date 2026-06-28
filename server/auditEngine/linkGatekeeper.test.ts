import { describe, it, expect } from "vitest";
import { runLinkGatekeeper } from "./linkGatekeeper";

const base = {
  primaryKeyword: "brand strategy",
  ownDomains: ["thestartupdeck.com.au"],
  competitorDomains: ["rivalagency.com"],
};
const errIds = (html: string, over?: Partial<typeof base>) =>
  runLinkGatekeeper({ html, ...base, ...over }).errors.map(e => e.rule);

describe("Module 8 — Link Anti-Sabotage Gatekeeper", () => {
  it("blocks internal anchor cannibalization (anchor == primary keyword)", () => {
    expect(errIds(`<p><a href="/pillar">brand strategy</a></p>`)).toContain("ANCHOR_CANNIBALIZATION");
  });

  it("blocks generic anchor text", () => {
    expect(errIds(`<p>x <a href="/p">click here</a></p>`)).toContain("GENERIC_ANCHOR");
    expect(errIds(`<p>x <a href="/p">read more</a></p>`)).toContain("GENERIC_ANCHOR");
  });

  it("blocks external keyword bleed (giving keyword to another site)", () => {
    expect(errIds(`<p>${"word ".repeat(150)}<a href="https://other.com">brand strategy</a></p>`)).toContain("KEYWORD_BLEED");
  });

  it("blocks naked URL anchor text", () => {
    expect(errIds(`<p>${"word ".repeat(150)}<a href="https://gov.au">https://gov.au</a></p>`)).toContain("NAKED_URL");
  });

  it("blocks a link to a known competitor", () => {
    expect(errIds(`<p>${"word ".repeat(150)}<a href="https://rivalagency.com/x">rival agency</a></p>`)).toContain("COMPETITOR_LINK");
  });

  it("blocks low-trust spam TLDs", () => {
    expect(errIds(`<p>${"word ".repeat(150)}<a href="https://cheap.xyz">cheap source</a></p>`)).toContain("LOW_TRUST_TLD");
  });

  it("blocks an external link inside the first 100 words (early exit)", () => {
    expect(errIds(`<p>Short intro <a href="https://gov.au">authority</a> right away.</p>`)).toContain("EARLY_EXIT");
  });

  it("auto-fixes external links: injects target=_blank + rel=noopener", () => {
    const r = runLinkGatekeeper({ html: `<p>${"w ".repeat(150)}<a href="https://gov.au">authority source</a></p>`, ...base });
    expect(r.html).toContain('target="_blank"');
    expect(r.html).toContain('rel="noopener noreferrer"');
    expect(r.fixesApplied).toBeGreaterThan(0);
  });

  it("passes a clean article with a good descriptive external link after 100 words", () => {
    const html = `<p>${"word ".repeat(150)}</p><p>See the <a href="https://asic.gov.au">official ASIC guidance</a>.</p><p><a href="/pillar-page">our complete branding guide</a></p>`;
    expect(runLinkGatekeeper({ html, ...base }).errors).toHaveLength(0);
  });

  it("does NOT flag internal links to own domain as external", () => {
    const html = `<p>${"w ".repeat(150)}<a href="https://thestartupdeck.com.au/shop">visit our shop</a></p>`;
    const errs = runLinkGatekeeper({ html, ...base }).errors;
    expect(errs).toHaveLength(0);
  });
});
