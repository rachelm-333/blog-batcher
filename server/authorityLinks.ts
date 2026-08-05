/**
 * authorityLinks.ts — curated library of REAL, high-authority external domains,
 * keyed by industry (AU + global). Used to (a) suggest genuine authority sources to
 * the writer, and (b) supply the guaranteed .gov/.edu link for EAT-05.
 *
 * Only well-known, stable ROOT domains are listed. Every link is still live-checked
 * at publish (validateAndStripLinks), so this is a quality boost, not a trust anchor.
 * Keep entries to real homepages — never deep paths.
 */

export interface AuthoritySet {
  /** .gov/.gov.au/.edu/.edu.au (or clearly official regulator) — satisfies EAT-05. */
  govEdu: string[];
  /** Recognised industry bodies, associations, and major publications/brands. */
  general: string[];
}

// Global authorities relevant to almost any topic — merged into every industry.
const GLOBAL_GENERAL = [
  "https://www.wikipedia.org",
  "https://hbr.org",
  "https://www.forbes.com",
  "https://www.statista.com",
  "https://www.mckinsey.com",
];

// AU government/official fallbacks relevant to almost any business (EAT-05 safety net).
const GLOBAL_GOV_EDU = [
  "https://business.gov.au",
  "https://www.accc.gov.au",
  "https://www.ato.gov.au",
];

// Industry key → matching substrings (checked against the business industry text).
const INDUSTRY_MATCHERS: Array<{ key: string; match: string[] }> = [
  { key: "marketing", match: ["market", "advertis", "seo", "brand", "media", "pr ", "communicat", "content", "digital agenc"] },
  { key: "construction", match: ["construct", "build", "trade", "plumb", "electric", "carpent", "renovat", "landscap", "roof"] },
  { key: "health", match: ["health", "medical", "wellness", "clinic", "dental", "physio", "chiro", "nursing", "aged care", "disabilit", "ndis"] },
  { key: "legal", match: ["legal", "law", "solicitor", "lawyer", "conveyanc", "barrister"] },
  { key: "finance", match: ["financ", "account", "bookkeep", "tax", "mortgage", "insur", "invest", "superann"] },
  { key: "realestate", match: ["real estate", "property", "realty", "buyer agent", "strata"] },
  { key: "hospitality", match: ["hospitality", "restaurant", "cafe", "catering", "food", "bar ", "brewery", "hotel", "accommodation"] },
  { key: "education", match: ["educat", "training", "tutor", "school", "coach", "course", "rto"] },
  { key: "retail", match: ["retail", "ecommerce", "e-commerce", "shop", "store", "boutique", "product"] },
  { key: "technology", match: ["tech", "software", "saas", "it ", "cyber", "app ", "web develop", "data"] },
  { key: "fitness", match: ["fitness", "gym", "personal train", "pilates", "yoga", "sport"] },
  { key: "beauty", match: ["beauty", "salon", "hair", "cosmetic", "skin", "spa ", "aesthet", "nails"] },
  { key: "automotive", match: ["auto", "car ", "mechanic", "vehicle", "panel", "tyre"] },
  { key: "professional", match: ["consult", "hr ", "human resource", "recruit", "coach", "profession", "bookkeep", "virtual assistant"] },
];

const INDUSTRY_AUTHORITIES: Record<string, AuthoritySet> = {
  marketing: {
    govEdu: ["https://business.gov.au", "https://www.accc.gov.au"],
    general: ["https://www.hubspot.com", "https://moz.com", "https://www.semrush.com", "https://www.thinkwithgoogle.com", "https://aana.com.au"],
  },
  construction: {
    govEdu: ["https://www.safeworkaustralia.gov.au", "https://www.abcb.gov.au", "https://business.gov.au"],
    general: ["https://www.masterbuilders.com.au", "https://hia.com.au"],
  },
  health: {
    govEdu: ["https://www.health.gov.au", "https://www.healthdirect.gov.au", "https://www.tga.gov.au", "https://www.ahpra.gov.au"],
    general: ["https://www.who.int", "https://www.mayoclinic.org", "https://www.healthline.com"],
  },
  legal: {
    govEdu: ["https://www.ag.gov.au", "https://www.austlii.edu.au", "https://www.lawcouncil.asn.au"],
    general: ["https://www.lawsociety.com.au"],
  },
  finance: {
    govEdu: ["https://www.ato.gov.au", "https://asic.gov.au", "https://moneysmart.gov.au"],
    general: ["https://www.cpaaustralia.com.au", "https://www.investopedia.com"],
  },
  realestate: {
    govEdu: ["https://business.gov.au", "https://www.accc.gov.au"],
    general: ["https://reia.com.au", "https://www.corelogic.com.au", "https://www.realestate.com.au"],
  },
  hospitality: {
    govEdu: ["https://www.foodstandards.gov.au", "https://business.gov.au"],
    general: ["https://www.restaurantcatering.com.au"],
  },
  education: {
    govEdu: ["https://www.education.gov.au", "https://www.asqa.gov.au", "https://www.teqsa.gov.au"],
    general: ["https://www.edx.org"],
  },
  retail: {
    govEdu: ["https://www.accc.gov.au", "https://business.gov.au"],
    general: ["https://www.shopify.com", "https://www.nra.net.au"],
  },
  technology: {
    govEdu: ["https://www.cyber.gov.au", "https://business.gov.au"],
    general: ["https://www.gartner.com", "https://techcrunch.com", "https://www.acs.org.au"],
  },
  fitness: {
    govEdu: ["https://www.sportaus.gov.au", "https://www.health.gov.au"],
    general: ["https://ausactive.org.au"],
  },
  beauty: {
    govEdu: ["https://www.accc.gov.au", "https://business.gov.au"],
    general: ["https://www.vogue.com.au"],
  },
  automotive: {
    govEdu: ["https://business.gov.au", "https://www.infrastructure.gov.au"],
    general: ["https://www.mtaa.com.au"],
  },
  professional: {
    govEdu: ["https://www.fairwork.gov.au", "https://business.gov.au"],
    general: ["https://hbr.org", "https://www.shrm.org"],
  },
};

const DEFAULT_AUTHORITIES: AuthoritySet = {
  govEdu: GLOBAL_GOV_EDU,
  general: ["https://www.forbes.com", "https://hbr.org"],
};

const uniq = (a: string[]) => Array.from(new Set(a));

/** Resolve the best authority set for a business industry (falls back to defaults). */
export function getAuthorityLinks(industry?: string | null): AuthoritySet {
  const text = (industry ?? "").toLowerCase();
  const hit = text ? INDUSTRY_MATCHERS.find((m) => m.match.some((s) => text.includes(s.trim()))) : undefined;
  const base = hit ? INDUSTRY_AUTHORITIES[hit.key] : undefined;
  return {
    govEdu: uniq([...(base?.govEdu ?? []), ...GLOBAL_GOV_EDU]),
    general: uniq([...(base?.general ?? []), ...GLOBAL_GENERAL, ...DEFAULT_AUTHORITIES.general]),
  };
}

/** A prompt block listing suggested REAL authority sources for the writer. */
export function authorityPromptBlock(industry?: string | null): string {
  const { govEdu, general } = getAuthorityLinks(industry);
  return [
    "SUGGESTED AUTHORITY SOURCES (real, live root domains — prefer linking to these; you may use others you are certain are real):",
    `- Government/official (use at least one for the mandatory .gov/.edu link): ${govEdu.join(", ")}`,
    `- Industry bodies & major publications: ${general.slice(0, 6).join(", ")}`,
  ].join("\n");
}
