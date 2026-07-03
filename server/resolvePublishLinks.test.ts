import { describe, it, expect } from "vitest";
import { resolvePublishLinks, buildLinkMap } from "./articleEngine";

describe("buildLinkMap — batch slug → live URL map", () => {
  it("maps published posts to their real URL and unpublished to null", () => {
    const map = buildLinkMap([
      { urlSlug: "/branding-strategies", cmsPostUrl: "https://skt.com/post/branding-strategies", status: "published" },
      { urlSlug: "brand-positioning", cmsPostUrl: null, status: "approved" },
    ]);
    // both "/slug" and "slug" key forms present
    expect(map["/branding-strategies"]).toBe("https://skt.com/post/branding-strategies");
    expect(map["branding-strategies"]).toBe("https://skt.com/post/branding-strategies");
    // approved-but-not-published → null (so its inbound links get dropped)
    expect(map["/brand-positioning"]).toBeNull();
    expect(map["brand-positioning"]).toBeNull();
  });

  it("treats published-without-a-URL as not live (null)", () => {
    const map = buildLinkMap([{ urlSlug: "x", cmsPostUrl: null, status: "published" }]);
    expect(map["/x"]).toBeNull();
  });

  it("catches an ABSOLUTE guessed URL to an unpublished post and drops it (no 404)", () => {
    // The exact live bug: link written as a full guessed URL, target not live.
    const body = `<p>Effective <a href="https://www.skrt.com.au/brand-positioning">brand positioning</a> matters.</p>`;
    const map = buildLinkMap([{ urlSlug: "brand-positioning", cmsPostUrl: null, status: "approved" }]);
    const r = resolvePublishLinks(body, map);
    expect(r.bodyHtml).not.toContain("<a "); // guessed live link removed
    expect(r.bodyHtml).toContain("brand positioning"); // text kept
    expect(r.warnings).toHaveLength(1);
  });

  it("rewrites an ABSOLUTE guessed URL to the real Wix /post/ URL once live", () => {
    const body = `<p><a href="https://www.skrt.com.au/brand-positioning">brand positioning</a></p>`;
    const map = buildLinkMap([
      { urlSlug: "brand-positioning", cmsPostUrl: "https://www.skrt.com.au/post/brand-positioning", status: "published" },
    ]);
    const r = resolvePublishLinks(body, map);
    expect(r.bodyHtml).toContain('href="https://www.skrt.com.au/post/brand-positioning"');
    expect(r.warnings).toHaveLength(0);
  });

  it("leaves genuine external links and the homepage untouched", () => {
    const body = `<p><a href="https://gov.au/fair-work">Fair Work</a> and <a href="https://www.skrt.com.au">home</a>.</p>`;
    const map = buildLinkMap([{ urlSlug: "brand-positioning", cmsPostUrl: "https://www.skrt.com.au/post/brand-positioning", status: "published" }]);
    const r = resolvePublishLinks(body, map);
    expect(r.bodyHtml).toContain('href="https://gov.au/fair-work"');
    expect(r.bodyHtml).toContain('href="https://www.skrt.com.au"');
    expect(r.warnings).toHaveLength(0);
  });

  it("end-to-end: a cornerstone published before its cluster drops the down-link, no 404", () => {
    // Cornerstone body links down to a cluster that isn't live yet.
    const body = `<p>See <a href="/handling-lateness">handling lateness</a>.</p>`;
    const map = buildLinkMap([
      { urlSlug: "handling-lateness", cmsPostUrl: null, status: "approved" }, // not live yet
    ]);
    const r = resolvePublishLinks(body, map);
    expect(r.bodyHtml).not.toContain("<a "); // link dropped
    expect(r.bodyHtml).toContain("handling lateness"); // text kept
    expect(r.warnings).toHaveLength(1);

    // Later, once the cluster is live, the SAME source body resolves to a real link.
    const mapLive = buildLinkMap([
      { urlSlug: "handling-lateness", cmsPostUrl: "https://skt.com/post/handling-lateness", status: "published" },
    ]);
    const r2 = resolvePublishLinks(body, mapLive);
    expect(r2.bodyHtml).toContain('href="https://skt.com/post/handling-lateness"');
    expect(r2.warnings).toHaveLength(0);
  });
});

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
