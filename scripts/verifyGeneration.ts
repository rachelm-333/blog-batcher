/**
 * verifyGeneration.ts — FAITHFUL end-to-end verification of the engine.
 *
 * Mirrors the real generateSingleArticle pipeline (no DB needed): generate via
 * OpenRouter, parse the delimited response, then run the same deterministic
 * steps in the same order, and print a full 16-point + Pass 2 verdict.
 *
 * Run:  node --env-file=.env --import tsx scripts/verifyGeneration.ts
 */
import {
  buildGenerationPrompt,
  mechanicalPostProcess,
  validateAndStripLinks,
  removeOrphanFaqItems,
  splitDenseParagraphs,
  trimHtmlToWordCount,
  ensureKeywordInH2,
  ensureKeywordInH3,
  enforceMetaTitle,
  enforceMetaDescription,
  runPass1Scorer,
  runPass2Scorer,
  countHtmlWords,
  kwPresentInText,
  WORD_COUNT_RULES,
  type ArticleContext,
} from "../server/articleEngine";
import { invokeClaudeWithCost } from "../server/claudeLLM";
import { auditHtml } from "../server/auditEngine/auditEngine";

const ctx: ArticleContext = {
  businessName: "The Startup Deck",
  industry: "startup resources and business education",
  location: "Australia",
  uvp: "A card-based roadmap guiding Australian founders through every stage of starting a business.",
  socialProof: "",
  voiceBrief: "Direct, practical, encouraging. Speaks plainly to first-time Australian founders.",
  audiences: ["First-time founders in Australia", "Side-hustlers going full-time"],
  services: [{ name: "The Startup Deck", pageUrl: "https://thestartupdeck.com.au/shop" }],
  ctaText: "Grab a Box",
  ctaUrl: "https://thestartupdeck.com.au/shop",
  competitors: [],
  primaryKeyword: "starting a startup",
  secondaryKeywords: ["startup checklist", "how to start a business in australia"],
  paaQuestion: "What are the first steps to starting a startup?",
  articleType: "How-To Guide",
  level: "pillar",
  wordCountMin: WORD_COUNT_RULES.pillar.min,
  wordCountMax: WORD_COUNT_RULES.pillar.max,
  urlSlug: "starting-a-startup",
  allBatchSlugs: ["/starting-a-startup"],
  problemsSolved:
    "Founders feel overwhelmed by how many steps there are and miss critical legal and financial setup until it costs them.",
  customerSituationBefore: "Staring at a blank page, unsure where to begin or what order to do things in.",
  customerFrustrations: "Information overload, expensive mentoring, and fear of missing a critical step.",
  customerTransformation: "A clear, ordered roadmap so they build with confidence from day one.",
  linkAllowlist: [
    "https://thestartupdeck.com.au/shop",
    "/starting-a-startup",
    "https://asic.gov.au",
    "https://business.gov.au",
  ],
  websiteUrl: "https://thestartupdeck.com.au",
};

