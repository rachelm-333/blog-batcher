/**
 * probeKeywordPool.ts — shows the REAL search terms DataForSEO returns for a seed
 * keyword (with volume + competition), plus People-Also-Ask questions. Reveals
 * whether the real searched terms around a topic exist (and what they are), so we
 * can build the hub from real demand instead of invented "[keyword] X" phrases.
 *
 * Run on Manus:  node --import tsx scripts/probeKeywordPool.ts "brand architecture"
 */
import { getKeywordSuggestions, getPAAQuestions } from "../server/dataforseo";

async function main() {
  const seed = process.argv[2] || "brand architecture";
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    console.error("✗ DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set — cannot query.");
    process.exit(1);
  }

  console.log(`\nReal related search terms for: "${seed}" (AU, English)\n`);
  const sugg = await getKeywordSuggestions(seed, 2036, "en", 120);
  const withVol = sugg.filter((s) => (s.monthlySearchVolume ?? 0) > 0)
    .sort((a, b) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
  console.log(`Total returned: ${sugg.length}   |   with real volume (>0): ${withVol.length}\n`);

  console.log("TOP REAL TERMS (volume · competition):");
  for (const s of withVol.slice(0, 40)) {
    console.log(`  ${String(s.monthlySearchVolume).padStart(6)}  ·  ${s.competitionLevel ?? "?"}   ${s.keyword}`);
  }
  const zero = sugg.length - withVol.length;
  if (zero > 0) console.log(`\n(${zero} returned terms had no/zero volume — these would be dropped.)`);

  console.log(`\nPeople-Also-Ask questions for "${seed}":`);
  try {
    const paa = await getPAAQuestions([seed]);
    if (!paa.length) console.log("  (none returned)");
    for (const p of paa.slice(0, 20)) console.log(`  • ${(p as { question?: string }).question ?? JSON.stringify(p)}`);
  } catch (e) { console.log("  PAA failed:", String(e).slice(0, 100)); }

  console.log(`\n⇒ If there are plenty of real terms above, the hub should be built from THESE (not "${seed} X" phrases). If the list is thin, the topic is genuinely low-volume and we should say so.`);
  process.exit(0);
}
main().catch((e) => { console.error("✗", e); process.exit(1); });
