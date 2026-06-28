/**
 * auditEngine.ts — the 29-point SEO & GEO parsing + scoring engine.
 *
 * Implements every rule in auditRules.ts against raw HTML using cheerio (DOM
 * parsing). Returns { total_score (/100), failed_checks[], checks[] } exactly
 * as specified in the Gemini directive, plus per-check detail for the UI.
 *
 * Pure + synchronous. Live-URL checks (Core Web Vitals, llms.txt) are NOT done
 * here — they require network/API calls; pass their results in via
 * `input.liveChecks`, otherwise they are reported as "not applicable".
 */
import * as cheerio from "cheerio";
import { AUDIT_RULES, AUDIT_MAX_POINTS, type AuditRule } from "./auditRules";

export interface AuditInput {
  html: string;
  primaryKeyword: string;
  /** Exact-match anchor target for MAC-09 (the pillar/hub keyword). */
  hubKeyword?: string;
  /** Page URL — needed for MAC-01 (silo) and the live checks. */
  url?: string;
  /** Meta fields, if known separately from the HTML <head>. */
  metaTitle?: string;
  metaDescription?: string;
  /** Is this page a hub/pillar? Affects MAC-10. */
  isHub?: boolean;
  /** Results of network checks done elsewhere (Phase 3 auditor). */
  liveChecks?: { coreWebVitalsPass?: boolean; llmsTxtPresent?: boolean };
}

export interface AuditCheckResult {
  id: string;
  parameter: string;
  phase: string;
  max_points: number;
  /** true=pass, false=fail, null=not applicable (excluded from the denominator). */
  passed: boolean | null;
  points: number; // points earned (max_points if passed, else 0)
  detail: string;
}

export interface AuditResult {
  total_score: number;       // points earned, out of 100
  applicable_max: number;    // max achievable given applicable checks (==100 with live checks)
  normalized_score: number;  // total_score / applicable_max * 100, rounded
  failed_checks: Array<{ id: string; parameter: string }>;
  checks: AuditCheckResult[];
}

const BLOCKLIST = ["delve", "tapestry", "bustling", "testament", "moreover"];

function textOf($: cheerio.CheerioAPI): string {
  return $("body").length ? $("body").text() : $.root().text();
}

function sentenceCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 0).length;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Parse all JSON-LD blocks; return the flattened set of @type strings present. */
function schemaTypes($: cheerio.CheerioAPI): Set<string> {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const data = JSON.parse(raw);
      const collect = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (typeof node === "object") {
          const obj = node as Record<string, unknown>;
          const t = obj["@type"];
          if (typeof t === "string") types.add(t);
          if (Array.isArray(t)) t.forEach(x => typeof x === "string" && types.add(x));
          if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(collect);
        }
      };
      collect(data);
    } catch { /* ignore malformed JSON-LD */ }
  });
  return types;
}