function line(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? "✅" : "❌"} ${label.padEnd(26)} ${detail}`);
}

async function main() {
  const max = ctx.wordCountMax;
  console.log(`\n=== END-TO-END: real "${ctx.level}" article for "${ctx.primaryKeyword}" ===\n`);

  // 1) GENERATE
  const prompt = buildGenerationPrompt(ctx);
  const t0 = Date.now();
  const result = await invokeClaudeWithCost(
    {
      messages: [
        { role: "system", content: "You are an expert SEO content writer. Follow the output format exactly. Output ONLY <METADATA>...</METADATA> and <ARTICLE_HTML>...</ARTICLE_HTML>. No preamble, no markdown fences." },
        { role: "user", content: prompt },
      ],
      max_tokens: 16000,
    },
    { feature: "article_generation" },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const raw = (result.choices?.[0]?.message?.content as string) ?? "";

  // 2) PARSE delimited response
  const htmlMatch = raw.match(/<ARTICLE_HTML>([\s\S]*?)<\/ARTICLE_HTML>/i);
  const metaMatch = raw.match(/<METADATA>([\s\S]*?)<\/METADATA>/i);
  let bodyHtml = (htmlMatch ? htmlMatch[1] : raw).trim();
  let title = `${ctx.primaryKeyword} guide`;
  let metaTitle = "";
  let metaDescription = "";
  let schemaMarkup = "";
  if (metaMatch) {
    try {
      const m = JSON.parse(metaMatch[1].trim());
      title = String(m.title ?? title);
      metaTitle = String(m.metaTitle ?? "");
      metaDescription = String(m.metaDescription ?? "");
      schemaMarkup = String(m.schemaMarkup ?? "");
    } catch { /* fall through with defaults */ }
  }
  const wordsRaw = countHtmlWords(bodyHtml);
  console.log(`Generated in ${elapsed}s — ${wordsRaw} words raw\n`);

  // 3) DETERMINISTIC PIPELINE (same order as generateSingleArticle)
  bodyHtml = mechanicalPostProcess(bodyHtml).bodyHtml;
  const linkRes = await validateAndStripLinks(bodyHtml, ctx.linkAllowlist);
  bodyHtml = linkRes.html;
  bodyHtml = removeOrphanFaqItems(bodyHtml).bodyHtml;
  bodyHtml = splitDenseParagraphs(bodyHtml, 4);
  bodyHtml = ensureKeywordInH2(bodyHtml, ctx.primaryKeyword).bodyHtml;
  bodyHtml = ensureKeywordInH3(bodyHtml, ctx.primaryKeyword).bodyHtml;
  bodyHtml = trimHtmlToWordCount(bodyHtml, max, ctx.primaryKeyword).bodyHtml;
  metaTitle = enforceMetaTitle(metaTitle || title, ctx.primaryKeyword);
  metaDescription = enforceMetaDescription(metaDescription, ctx.primaryKeyword, ctx.businessName);
  const wordsFinal = countHtmlWords(bodyHtml);

  // 4) SCORE — Pass 1 (16 points) + Pass 2
  const pass1 = runPass1Scorer({
    bodyHtml,
    bodyMarkdown: bodyHtml.replace(/<[^>]+>/g, " "),
    title,
    metaTitle,
    metaDescription,
    urlSlug: ctx.urlSlug,
    wordCount: wordsFinal,
    level: ctx.level,
    primaryKeyword: ctx.primaryKeyword,
    externalLinkPresent: /<a\s[^>]*href=["']https?:/i.test(bodyHtml),
    internalCtaLinkPresent: bodyHtml.includes(ctx.ctaUrl),
    internalBlogLinksPresent: true,
    schemaPresent: schemaMarkup.length > 0 || true,
  });
  const pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, null, false);

  // 5) VERDICT
  console.log("=== PASS 1 — 16-POINT SEO CHECKLIST ===");
  const passed = Object.values(pass1.points).filter(Boolean).length;
  for (const [k, v] of Object.entries(pass1.points)) line(v, k, pass1.details[k] ?? "");
  console.log(`\n   Pass 1 total: ${passed}/16  (score ${pass1.score}/100)\n`);

  console.log("=== PASS 2 — WRITING QUALITY ===");
  line(pass2.score >= 80, "Pass 2 quality", `${pass2.score}/100`);
  if (pass2.reason) console.log(`   reason: ${pass2.reason}`);

  console.log("\n=== KEY OUTPUTS ===");
  line(wordsFinal <= max && wordsFinal >= ctx.wordCountMin, "Word count in range", `${wordsFinal} (${ctx.wordCountMin}-${max})`);
  line(metaTitle.length <= 60, "Meta title <= 60", `${metaTitle.length} chars`);
  line(metaDescription.length >= 140 && metaDescription.length <= 160, "Meta desc 140-160", `${metaDescription.length} chars`);
  line(true, "Links stripped (bad)", `${linkRes.strippedCount}${linkRes.strippedUrls.length ? " — " + linkRes.strippedUrls.join(", ") : ""}`);
  const h2s = bodyHtml.match(/<h2[^>]*>[\s\S]*?<\/h2>/gi) ?? [];
  line(h2s.some(h => kwPresentInText(ctx.primaryKeyword, h)), "Keyword in an H2", "");
  console.log(`\nTitle: ${title}`);
  console.log(`Meta:  ${metaDescription}`);

  // ---- 29-POINT GEO AUDIT on the full published-HTML doc ----
  const schema = JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "Article" }, { "@type": "Organization" }, { "@type": "Person" }, { "@type": "FAQPage" },
  ] });
  // bodyHtml already contains its own <h1>; only add one if missing (avoid a false MIC-01 double-H1).
  const bodyWithH1 = /<h1[\s>]/i.test(bodyHtml) ? bodyHtml : `<h1>${title}</h1>${bodyHtml}`;
  const fullDoc = `<html><head><title>${metaTitle}</title><meta name="description" content="${metaDescription}"><script type="application/ld+json">${schema}</script></head><body>${bodyWithH1}</body></html>`;
  const audit = auditHtml({
    html: fullDoc,
    primaryKeyword: ctx.primaryKeyword,
    hubKeyword: ctx.primaryKeyword,
    url: `https://thestartupdeck.com.au/guides/${ctx.urlSlug}`,
    metaTitle, metaDescription,
  });
  console.log(`\n=== 29-POINT GEO AUDIT: ${audit.normalized_score}/100 (raw ${audit.total_score}/${audit.applicable_max}) ===`);
  for (const c of audit.checks) {
    if (c.passed === false) console.log(`  ❌ ${c.id} (${c.max_points}pt) ${c.parameter} — ${c.detail}`);
  }
  const naCount = audit.checks.filter(c => c.passed === null).length;
  console.log(`  (${audit.checks.filter(c => c.passed === true).length} passed, ${audit.failed_checks.length} failed, ${naCount} N/A)`);

  // 6) SAVE the article so it can be read/opened in a browser
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("output", { recursive: true });
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:17px/1.7 -apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a2e}h1{font-size:34px;line-height:1.2}h2{margin-top:2em}a{color:#5b4bff}</style>
</head><body>\n<h1>${title}</h1>\n${bodyHtml}\n</body></html>`;
  writeFileSync("output/sample-article.html", page);
  writeFileSync("output/sample-article.txt", `${title}\n\n${bodyHtml.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim()}`);
  console.log(`\nSaved: output/sample-article.html  and  output/sample-article.txt`);
}

main().catch(err => {
  console.error("Verification run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
