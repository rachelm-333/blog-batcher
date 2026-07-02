import { describe, it, expect } from "vitest";
import { findBackfillTargets, type BackfillArticle } from "../shared/backfillLinks";

// Cornerstone links DOWN to a cluster. Cornerstone published day 1, cluster day 15.
const cornerstone: BackfillArticle = {
  id: 1,
  urlSlug: "/branding-strategies",
  cmsPostId: "wix-cs",
  cmsPostUrl: "https://skt.com/post/branding-strategies",
  status: "published",
  publishedAt: 1000,
  bodyHtml: `<p>See our guide on <a href="/handling-lateness">handling lateness</a>.</p>`,
};
const cluster: BackfillArticle = {
  id: 2,
  urlSlug: "/handling-lateness",
  cmsPostId: "wix-cl",
  cmsPostUrl: "https://skt.com/post/handling-lateness",
  status: "published",
  publishedAt: 2000, // went live AFTER the cornerstone
  bodyHtml: `<p>Back to the <a href="/branding-strategies">main guide</a>.</p>`,
};

describe("findBackfillTargets", () => {
  it("flags the cornerstone once its later-published cluster is live", () => {
    const targets = findBackfillTargets([cornerstone, cluster]);
    const cs = targets.find((t) => t.articleId === 1);
    expect(cs).toBeTruthy();
    expect(cs!.restoredLinks).toEqual([
      { slug: "handling-lateness", url: "https://skt.com/post/handling-lateness" },
    ]);
    expect(cs!.cmsPostId).toBe("wix-cs");
  });

  it("does NOT flag the cluster (it published after the cornerstone, so its up-link was already live)", () => {
    const targets = findBackfillTargets([cornerstone, cluster]);
    // cluster references branding-strategies, which went live BEFORE it → already had the link.
    expect(targets.find((t) => t.articleId === 2)).toBeUndefined();
  });

  it("ignores references to posts that are not live yet", () => {
    const notLive: BackfillArticle = { ...cluster, status: "approved", cmsPostUrl: null, publishedAt: null };
    const targets = findBackfillTargets([cornerstone, notLive]);
    expect(targets).toHaveLength(0); // cluster isn't live, so nothing to restore
  });

  it("ignores absolute external links", () => {
    const a: BackfillArticle = {
      ...cornerstone,
      bodyHtml: `<p><a href="https://gov.au/fair-work">Fair Work</a></p>`,
    };
    expect(findBackfillTargets([a, cluster])).toHaveLength(0);
  });

  it("returns nothing when the whole batch published together (no ordering gap)", () => {
    const a = { ...cornerstone, publishedAt: 5000 };
    const b = { ...cluster, publishedAt: 5000 }; // same timestamp → not 'after'
    expect(findBackfillTargets([a, b])).toHaveLength(0);
  });

  it("handles a post referencing multiple later-published posts", () => {
    const hub: BackfillArticle = {
      ...cornerstone,
      bodyHtml: `<p><a href="/handling-lateness">a</a> and <a href="/second-warning">b</a></p>`,
    };
    const second: BackfillArticle = {
      id: 3,
      urlSlug: "/second-warning",
      cmsPostId: "wix-2",
      cmsPostUrl: "https://skt.com/post/second-warning",
      status: "published",
      publishedAt: 3000,
      bodyHtml: `<p>x</p>`,
    };
    const t = findBackfillTargets([hub, cluster, second]);
    const csTarget = t.find((x) => x.articleId === 1)!;
    expect(csTarget.restoredLinks).toHaveLength(2);
  });
});
