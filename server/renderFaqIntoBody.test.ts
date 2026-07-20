import { describe, it, expect } from "vitest";
import { renderFaqIntoBody } from "./articleEngine";

const items = [
  { question: "What is brand positioning?", answer: "The space you own in the mind." },
  { question: "How much does it cost?", answer: "Between 5k and 50k." },
];

describe("renderFaqIntoBody", () => {
  it("fills empty faq-item shells with the saved Q&A after the heading", () => {
    const body = `<p>intro</p><h2>Frequently Asked Questions</h2>
<div class="faq-item"><hr></div>
<div class="faq-item"><hr></div>
<h2>Ready to Build?</h2>`;
    const out = renderFaqIntoBody(body, items);
    expect(out).toContain("What is brand positioning?");
    expect(out).toContain("Between 5k and 50k.");
    // no empty shells left
    expect(/faq-item[^>]*>\s*<hr>\s*<\/div>/i.test(out)).toBe(false);
  });

  it("appends a FAQ section when there's no heading", () => {
    const out = renderFaqIntoBody(`<p>body only</p>`, items);
    expect(out).toContain("<h2>Frequently Asked Questions</h2>");
    expect(out).toContain("What is brand positioning?");
  });

  it("returns the body unchanged when there are no faqItems", () => {
    const body = `<p>x</p>`;
    expect(renderFaqIntoBody(body, null)).toBe(body);
    expect(renderFaqIntoBody(body, [])).toBe(body);
  });

  it("skips items missing a question or answer", () => {
    const out = renderFaqIntoBody(`<h2>Frequently Asked Questions</h2>`, [
      { question: "Good?", answer: "Yes." },
      { question: "", answer: "orphan" },
    ] as any);
    expect(out).toContain("Good?");
    expect(out).not.toContain("orphan");
  });
});
