import { describe, it, expect } from "vitest";
import { slugToPostUrl, rewriteInternalLinks, cmsBlogPathPrefix } from "../shared/cmsUrlHelper";

describe("cmsBlogPathPrefix", () => {
  it("returns /post for wix", () => {
    expect(cmsBlogPathPrefix("wix")).toBe("/post");
  });
  it("returns /blog for squarespace", () => {
    expect(cmsBlogPathPrefix("squarespace")).toBe("/blog");
  });
  it("returns /blogs/news for shopify", () => {
    expect(cmsBlogPathPrefix("shopify")).toBe("/blogs/news");
  });
  it("returns /blog for webflow", () => {
    expect(cmsBlogPathPrefix("webflow")).toBe("/blog");
  });
  it("returns empty string for ghost (root)", () => {
    expect(cmsBlogPathPrefix("ghost")).toBe("");
  });
  it("returns empty string for wordpress by default", () => {
    expect(cmsBlogPathPrefix("wordpress")).toBe("");
  });
  it("returns custom prefix for wordpress when provided", () => {
    expect(cmsBlogPathPrefix("wordpress", { wordpressPathPrefix: "/blog" })).toBe("/blog");
  });
  it("returns empty string for zapier", () => {
    expect(cmsBlogPathPrefix("zapier")).toBe("");
  });
  it("returns empty string for download", () => {
    expect(cmsBlogPathPrefix("download")).toBe("");
  });
  it("returns empty string for null/undefined", () => {
    expect(cmsBlogPathPrefix(null)).toBe("");
    expect(cmsBlogPathPrefix(undefined)).toBe("");
  });
});

describe("slugToPostUrl", () => {
  const site = "https://www.example.com";

  it("builds wix URL correctly", () => {
    expect(slugToPostUrl("branding-strategies", "wix", site))
      .toBe("https://www.example.com/post/branding-strategies");
  });

  it("strips leading slash from slug", () => {
    expect(slugToPostUrl("/branding-strategies", "wix", site))
      .toBe("https://www.example.com/post/branding-strategies");
  });

  it("strips trailing slash from slug", () => {
    expect(slugToPostUrl("branding-strategies/", "wix", site))
      .toBe("https://www.example.com/post/branding-strategies");
  });

  it("strips trailing slash from siteUrl", () => {
    expect(slugToPostUrl("branding-strategies", "wix", "https://www.example.com/"))
      .toBe("https://www.example.com/post/branding-strategies");
  });

  it("builds squarespace URL correctly", () => {
    expect(slugToPostUrl("brand-guide", "squarespace", site))
      .toBe("https://www.example.com/blog/brand-guide");
  });

  it("builds shopify URL correctly", () => {
    expect(slugToPostUrl("brand-guide", "shopify", site))
      .toBe("https://www.example.com/blogs/news/brand-guide");
  });

  it("builds webflow URL correctly", () => {
    expect(slugToPostUrl("brand-guide", "webflow", site))
      .toBe("https://www.example.com/blog/brand-guide");
  });

  it("builds ghost URL correctly (root)", () => {
    expect(slugToPostUrl("brand-guide", "ghost", site))
      .toBe("https://www.example.com/brand-guide");
  });

  it("builds wordpress URL at root by default", () => {
    expect(slugToPostUrl("brand-guide", "wordpress", site))
      .toBe("https://www.example.com/brand-guide");
  });

  it("falls back to relative path when siteUrl is null", () => {
    expect(slugToPostUrl("brand-guide", "wix", null))
      .toBe("/post/brand-guide");
  });

  it("falls back to relative path when siteUrl is empty string", () => {
    expect(slugToPostUrl("brand-guide", "wix", ""))
      .toBe("/post/brand-guide");
  });

  it("falls back to relative path for unknown platform", () => {
    expect(slugToPostUrl("brand-guide", null, site))
      .toBe("https://www.example.com/brand-guide");
  });
});

describe("rewriteInternalLinks", () => {
  const slugMap = {
    "branding-strategies": "https://www.example.com/post/branding-strategies",
    "brand-guide": "https://www.example.com/post/brand-guide",
  };

  it("rewrites relative href with leading slash", () => {
    const html = `<a href="/branding-strategies">Read more</a>`;
    expect(rewriteInternalLinks(html, slugMap))
      .toBe(`<a href="https://www.example.com/post/branding-strategies">Read more</a>`);
  });

  it("rewrites relative href without leading slash", () => {
    const html = `<a href="branding-strategies">Read more</a>`;
    expect(rewriteInternalLinks(html, slugMap))
      .toBe(`<a href="https://www.example.com/post/branding-strategies">Read more</a>`);
  });

  it("does not rewrite external https links", () => {
    const html = `<a href="https://www.google.com">Google</a>`;
    expect(rewriteInternalLinks(html, slugMap)).toBe(html);
  });

  it("does not rewrite anchor links", () => {
    const html = `<a href="#section-1">Jump</a>`;
    expect(rewriteInternalLinks(html, slugMap)).toBe(html);
  });

  it("does not rewrite hrefs not in the slug map", () => {
    const html = `<a href="/unknown-page">Unknown</a>`;
    expect(rewriteInternalLinks(html, slugMap)).toBe(html);
  });

  it("rewrites multiple links in the same HTML", () => {
    const html = `<a href="/branding-strategies">A</a> and <a href="/brand-guide">B</a>`;
    const result = rewriteInternalLinks(html, slugMap);
    expect(result).toContain("https://www.example.com/post/branding-strategies");
    expect(result).toContain("https://www.example.com/post/brand-guide");
  });

  it("returns original html unchanged when slugMap is empty", () => {
    const html = `<a href="/branding-strategies">Read more</a>`;
    expect(rewriteInternalLinks(html, {})).toBe(html);
  });

  it("returns empty string unchanged", () => {
    expect(rewriteInternalLinks("", slugMap)).toBe("");
  });
});
