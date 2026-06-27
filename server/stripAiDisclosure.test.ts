import { describe, it, expect } from "vitest";
import { stripAiDisclosure } from "../shared/stripAiDisclosure";

const FAQ = `<h2>Frequently Asked Questions</h2>
<div class="faq-item"><hr><p><strong>Q: What are the first steps?</strong></p><p>A: Validate your idea first.</p></div>
<div class="faq-item"><hr><p><strong>Q: How much does it cost?</strong></p><p>A: ABN is free.</p></div>`;

describe("stripAiDisclosure — the body-deleting regex bug", () => {
  it("removes ONLY the disclosure paragraph, keeping FAQ + everything before it", () => {
    const body = `<p>Intro answer block.</p><h2>Why it matters</h2><p>Because reasons.</p>${FAQ}<h2>Ready?</h2><p>Book a call.</p><p>This article was researched and drafted with AI assistance and reviewed for accuracy.</p>`;
    const out = stripAiDisclosure(body);
    expect((out.match(/faq-item/g) ?? []).length).toBe(2); // FAQ survives
    expect(out).toContain("Validate your idea first");
    expect(out).toContain("ABN is free");
    expect(out).toContain("Book a call"); // CTA survives
    expect(out).toContain("Intro answer block"); // intro survives
    expect(out).not.toContain("This article was researched"); // disclosure gone
  });

  it("removes a disclosure paragraph marked by class", () => {
    const body = `<p>Body.</p><p class="ai-disclosure">AI was used to draft this.</p>`;
    const out = stripAiDisclosure(body);
    expect(out).toContain("Body.");
    expect(out).not.toContain("AI was used to draft this");
  });

  it("is a no-op when there is no disclosure", () => {
    const body = `<p>Just content.</p>${FAQ}`;
    const out = stripAiDisclosure(body);
    expect((out.match(/faq-item/g) ?? []).length).toBe(2);
    expect(out).toContain("Just content.");
  });

  it("does NOT delete the whole body when the disclosure is at the end (the original bug)", () => {
    const body = `<p>First paragraph that must survive.</p><p>Second paragraph.</p><p>This article was researched and drafted with AI assistance.</p>`;
    const out = stripAiDisclosure(body);
    expect(out).toContain("First paragraph that must survive");
    expect(out).toContain("Second paragraph");
    expect(out).not.toContain("This article was researched");
  });

  it("handles empty / null input", () => {
    expect(stripAiDisclosure("")).toBe("");
    // @ts-expect-error testing null safety
    expect(stripAiDisclosure(null)).toBe("");
  });
});
