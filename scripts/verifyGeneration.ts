/**
 * verifyGeneration.ts — REAL end-to-end verification of the engine fixes.
 *
 * Runs an actual article through OpenRouter (no database needed), then through
 * the deterministic pipeline (trim, keyword-in-H2, Pass 1, Pass 2) and prints
 * a clear pass/fail verdict for each of the three recurring bugs.
 *
 * Run with:  node --env-file=.env --import tsx scripts/verifyGeneration.ts
 */
import {
  buildGenerationPrompt,
  trimHtmlToWordCount,
  ensureKeywordInH2,
  runPass1Scorer,
  runPass2Scorer,
  countHtmlWords,
  kwPresentInText,
  WORD_COUNT_RULES,
  type ArticleContext,
} from "../server/articleEngine";
import { invokeClaudeWithCost } from "../server/claudeLLM";

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

function line(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✅" : "❌"} ${label.padEnd(28)} ${detail}`);
}

async function main() {
  const max = ctx.wordCountMax;
  console.log(`\n=== Generating a real "${ctx.level}" article for "${ctx.primaryKeyword}" via OpenRouter ===\n`);

  const prompt = buildGenerationPrompt(ctx);
  const t0 = Date.now();
  const result = await invokeClaudeWithCost(
    {
      messages: [
        {
          role: "system",
          content:
            "You are an expert SEO content writer. Follow the output format instructions exactly. Output ONLY the two delimited sections: <METADATA>...</METADATA> and <ARTICLE_HTML>...</ARTICLE_HTML>. No preamble, no markdown fences.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 16000,
    },
    { feature: "article_generation" },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const raw = (result.choices?.[0]?.message?.content as string) ?? "";
  const htmlMatch = raw.match(/<ARTICLE_HTML>([\s\S]*?)<\/ARTICLE_HTML>/i);
  let bodyHtml = htmlMatch ? htmlMatch[1].trim() : raw;

  const wordsBefore = countHtmlWords(bodyHtml);
  console.log(`Generated in ${elapsed}s — ${wordsBefore} words (raw)\n`);

  // --- Apply the two deterministic fixes (as the engine does pre-scoring) ---
  const h2res = ensureKeywordInH2(bodyHtml, ctx.primaryKeyword);
  bodyHtml = h2res.bodyHtml;
  const trim = trimHtmlToWordCount(bodyHtml, max, ctx.primaryKeyword);
  bodyHtml = trim.bodyHtml;
  const wordsAfter = countHtmlWords(bodyHtml);

  // --- Score ---
  const pass1 = runPass1Scorer({
    bodyHtml,
    bodyMarkdown: bodyHtml.replace(/<[^>]+>/g, " "),
    title: (raw.match(/"title"\s*:\s*"([^"]+)"/)?.[1]) ?? `${ctx.primaryKeyword} guide`,
    metaTitle: (raw.match(/"metaTitle"\s*:\s*"([^"]+)"/)?.[1]) ?? "",
    metaDescription: (raw.match(/"metaDescription"\s*:\s*"([^"]+)"/)?.[1]) ?? "",
    urlSlug: ctx.urlSlug,
    wordCount: wordsAfter,
    level: ctx.level,
    primaryKeyword: ctx.primaryKeyword,
    externalLinkPresent: /<a\s[^>]*href=["']https?:/i.test(bodyHtml),
    internalCtaLinkPresent: bodyHtml.includes(ctx.ctaUrl),
    internalBlogLinksPresent: true,
    schemaPresent: true,
  });
  const pass2 = await runPass2Scorer(bodyHtml, ctx.primaryKeyword, null, false);

  const h2s = bodyHtml.match(/<h2[^>]*>[\s\S]*?<\/h2>/gi) ?? [];
  const kwInH2 = h2s.some(h => kwPresentInText(ctx.primaryKeyword, h));

  // --- Verdict ---
  console.log("=== VERDICT ON THE THREE RECURRING BUGS ===\n");
  line("1. Word count <= max", wordsAfter <= max, `${wordsAfter} / ${max} (was ${wordsBefore})`);
  line("2. Keyword in an H2", kwInH2, kwInH2 ? "present" : "MISSING");
  line("3. Pass 2 authenticity/quality", pass2.score >= 80, `${pass2.score}/100${pass2.reason ? ` — ${pass2.reason}` : ""}`);
  console.log("");
  line("Pass 1 SEO score", pass1.score >= 81, `${pass1.score}/100 (${Math.round((pass1.score / 100) * 16)}/16)`);
  const failedP1 = Object.entries(pass1.points).filter(([, v]) => !v).map(([k]) => k);
  if (failedP1.length) console.log(`   Pass 1 failures: ${failedP1.join(", ")}`);

  console.log(`\n=== OPENING (first 320 chars) ===\n${bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320)}...\n`);
}

main().catch(err => {
  console.error("Verification run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
