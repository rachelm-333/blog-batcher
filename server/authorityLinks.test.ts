import { describe, it, expect } from "vitest";
import { getAuthorityLinks, authorityPromptBlock } from "./authorityLinks";

describe("getAuthorityLinks", () => {
  it("matches an industry and includes a .gov/.edu source", () => {
    const r = getAuthorityLinks("financial planning and accounting");
    expect(r.govEdu.some((u) => /\.gov(\.au)?\b/.test(u))).toBe(true);
    expect(r.govEdu).toContain("https://www.ato.gov.au");
  });
  it("always returns a gov/edu fallback even for an unknown industry", () => {
    const r = getAuthorityLinks("underwater basket weaving");
    expect(r.govEdu.length).toBeGreaterThan(0);
    expect(r.govEdu).toContain("https://business.gov.au");
  });
  it("merges global authorities into general", () => {
    const r = getAuthorityLinks("marketing agency");
    expect(r.general).toContain("https://www.hubspot.com"); // industry-specific
    expect(r.general).toContain("https://hbr.org");          // global
  });
  it("authorityPromptBlock lists real sources", () => {
    const p = authorityPromptBlock("health clinic");
    expect(p).toMatch(/SUGGESTED AUTHORITY SOURCES/);
    expect(p).toContain("health.gov.au");
  });
});
