import { describe, it, expect } from "vitest";
import { classifyLink } from "./articleEngine";

// Real allowlist: business pages + a real article slug + a real competitor URL
const allowlist = [
  "https://thestartupdeck.com.au/shop",
  "https://thestartupdeck.com.au",
  "/starting-a-startup",
  "https://asic.gov.au",
];
const allowedExact = new Set(allowlist.map(u => u.toLowerCase().replace(/\/$/, "")));
const ownDomains = new Set(["thestartupdeck.com.au"]);

describe("classifyLink — fake-404-link prevention", () => {
  it("keeps an exact allowlisted business page", () => {
    expect(classifyLink("https://thestartupdeck.com.au/shop", allowedExact, ownDomains)).toBe("keep");
  });

  it("keeps an exact allowlisted relative article slug", () => {
    expect(classifyLink("/starting-a-startup", allowedExact, ownDomains)).toBe("keep");
  });

  it("STRIPS an invented page on our own domain (the SEO-killing bug)", () => {
    // This is the exact failure mode: a made-up path on the business's own site.
    expect(classifyLink("https://thestartupdeck.com.au/totally-made-up-page", allowedExact, ownDomains)).toBe("strip");
  });

  it("STRIPS an invented relative link", () => {
    expect(classifyLink("/our-amazing-services", allowedExact, ownDomains)).toBe("strip");
  });

  it("live-checks a genuine external authority link not in the allowlist", () => {
    expect(classifyLink("https://business.gov.au", allowedExact, ownDomains)).toBe("live-check");
  });

  it("keeps an exact allowlisted external authority link without a live-check", () => {
    expect(classifyLink("https://asic.gov.au", allowedExact, ownDomains)).toBe("keep");
  });

  it("keeps anchors, mailto and tel links", () => {
    expect(classifyLink("#section", allowedExact, ownDomains)).toBe("keep");
    expect(classifyLink("mailto:hi@x.com", allowedExact, ownDomains)).toBe("keep");
    expect(classifyLink("tel:+61400000000", allowedExact, ownDomains)).toBe("keep");
  });

  it("does NOT treat a deep path as allowed just because the root domain is (the old startsWith bug)", () => {
    // Old code: hrefNorm.startsWith(allowlistRoot) -> any same-domain path passed.
    expect(classifyLink("https://thestartupdeck.com.au/fake/deep/path", allowedExact, ownDomains)).toBe("strip");
  });
});
