/**
 * liveChecks.ts — the two live-URL audit checks the parser can't do offline:
 *   MAC-12 Core Web Vitals (Google PageSpeed Insights API)
 *   MAC-13 llms.txt presence (HTTP GET of <origin>/llms.txt)
 *
 * Results are fed into auditHtml(input.liveChecks) so those checks score for real
 * instead of "not applicable".
 */

/** MAC-13 — GET <origin>/llms.txt; true on HTTP 200. */
export async function checkLlmsTxt(pageUrl: string): Promise<boolean> {
  try {
    const origin = new URL(pageUrl).origin;
    const res = await fetch(`${origin}/llms.txt`, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    // Guard against SPA soft-404s that return 200 + an HTML page.
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html")) {
      const body = (await res.text()).slice(0, 300).toLowerCase();
      if (body.includes("<!doctype html") || body.includes("<html")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Core Web Vitals thresholds (Google "good"). */
const LCP_GOOD_MS = 2500;
const INP_GOOD_MS = 200;
const CLS_GOOD = 0.1;

/**
 * Interpret a PageSpeed Insights v5 response → pass/fail. Prefers real-user field
 * data (loadingExperience / CrUX); falls back to lab (Lighthouse) metrics. Pure + testable.
 * Returns null if neither data source is present (treated as "not applicable").
 */
export function interpretPageSpeed(json: any): boolean | null {
  // 1) Field data (CrUX) — most authoritative.
  const metrics = json?.loadingExperience?.metrics;
  if (metrics && Object.keys(metrics).length > 0) {
    const lcp = metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    const cls = metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;           // ×100
    const inp = (metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? metrics.FIRST_INPUT_DELAY_MS?.percentile);
    const checks: boolean[] = [];
    if (typeof lcp === "number") checks.push(lcp <= LCP_GOOD_MS);
    if (typeof cls === "number") checks.push(cls / 100 <= CLS_GOOD);
    if (typeof inp === "number") checks.push(inp <= INP_GOOD_MS);
    if (checks.length) return checks.every(Boolean);
  }
  // 2) Lab data (Lighthouse) fallback.
  const audits = json?.lighthouseResult?.audits;
  if (audits) {
    const lcp = audits["largest-contentful-paint"]?.numericValue;
    const cls = audits["cumulative-layout-shift"]?.numericValue;
    const checks: boolean[] = [];
    if (typeof lcp === "number") checks.push(lcp <= LCP_GOOD_MS);
    if (typeof cls === "number") checks.push(cls <= CLS_GOOD);
    if (checks.length) return checks.every(Boolean);
  }
  return null;
}

/** MAC-12 — run PageSpeed Insights for a URL and interpret CWV. */
export async function checkCoreWebVitals(pageUrl: string): Promise<boolean | null> {
  try {
    const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    api.searchParams.set("url", pageUrl);
    api.searchParams.set("category", "performance");
    api.searchParams.set("strategy", "mobile");
    if (process.env.PAGESPEED_API_KEY) api.searchParams.set("key", process.env.PAGESPEED_API_KEY);
    const res = await fetch(api.toString(), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return interpretPageSpeed(await res.json());
  } catch {
    return null;
  }
}

/** Run both live checks for a page. Shape matches auditHtml's `liveChecks` input. */
export async function runLiveChecks(pageUrl: string): Promise<{ coreWebVitalsPass?: boolean; llmsTxtPresent?: boolean }> {
  const [cwv, llms] = await Promise.all([checkCoreWebVitals(pageUrl), checkLlmsTxt(pageUrl)]);
  const out: { coreWebVitalsPass?: boolean; llmsTxtPresent?: boolean } = { llmsTxtPresent: llms };
  if (cwv !== null) out.coreWebVitalsPass = cwv; // leave undefined (N/A) when PSI has no data
  return out;
}