/** Run a single rule. Returns boolean (pass/fail) or null (not applicable). */
function evaluate(rule: AuditRule, $: cheerio.CheerioAPI, input: AuditInput): { passed: boolean | null; detail: string } {
  const kw = (input.primaryKeyword || "").toLowerCase();
  const bodyText = textOf($);
  const types = schemaTypes($);
  const metaTitle = (input.metaTitle ?? $("title").first().text() ?? "").trim();
  const metaDesc = (input.metaDescription ?? $('meta[name="description"]').attr("content") ?? "").trim();

  switch (rule.id) {
    case "MAC-01": {
      if (!input.url) return { passed: null, detail: "No URL provided" };
      let path = input.url;
      try { path = new URL(input.url).pathname; } catch { /* treat as path */ }
      const segments = path.split("/").filter(Boolean);
      const hasDate = /\/(19|20)\d{2}(\/|$)/.test(path) || /\/\d{4}\/\d{2}\//.test(path);
      return { passed: segments.length >= 2 && !hasDate, detail: `path "${path}" — ${segments.length} segments, date=${hasDate}` };
    }
    case "MAC-02":
      return { passed: metaTitle.length > 0 && metaTitle.length <= 60, detail: `${metaTitle.length} chars` };
    case "MAC-03":
      return { passed: metaDesc.length > 0 && metaDesc.length <= 160, detail: `${metaDesc.length} chars` };
    case "MAC-04": {
      const inTitle = kw !== "" && metaTitle.toLowerCase().includes(kw);
      const inDesc = kw !== "" && metaDesc.toLowerCase().includes(kw);
      return { passed: inTitle && inDesc, detail: `title=${inTitle}, desc=${inDesc}` };
    }
    case "MAC-05":
      return { passed: types.has("Article") || types.has("BlogPosting"), detail: Array.from(types).join(",") || "no schema" };
    case "MAC-06":
      return { passed: types.has("FAQPage"), detail: types.has("FAQPage") ? "FAQPage present" : "missing" };
    case "MAC-07":
      return { passed: types.has("Organization"), detail: types.has("Organization") ? "present" : "missing" };
    case "MAC-08":
      return { passed: types.has("Person"), detail: types.has("Person") ? "Author Person present" : "missing" };
    case "MAC-09": {
      const hub = (input.hubKeyword || "").toLowerCase().trim();
      if (!hub) return { passed: null, detail: "No hub keyword provided" };
      let found = false;
      $("a[href]").each((_, el) => {
        if ($(el).text().toLowerCase().trim() === hub) found = true;
      });
      return { passed: found, detail: found ? `exact-match anchor "${hub}"` : "no exact-match hub anchor" };
    }
    case "MAC-10": {
      if (!input.isHub) return { passed: null, detail: "Not a hub page" };
      let down = 0;
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if ((href.startsWith("/") || href.startsWith(".")) && href.split("/").filter(Boolean).length >= 2) down++;
      });
      return { passed: down >= 1, detail: `${down} downward internal links` };
    }
    case "MAC-11": {
      let internal = 0;
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith("/")) internal++;
      });
      return { passed: internal >= 1, detail: `${internal} internal links` };
    }
    case "MAC-12":
      if (input.liveChecks?.coreWebVitalsPass === undefined) return { passed: null, detail: "Requires live URL / PageSpeed API" };
      return { passed: input.liveChecks.coreWebVitalsPass, detail: `CWV pass=${input.liveChecks.coreWebVitalsPass}` };
    case "MAC-13":
      if (input.liveChecks?.llmsTxtPresent === undefined) return { passed: null, detail: "Requires live URL check" };
      return { passed: input.liveChecks.llmsTxtPresent, detail: `llms.txt=${input.liveChecks.llmsTxtPresent}` };
    case "MIC-01": {
      const n = $("h1").length;
      return { passed: n === 1, detail: `${n} h1 tags` };
    }
    case "MIC-02": {
      const h1 = $("h1").first().text().toLowerCase();
      return { passed: kw !== "" && h1.includes(kw), detail: kw && h1.includes(kw) ? "keyword in H1" : "missing" };
    }
    case "MIC-03": {
      const h2s = $("h2").toArray().map(el => $(el).text().trim()).filter(Boolean);
      if (h2s.length === 0) return { passed: false, detail: "no H2 tags" };
      const isQ = (t: string) => /\?\s*$/.test(t) || /^(who|what|where|why|when|how|do|does|can|is|are|should)\b/i.test(t);
      const q = h2s.filter(isQ).length;
      return { passed: q / h2s.length >= 0.5, detail: `${q}/${h2s.length} H2s are questions` };
    }
    case "MIC-04": {
      const h3 = $("h3").length;
      return { passed: h3 >= 1, detail: `${h3} H3 tags` };
    }
    case "MIC-05": {
      const h2s = $("h2").toArray();
      if (h2s.length === 0) return { passed: false, detail: "no H2 tags" };
      let allOk = true; let worst = 0;
      for (const el of h2s) {
        const firstP = $(el).nextAll("p").first();
        if (firstP.length === 0) continue;
        const wc = wordCount(firstP.text());
        worst = Math.max(worst, wc);
        if (wc > 60) allOk = false;
      }
      return { passed: allOk, detail: `longest answer paragraph ${worst} words` };
    }
    case "MIC-06": {
      const n = $("ul, ol").length;
      return { passed: n >= 1, detail: `${n} list elements` };
    }
    case "MIC-07": {
      const n = $("table").length;
      return { passed: n >= 1, detail: `${n} tables` };
    }
    case "MIC-08": {
      let over = 0;
      $("p").each((_, el) => {
        const t = $(el).text();
        if (sentenceCount(t) > 4 || wordCount(t) > 100) over++;
      });
      return { passed: over === 0, detail: `${over} overlong paragraphs` };
    }
    case "EAT-01": {
      const hasStat = /\b\d+(\.\d+)?\s?%/.test(bodyText) || /\b\d{2,}\b/.test(bodyText) || /\bcase study\b/i.test(bodyText);
      return { passed: hasStat, detail: hasStat ? "stats/numbers present" : "no concrete data" };
    }
    case "EAT-02": {
      const re = /\b(in our experience|we tested|we found|we've found|when we|our team (found|tested)|after testing)\b/i;
      return { passed: re.test(bodyText), detail: re.test(bodyText) ? "first-hand phrasing" : "none" };
    }
    case "EAT-03": {
      const re = /\b(mistake|doesn't work|don't work|avoid|common error|pitfall|failed|the wrong way|many people get this wrong|backwards)\b/i;
      return { passed: re.test(bodyText), detail: re.test(bodyText) ? "acknowledges failed approaches" : "none" };
    }
    case "EAT-04": {
      let ok = false;
      $("blockquote").each((_, el) => {
        const t = $(el).text();
        // attributed to a name: contains a "— Name" / "- Name" or cite
        if (/[—-]\s*[A-Z][a-z]+\s+[A-Z][a-z]+/.test(t) || $(el).find("cite").length > 0) ok = true;
      });
      return { passed: ok, detail: ok ? "attributed blockquote" : "no attributed quote" };
    }
    case "EAT-05": {
      let ok = false;
      $("a[href^='http']").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (/\.gov(\.[a-z]{2})?\b|\.edu\b|wikipedia\.org|\.gov\.au/i.test(href)) ok = true;
      });
      return { passed: ok, detail: ok ? "authority outbound link" : "none" };
    }
    case "EAT-06": {
      const hosts = new Set<string>();
      $("a[href^='http']").each((_, el) => {
        try { hosts.add(new URL($(el).attr("href") || "").hostname.replace(/^www\./, "")); } catch { /* skip */ }
      });
      return { passed: hosts.size >= 2, detail: `${hosts.size} unique external domains` };
    }
    case "EAT-07": {
      const sentences = bodyText.split(/[.!?]+\s/).filter(s => s.trim().length > 0);
      if (sentences.length === 0) return { passed: false, detail: "no text" };
      const passive = sentences.filter(s => /\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b/i.test(s)).length;
      const activeRatio = 1 - passive / sentences.length;
      return { passed: activeRatio >= 0.7, detail: `~${Math.round(activeRatio * 100)}% active` };
    }
    case "EAT-08": {
      const found = BLOCKLIST.filter(w => new RegExp(`\\b${w}\\b`, "i").test(bodyText));
      return { passed: found.length === 0, detail: found.length ? `found: ${found.join(", ")}` : "clean" };
    }
    default:
      return { passed: null, detail: "not implemented" };
  }
}

export function auditHtml(input: AuditInput): AuditResult {
  const $ = cheerio.load(input.html);
  const checks: AuditCheckResult[] = [];
  let total = 0;
  let applicableMax = 0;

  for (const rule of AUDIT_RULES) {
    const { passed, detail } = evaluate(rule, $, input);
    const points = passed === true ? rule.max_points : 0;
    if (passed !== null) applicableMax += rule.max_points;
    total += points;
    checks.push({ id: rule.id, parameter: rule.parameter, phase: rule.phase, max_points: rule.max_points, passed, points, detail });
  }

  const failed_checks = checks.filter(c => c.passed === false).map(c => ({ id: c.id, parameter: c.parameter }));
  const normalized = applicableMax > 0 ? Math.round((total / applicableMax) * 100) : 0;

  return {
    total_score: total,
    applicable_max: applicableMax,
    normalized_score: normalized,
    failed_checks,
    checks,
  };
}

export { AUDIT_MAX_POINTS };
