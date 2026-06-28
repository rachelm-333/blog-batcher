/**
 * auditRules.ts — the 29-point weighted SEO & GEO audit rules.
 *
 * SOURCE OF TRUTH: copied verbatim from the Gemini "29-Point Weighted JSON
 * Schema" directive (IDs, parameters, pass conditions, and max_points are
 * exactly as provided). Weights sum to 100.
 *
 * Each rule is implemented + tested in auditEngine.ts / auditEngine.test.ts.
 * Do NOT change a max_points value here without updating the spec — this file
 * is the contract.
 */

export type AuditPhase = "Macro Architecture" | "Micro Architecture" | "E-E-A-T & Voice";

export interface AuditRule {
  id: string;
  phase: AuditPhase;
  parameter: string;
  pass_condition: string;
  max_points: number;
  /** True for checks that can only be evaluated against a live URL (CWV, llms.txt). */
  requiresLiveUrl?: boolean;
}

export const AUDIT_RULES: AuditRule[] = [
  { id: "MAC-01", phase: "Macro Architecture", parameter: "URL Silo Structure", pass_condition: "URL path contains subdirectories (regex check for multiple slashes). Fails if dates/years are detected.", max_points: 3 },
  { id: "MAC-02", phase: "Macro Architecture", parameter: "Meta Title Length", pass_condition: "<title> tag is <= 60 characters.", max_points: 2 },
  { id: "MAC-03", phase: "Macro Architecture", parameter: "Meta Description Length", pass_condition: "<meta name='description'> is <= 160 characters.", max_points: 1 },
  { id: "MAC-04", phase: "Macro Architecture", parameter: "Keyword in Title/Desc", pass_condition: "Primary target keyword string exists in both Title and Description.", max_points: 4 },
  { id: "MAC-05", phase: "Macro Architecture", parameter: "Article Schema", pass_condition: "JSON-LD script contains @type: 'Article' or 'BlogPosting'.", max_points: 3 },
  { id: "MAC-06", phase: "Macro Architecture", parameter: "FAQPage Schema", pass_condition: "JSON-LD script contains @type: 'FAQPage'.", max_points: 4 },
  { id: "MAC-07", phase: "Macro Architecture", parameter: "Organization Schema", pass_condition: "JSON-LD script contains @type: 'Organization'.", max_points: 2 },
  { id: "MAC-08", phase: "Macro Architecture", parameter: "Author Schema", pass_condition: "JSON-LD script contains @type: 'Person' linked to an author.", max_points: 3 },
  { id: "MAC-09", phase: "Macro Architecture", parameter: "Internal Link (UP)", pass_condition: "Detects >=1 internal <a> tag where anchor text exactly matches a predefined Hub keyword.", max_points: 5 },
  { id: "MAC-10", phase: "Macro Architecture", parameter: "Internal Link (DOWN)", pass_condition: "If page is a Hub, detects internal <a> tags pointing to deeper cluster URLs.", max_points: 2 },
  { id: "MAC-11", phase: "Macro Architecture", parameter: "Internal Link (LATERAL)", pass_condition: "Detects >=1 internal <a> tag pointing to a sibling cluster URL.", max_points: 2 },
  { id: "MAC-12", phase: "Macro Architecture", parameter: "Core Web Vitals", pass_condition: "API check confirms LCP, FID/INP, and CLS are within Google's passing thresholds.", max_points: 4, requiresLiveUrl: true },
  { id: "MAC-13", phase: "Macro Architecture", parameter: "llms.txt Presence", pass_condition: "HTTP GET request to domain.com/llms.txt returns 200 OK.", max_points: 5, requiresLiveUrl: true },
  { id: "MIC-01", phase: "Micro Architecture", parameter: "H1 Singularity", pass_condition: "Document contains exactly one <h1> tag.", max_points: 3 },
  { id: "MIC-02", phase: "Micro Architecture", parameter: "H1 Keyword Presence", pass_condition: "The single <h1> contains the primary target keyword.", max_points: 5 },
  { id: "MIC-03", phase: "Micro Architecture", parameter: "H2 Question Framing", pass_condition: "At least 50% of <h2> tags end in '?' or begin with Who/What/Where/Why/How/Do/Can.", max_points: 5 },
  { id: "MIC-04", phase: "Micro Architecture", parameter: "H3 Action Framing", pass_condition: "<h3> tags exist beneath <h2> tags to break down sub-steps.", max_points: 3 },
  { id: "MIC-05", phase: "Micro Architecture", parameter: "Answer Proximity", pass_condition: "The first <p> element directly succeeding an <h2> tag contains <= 60 words.", max_points: 5 },
  { id: "MIC-06", phase: "Micro Architecture", parameter: "Structural Formatting (Lists)", pass_condition: "Document contains at least one <ul> or <ol> element.", max_points: 5 },
  { id: "MIC-07", phase: "Micro Architecture", parameter: "Structural Formatting (Data)", pass_condition: "Document contains at least one <table> element for data comparison.", max_points: 4 },
  { id: "MIC-08", phase: "Micro Architecture", parameter: "Paragraph Density", pass_condition: "Zero <p> tags in the document exceed 4 sentences (approx 100 words).", max_points: 5 },
  { id: "EAT-01", phase: "E-E-A-T & Voice", parameter: "Non-Commodity Data", pass_condition: "NLP detects unique numerical statistics, percentages, or named case studies.", max_points: 5 },
  { id: "EAT-02", phase: "E-E-A-T & Voice", parameter: "First-Hand Experience", pass_condition: "Regex detects phrases like 'in our experience', 'we tested', 'we found'.", max_points: 4 },
  { id: "EAT-03", phase: "E-E-A-T & Voice", parameter: "Failed Strategy Check", pass_condition: "NLP detects phrasing acknowledging failed alternatives or common mistakes.", max_points: 2 },
  { id: "EAT-04", phase: "E-E-A-T & Voice", parameter: "Expert Citation", pass_condition: "Contains a <blockquote> element attributed to a specific human name.", max_points: 4 },
  { id: "EAT-05", phase: "E-E-A-T & Voice", parameter: "Outbound Authority 1", pass_condition: "Contains an external href pointing to a .gov, .edu, or known data entity.", max_points: 3 },
  { id: "EAT-06", phase: "E-E-A-T & Voice", parameter: "Outbound Authority 2", pass_condition: "Contains a second unique external high-authority href.", max_points: 2 },
  { id: "EAT-07", phase: "E-E-A-T & Voice", parameter: "Active Voice Verification", pass_condition: "NLP scan confirms the majority of text is in active voice.", max_points: 2 },
  { id: "EAT-08", phase: "E-E-A-T & Voice", parameter: "AI Buzzword Blocklist", pass_condition: "Zero instances of blocklisted words: delve, tapestry, bustling, testament, moreover.", max_points: 3 },
];

/** Total available points across all 29 rules — must equal 100. */
export const AUDIT_MAX_POINTS = AUDIT_RULES.reduce((sum, r) => sum + r.max_points, 0);
