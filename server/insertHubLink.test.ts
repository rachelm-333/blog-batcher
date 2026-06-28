import { describe, it, expect } from "vitest";
import { insertHubLink, classifyLink } from "./articleEngine";

const HUB_URL = "https://thestartupdeck.com.au/post/brand-strategy";
const HUB_KW = "brand strategy";

describe("insertHubLink — hub-and-spoke MAC-09 (exact-match anchor)", () => {
  it("wraps the first plain-text mention of the hub keyword in an exact-match link", () => {
    const body = `<h2>Intro</h2><p>A strong brand strategy drives growth for founders.</p>`;
    const r = insertHubLink(body, HUB_URL, HUB_KW);
    expect(r.inserted).toBe(true);
    expect(r.bodyHtml).toContain(`<a href="${HUB_URL}">brand strategy</a>`);
  });

  it("anchor text exactly equals the hub keyword (so it passes MAC-09)", () => {
    const body = `<p>Your brand strategy matters.</p>`;
    const r = insertHubLink(body, HUB_URL, HUB_KW);
    const anchor = (r.bodyHtml.match(/<a[^>]*>([^<]+)<\/a>/) ?? [])[1];
    expect(anchor?.toLowerCase()).toBe(HUB_KW);
  });

  it("appends a contextual link when the keyword is not mentioned", () => {
    const body = `<h2>Topic</h2><p>Unrelated text here.</p><h2>Ready?</h2><p>CTA</p>`;
    const r = insertHubLink(body, HUB_URL, HUB_KW);
    expect(r.inserted).toBe(true);
    expect(r.bodyHtml).toContain(HUB_URL);
    // inserted before the CTA H2
    expect(r.bodyHtml.indexOf(HUB_URL)).toBeLessThan(r.bodyHtml.indexOf("Ready?"));
  });

  it("does not double-link if already linked to the hub", () => {
    const body = `<p>See <a href="${HUB_URL}">brand strategy</a> guide.</p>`;
    const r = insertHubLink(body, HUB_URL, HUB_KW);
    expect(r.inserted).toBe(false);
  });

  it("the inserted link survives the link validator (it is on the allowlist)", () => {
    const allowed = new Set([HUB_URL.toLowerCase()]);
    const own = new Set(["thestartupdeck.com.au"]);
    expect(classifyLink(HUB_URL, allowed, own)).toBe("keep");
  });
});
