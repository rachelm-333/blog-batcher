import { describe, it, expect } from "vitest";
import { removeOrphanFaqItems } from "./articleEngine";

const Q_NO_ANSWER = `<div class="faq-item"><hr><p><strong>Q: Do I need a business plan?</strong></p></div>`;
const Q_WITH_ANSWER = `<div class="faq-item"><hr><p><strong>Q: How much does it cost?</strong></p><p>A: About $506 through ASIC.</p></div>`;

describe("removeOrphanFaqItems — dangling FAQ question bug", () => {
  it("removes a FAQ item that has a question but no answer", () => {
    const html = `<h2>FAQ</h2>${Q_WITH_ANSWER}${Q_NO_ANSWER}<h2>CTA</h2>`;
    const result = removeOrphanFaqItems(html);
    expect(result.removed).toBe(1);
    expect(result.bodyHtml).not.toContain("Do I need a business plan");
    expect(result.bodyHtml).toContain("How much does it cost"); // complete one kept
  });

  it("keeps complete FAQ items untouched", () => {
    const html = `<h2>FAQ</h2>${Q_WITH_ANSWER}`;
    const result = removeOrphanFaqItems(html);
    expect(result.removed).toBe(0);
    expect(result.bodyHtml).toBe(html);
  });

  it("removes an item whose answer paragraph is empty", () => {
    const html = `<div class="faq-item"><p><strong>Q: X?</strong></p><p>   </p></div>`;
    const result = removeOrphanFaqItems(html);
    expect(result.removed).toBe(1);
  });

  it("is a no-op when there are no faq-item divs", () => {
    const html = `<h2>Body</h2><p>No FAQ here.</p>`;
    const result = removeOrphanFaqItems(html);
    expect(result.removed).toBe(0);
    expect(result.bodyHtml).toBe(html);
  });

  it("handles several orphans and keeps several complete ones", () => {
    const html = `${Q_WITH_ANSWER}${Q_NO_ANSWER}${Q_WITH_ANSWER}${Q_NO_ANSWER}`;
    const result = removeOrphanFaqItems(html);
    expect(result.removed).toBe(2);
    expect((result.bodyHtml.match(/faq-item/g) ?? []).length).toBe(2);
  });
});
