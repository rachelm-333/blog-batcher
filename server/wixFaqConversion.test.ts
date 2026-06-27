import { describe, it, expect } from "vitest";
import { htmlToRicos } from "./cmsPublisher";
import { stripAiDisclosure } from "../shared/stripAiDisclosure";

/** The exact FAQ structure the engine emits — div.faq-item wrappers with hr + Q + A. */
const ARTICLE = `<h1>Brand Strategy</h1>
<p><strong>What is brand strategy?</strong> It is the long-term plan.</p>
<h2>What Brand Strategy Means</h2>
<p>Brand strategy is your roadmap.</p>
<h2>Frequently Asked Questions</h2>
<div class="faq-item"><hr><p><strong>Q: What is the first step?</strong></p><p>A: Define your audience clearly.</p></div>
<div class="faq-item"><hr><p><strong>Q: How long does it take?</strong></p><p>A: Around six to eight weeks.</p></div>
<h2>Ready to Build Strategy?</h2>
<p>Book a call with us today.</p>
<p>This article was researched and drafted with AI assistance.</p>`;

describe("Wix Ricos conversion — FAQ must survive (empty-FAQ-on-Wix bug)", () => {
  const json = JSON.stringify(htmlToRicos(stripAiDisclosure(ARTICLE)));

  it("keeps every FAQ question and answer through the Wix conversion", () => {
    expect(json).toContain("What is the first step");
    expect(json).toContain("Define your audience");
    expect(json).toContain("How long does it take");
    expect(json).toContain("six to eight weeks");
  });

  it("keeps the intro, body, and CTA", () => {
    expect(json).toContain("long-term plan");
    expect(json).toContain("your roadmap");
    expect(json).toContain("Book a call");
  });

  it("removes the AI disclosure before conversion", () => {
    expect(json).not.toContain("researched and drafted with AI assistance");
  });
});
