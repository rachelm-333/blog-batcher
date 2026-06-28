import { describe, it, expect } from "vitest";
import { auditHtml, AUDIT_MAX_POINTS } from "./auditEngine";
import { AUDIT_RULES } from "./auditRules";

const GOOD_HTML = `
<html><head>
<title>Brand Strategy in Australia: Complete Guide</title>
<meta name="description" content="Brand strategy guide for Australian businesses. Learn the framework that drives growth.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"Article","headline":"Brand Strategy"},
  {"@type":"FAQPage"},
  {"@type":"Organization","name":"X"},
  {"@type":"Person","name":"Jane Smith"}
]}</script>
</head><body>
<h1>Brand Strategy in Australia: Complete Guide</h1>
<p>Brand strategy is the long-term plan that defines how you compete. In our experience testing this with 40 clients, the businesses that win define strategy first.</p>
<h2>What is brand strategy?</h2>
<p>Brand strategy is your long-term plan for how your brand will position itself and win in the market. It guides every decision from identity to pricing.</p>
<h3>Step 1: Define your position</h3>
<p>Pick one clear position. Premium, accessible, or specialist. This decision drives everything else.</p>
<ul><li>Define your audience</li><li>Pick your position</li><li>Document your message</li></ul>
<table><tr><th>Option</th><th>Cost</th></tr><tr><td>Sole trader</td><td>$0</td></tr></table>
<h2>How much does brand strategy cost in Australia?</h2>
<p>Most Australian businesses spend between $5,000 and $20,000 on a full brand strategy. Costs depend on scope and agency experience.</p>
<p>A common mistake is skipping validation, which wastes money. Avoid that pitfall.</p>
<blockquote>Strategy beats tactics every time. — Jane Smith, Brand Director</blockquote>
<p>See the official guidance from <a href="https://business.gov.au">business.gov.au</a> and <a href="https://asic.gov.au">ASIC</a>.</p>
<p><a href="/pillar-brand-strategy">brand strategy</a> ties this cluster to its hub.</p>
<p>Around 70% of founders report better results with a documented strategy.</p>
</body></html>`;

const BAD_HTML = `
<html><head><title>Pricing</title></head><body>
<h1>Stuff</h1>
<h1>Another H1</h1>
<h2>Pricing</h2>
<p>When looking at the history of this topic, many people delve into the bustling tapestry of options. Moreover it is a testament to the landscape. The price is set by the market and is determined by many factors. It was decided by committee. Things are influenced by trends. Decisions were made by stakeholders. The outcome was shaped by forces beyond control. Everything is connected to everything else.</p>
</body></html>`;

describe("29-point audit engine", () => {
  it("has exactly 29 rules and weights summing to 100", () => {
    expect(AUDIT_RULES.length).toBe(29 - 0); // 13 + 8 + 8 = 29
    expect(AUDIT_MAX_POINTS).toBe(100);
  });

  it("scores a well-formed GEO article highly", () => {
    const r = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy", hubKeyword: "brand strategy" });
    // live checks (CWV, llms.txt) not provided → excluded from denominator
    expect(r.normalized_score).toBeGreaterThanOrEqual(90);
  });

  it("scores a poor article low", () => {
    const r = auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" });
    expect(r.normalized_score).toBeLessThan(40);
  });

  it("returns failed_checks with id + parameter (Gemini output format)", () => {
    const r = auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" });
    expect(Array.isArray(r.failed_checks)).toBe(true);
    expect(r.failed_checks[0]).toHaveProperty("id");
    expect(r.failed_checks[0]).toHaveProperty("parameter");
  });

  it("MIC-01 catches multiple H1s", () => {
    const r = auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" });
    expect(r.checks.find(c => c.id === "MIC-01")?.passed).toBe(false);
  });

  it("EAT-08 catches blocklisted buzzwords", () => {
    const r = auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" });
    expect(r.checks.find(c => c.id === "EAT-08")?.passed).toBe(false); // delve/tapestry/etc present
    const good = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy" });
    expect(good.checks.find(c => c.id === "EAT-08")?.passed).toBe(true);
  });

  it("MIC-03 passes when H2s are questions, fails when not", () => {
    expect(auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy" }).checks.find(c => c.id === "MIC-03")?.passed).toBe(true);
    expect(auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" }).checks.find(c => c.id === "MIC-03")?.passed).toBe(false);
  });

  it("MIC-06 lists + MIC-07 table detected in the good article", () => {
    const r = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy" });
    expect(r.checks.find(c => c.id === "MIC-06")?.passed).toBe(true);
    expect(r.checks.find(c => c.id === "MIC-07")?.passed).toBe(true);
  });

  it("MIC-08 flags the giant dense paragraph", () => {
    const r = auditHtml({ html: BAD_HTML, primaryKeyword: "pricing" });
    expect(r.checks.find(c => c.id === "MIC-08")?.passed).toBe(false);
  });

  it("MAC-06 FAQPage + MAC-08 Author schema detected", () => {
    const r = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy" });
    expect(r.checks.find(c => c.id === "MAC-06")?.passed).toBe(true);
    expect(r.checks.find(c => c.id === "MAC-08")?.passed).toBe(true);
  });

  it("live-only checks are N/A without a URL, and counted when provided", () => {
    const noUrl = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy" });
    expect(noUrl.checks.find(c => c.id === "MAC-12")?.passed).toBe(null);
    expect(noUrl.applicable_max).toBeLessThan(100);

    const withLive = auditHtml({
      html: GOOD_HTML, primaryKeyword: "brand strategy",
      liveChecks: { coreWebVitalsPass: true, llmsTxtPresent: true },
    });
    expect(withLive.checks.find(c => c.id === "MAC-12")?.passed).toBe(true);
  });

  it("MAC-01 URL silo passes for clean nested path, fails for dated path", () => {
    const clean = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy", url: "https://x.com/marketing/brand-strategy" });
    expect(clean.checks.find(c => c.id === "MAC-01")?.passed).toBe(true);
    const dated = auditHtml({ html: GOOD_HTML, primaryKeyword: "brand strategy", url: "https://x.com/blog/2026/06/post" });
    expect(dated.checks.find(c => c.id === "MAC-01")?.passed).toBe(false);
  });
});
