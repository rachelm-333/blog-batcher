import { describe, it, expect } from "vitest";
import { resolvePublishLinks } from "./articleEngine";

describe("resolvePublishLinks — publish-time link resolution (no-404 rule)", () => {
  it("rewrites a placeholder slug to the parent's real published CMS URL", () => {
    const body = `<p>Read our <a href="/starting-a-business">starting a business</a> guide.</p>`;
    const r = resolvePublishLinks(body, { "/starting-a-business": "https://site.com/post/starting-a-business" });
    expect(r.bodyHtml).toContain('href="https://site.com/post/starting-a-business"');
    expect(r.bodyHtml).toContain(">starting a business</a>"); // anchor text preserved
    expect(r.warnings).toHaveLength(0);
  });

  it("drops a link whose target is NOT published yet (keeps anchor text) + warns", () => {
    const body = `<p>See our <a href="/second-warning">handling a second warning</a> post.</p>`;
    const r = resolvePublishLinks(body, { "/second-warning": null });
    expect(r.bodyHtml).not.toContain("<a");
    expect(r.bodyHtml).toContain("handling a second warning"); // text kept
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("not published yet");
  });

  it("leaves non-batch internal links (live business pages) untouched", () => {
    const body = `<p>Visit our <a href="/shop">shop</a>.</p>`;
    const r = resolvePublishLinks(body, { "/some-article": null });
    expect(r.bodyHtml).toContain('<a href="/shop">shop</a>');
  });

  it("preserves the exact-match anchor when rewriting (MAC-09 stays valid)", () => {
    const body = `<p>Understand <a href="/employment-law">employment law</a> first.</p>`;
    const r = resolvePublishLinks(body, { "/employment-law": "https://site.com/post/employment-law" });
    const anchor = (r.bodyHtml.match(/<a[^>]*>([^<]+)<\/a>/) ?? [])[1];
    expect(anchor).toBe("employment law");
  });

  it("handles a mix: one published, one not", () => {
    const body = `<p><a href="/pillar">pillar</a> and <a href="/draft">draft</a></p>`;
    const r = resolvePublishLinks(body, { "/pillar": "https://site.com/post/pillar", "/draft": null });
    expect(r.bodyHtml).toContain('href="https://site.com/post/pillar"');
    expect(r.bodyHtml).not.toContain('href="/draft"');
    expect(r.warnings).toHaveLength(1);
  });
});
