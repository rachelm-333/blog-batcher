import { describe, it, expect } from "vitest";
import { mechanicalPostProcess } from "./articleEngine";

describe("Anti-AI vocabulary scrub (mechanicalPostProcess)", () => {
  const scrub = (s: string) => mechanicalPostProcess(s).bodyHtml.toLowerCase();

  it("removes banned verbs", () => {
    const out = scrub("<p>We delve into this, then navigate and unpack it, foster growth, and spearhead change.</p>");
    for (const w of ["delve", "navigate", "unpack", "foster", "spearhead"]) {
      expect(out).not.toContain(w);
    }
  });

  it("removes banned adjectives/nouns", () => {
    const out = scrub("<p>A bustling seamless tapestry across the landscape and realm with myriad paramount options.</p>");
    for (const w of ["bustling", "seamless", "tapestry", "landscape", "realm", "myriad", "paramount"]) {
      expect(out).not.toContain(w);
    }
  });

  it("removes banned transitions", () => {
    const out = scrub("<p>Furthermore, this works. Moreover, it scales. Additionally, it ships. In conclusion, done.</p>");
    for (const w of ["furthermore", "moreover", "additionally", "in conclusion"]) {
      expect(out).not.toContain(w);
    }
  });

  it("removes banned phrases", () => {
    const out = scrub("<p>In today's fast-paced world, this ever-evolving double-edged sword is a testament to progress.</p>");
    expect(out).not.toContain("fast-paced world");
    expect(out).not.toContain("ever-evolving");
    expect(out).not.toContain("double-edged sword");
    expect(out).not.toContain("testament to");
  });

  it("leaves clean text intact", () => {
    const clean = "<p>Register your ABN, open a business account, and start selling.</p>";
    expect(mechanicalPostProcess(clean).bodyHtml).toContain("Register your ABN");
  });
});
