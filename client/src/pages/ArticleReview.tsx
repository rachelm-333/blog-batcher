/**
 * Stage 5 — Review & Publish Page
 *
 * Layout (matches mockup exactly):
 *  Left sidebar (280px): article list with Cornerstone/Pillar/Cluster labels and status badges
 *  Right panel: two-column review layout
 *    - Left: article body (rendered HTML, Position Zero Answer Block highlighted)
 *    - Right: SEO panel (score badge, warning, URL slug, meta title, meta description,
 *              focus keyword, image upload, Save Draft / Approve & Publish buttons)
 *
 * Status badges:
 *  authority_ready → ✅ Authority Ready (emerald)
 *  strong          → ⚡ Strong (blue)
 *  needs_review    → ⚠ Needs Review (amber)
 *  null            → ⏳ Pending Review (grey)
 *  approved        → ✓ Approved (green)
 */

import { useActiveBusiness } from "@/contexts/BusinessContext";
import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Copy,
  Code2,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Shield,
  Star,
  Trophy,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { HelpLink } from "@/components/HelpLink";

// ---------------------------------------------------------------------------
// Client-side Pass 1 SEO checker (mirrors server/articleEngine.ts runPass1Scorer)
// ---------------------------------------------------------------------------

const WORD_COUNT_RULES = {
  cornerstone: { min: 2000, max: 3200 },
  pillar: { min: 1500, max: 2200 },
  cluster: { min: 800, max: 1300 },
} as const;
const WORD_COUNT_TOLERANCE = 100; // within 100 words of min/max = pass

const BANNED_PHRASES = [
  "in today's world",
  "it's important to note",
  "it is important to note",
  "delve into",
  "game-changer",
  "game changer",
  "leverage",
  "synergy",
  "transformative",
] as const;

interface Pass1Checks {
  p1_keyword_density: boolean;
  p2_keyword_in_h1: boolean;
  p3_keyword_in_h2: boolean;
  p4_keyword_in_h3: boolean;
  p5_keyword_first_100: boolean;
  p6_keyword_in_slug: boolean;
  p7_meta_title: boolean;
  p8_meta_description: boolean;
  p9_opening_answer: boolean;
  p10_external_link: boolean;
  p11_internal_cta: boolean;
  p12_internal_blog_links: boolean;
  p13_schema: boolean;
  p14_eeat: boolean;
  p15_human_authenticity: boolean;
  p16_word_count: boolean;
}

function computePass1Checks(params: {
  bodyHtml: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  urlSlug: string;
  wordCount: number;
  level: "cornerstone" | "pillar" | "cluster";
  focusKeyword: string;
  schemaMarkup: string | null | undefined;
}): Pass1Checks {
  const { bodyHtml, title, metaTitle, metaDescription, urlSlug, wordCount, level, focusKeyword, schemaMarkup } = params;

  const kw = focusKeyword.toLowerCase().trim();
  if (!kw) {
    // Can't score without keyword — return all false except structural checks
    const bodyLower = bodyHtml.toLowerCase();
    return {
      p1_keyword_density: false,
      p2_keyword_in_h1: false,
      p3_keyword_in_h2: false,
      p4_keyword_in_h3: false,
      p5_keyword_first_100: false,
      p6_keyword_in_slug: false,
      p7_meta_title: false,
      p8_meta_description: false,
      p9_opening_answer: !!bodyHtml && /[?]/.test(bodyHtml.slice(0, 800)),
      p10_external_link: /href=["'](https?:\/\/[^"']+)["']/i.test(bodyHtml),
      p11_internal_cta: /href=["']\/[^"']+["']/i.test(bodyHtml) || /href=["']#/i.test(bodyHtml),
      p12_internal_blog_links: (bodyHtml.match(/href=["']\/[^"']+["']/gi) || []).length >= 2,
      p13_schema: !!(schemaMarkup && schemaMarkup.trim().length > 10),
      p14_eeat: bodyLower.includes("year") || bodyLower.includes("experience") || bodyLower.includes("client") || bodyLower.includes("award"),
      p15_human_authenticity: !BANNED_PHRASES.some(phrase => bodyLower.includes(phrase.toLowerCase())),
      p16_word_count: wordCount >= WORD_COUNT_RULES[level].min - WORD_COUNT_TOLERANCE && wordCount <= WORD_COUNT_RULES[level].max + WORD_COUNT_TOLERANCE,
    };
  }

  const bodyText = bodyHtml.replace(/<[^>]+>/g, " ").toLowerCase();
  const bodyLower = bodyHtml.toLowerCase();
  const titleLower = title.toLowerCase();

  // ---------------------------------------------------------------------------
  // Keyword matching helpers (mirrors server-side kwPresentInText logic)
  // Handles word order differences, inflection, and minor insertions.
  // e.g. keyword "starting up a business with no money in Australia" correctly
  // matches "start a business in Australia with no money" in the article.
  // ---------------------------------------------------------------------------
  const KW_STOP = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "by","from","up","about","into","through","during","is","are","was",
    "were","be","been","being","have","has","had","do","does","did","will",
    "would","could","should","may","might","no","not","can","how","what",
    "when","where","who","which","your","my","our","their","its","this",
    "that","these","those",
  ]);
  function kwStem(w: string) {
    return w.replace(/ing$/,"").replace(/tion$/,"").replace(/es$/,"").replace(/s$/,"").replace(/ed$/,"");
  }
  function kwTokens(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/)
      .filter(w => w.length > 2 && !KW_STOP.has(w)).map(kwStem);
  }
  const primaryKwTokens = kwTokens(kw);
  function kwPresent(text: string): boolean {
    const t = text.toLowerCase().replace(/<[^>]+>/g, " ");
    if (t.includes(kw)) return true; // fast path: exact match
    const textToks = kwTokens(t);
    return primaryKwTokens.every(kt => textToks.some(tt => tt === kt || tt.startsWith(kt) || kt.startsWith(tt)));
  }

  // Keyword occurrence count
  const kwEscaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactMatches = (bodyText.match(new RegExp(kwEscaped, "g")) || []).length;
  const kwMatches = exactMatches > 0 ? exactMatches : bodyText.split(/[.!?\n]+/).filter(s => kwPresent(s)).length;
  const kwDensity = wordCount > 0 ? kwMatches / wordCount : 0;

  // H1 (title)
  const h1Present = kwPresent(titleLower);

  // H2
  const h2Matches = bodyHtml.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  const kwInH2 = h2Matches.some(h => kwPresent(h));

  // H3 — auto-pass if there are no H3 headings in the article (H3s are optional)
  const h3Matches = bodyHtml.match(/<h3[^>]*>(.*?)<\/h3>/gi) || [];
  const kwInH3 = h3Matches.length === 0 || h3Matches.some(h => kwPresent(h));

  // First 150 words
  const first150 = bodyText.split(/\s+/).slice(0, 150).join(" ");
  const kwInFirst100 = kwPresent(first150);

  // Slug
  const slugLower = urlSlug.toLowerCase();
  const kwInSlug = (() => {
    if (slugLower.includes(kw.replace(/\s+/g, "-"))) return true;
    // All keyword tokens present in slug
    return primaryKwTokens.every(kt => slugLower.includes(kt));
  })();

  // Meta title
  const metaTitleOk = kwPresent(metaTitle) && metaTitle.length <= 60;

  // Meta description
  const metaDescOk = (() => {
    const inRange = metaDescription.length >= 140 && metaDescription.length <= 160;
    if (!inRange) return false;
    return kwPresent(metaDescription);
  })();

  // Opening answer
  const first600Html = bodyHtml.slice(0, 800);
  const first600Lower = first600Html.toLowerCase();
  const openingAnswer = (() => {
    if (/<(strong|b)[^>]*>[^<]*\?[^<]*<\/(strong|b)>/i.test(first600Html)) return true;
    if (/<p[^>]*>[^<]{5,200}\?/i.test(first600Html)) return true;
    if (/<h[23][^>]*>[^<]*\?[^<]*<\/h[23]>/i.test(first600Html)) return true;
    const first300Text = bodyText.slice(0, 300);
    if (/\b(how|what|why|when|where|who|which|is|are|does|do|can|should)\b[^.!?]{5,200}\?/.test(first300Text)) return true;
    if (first600Lower.includes("?")) return true;
    return false;
  })();

  // External link
  const externalLink = (() => {
    const externalHrefPattern = /href=["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = externalHrefPattern.exec(bodyHtml)) !== null) {
      const href = match[1].toLowerCase();
      if (!href.includes("localhost") && !href.startsWith("/")) return true;
    }
    return false;
  })();

  // Internal CTA (any internal link)
  const internalCta = /href=["']\/[^"']+["']/i.test(bodyHtml) || /href=["']#/i.test(bodyHtml);

  // Internal blog links (2+ internal links)
  const internalBlogLinks = (bodyHtml.match(/href=["']\/[^"']+["']/gi) || []).length >= 2;

  // Schema
  const schemaPresent = !!(schemaMarkup && schemaMarkup.trim().length > 10);

  // E-E-A-T
  const eeat = bodyLower.includes("year") || bodyLower.includes("experience") || bodyLower.includes("client") || bodyLower.includes("award");

  // Human authenticity
  const humanAuth = !BANNED_PHRASES.some(phrase => bodyLower.includes(phrase.toLowerCase()));

  // Word count
  const wc = WORD_COUNT_RULES[level];
  const wordCountOk = wordCount >= wc.min - WORD_COUNT_TOLERANCE && wordCount <= wc.max + WORD_COUNT_TOLERANCE;

  return {
    // Pass if: (4+ mentions OR density ≥ 1%) AND density ≤ 2.5%
    p1_keyword_density: (kwMatches >= 4 || kwDensity >= 0.01) && kwDensity <= 0.025,
    p2_keyword_in_h1: h1Present,
    p3_keyword_in_h2: kwInH2,
    p4_keyword_in_h3: kwInH3,
    p5_keyword_first_100: kwInFirst100,
    p6_keyword_in_slug: kwInSlug,
    p7_meta_title: metaTitleOk,
    p8_meta_description: metaDescOk,
    p9_opening_answer: openingAnswer,
    p10_external_link: externalLink,
    p11_internal_cta: internalCta,
    p12_internal_blog_links: internalBlogLinks,
    p13_schema: schemaPresent,
    p14_eeat: eeat,
    p15_human_authenticity: humanAuth,
    p16_word_count: wordCountOk,
  };
}

// ---------------------------------------------------------------------------
// pass1Details helpers — handles both legacy (boolean map) and new ({points, metrics}) format
// ---------------------------------------------------------------------------

type Pass1DetailsRaw = { points: Record<string, boolean>; metrics: Record<string, string> } | Record<string, boolean> | null | unknown;

function extractPass1Points(raw: Pass1DetailsRaw): Record<string, boolean> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // New format: { points: {...}, metrics: {...} }
  if (r.points && typeof r.points === "object" && !Array.isArray(r.points)) {
    return r.points as Record<string, boolean>;
  }
  // Legacy format: flat boolean map
  if (typeof r.p1_keyword_density === "boolean" || typeof r.p2_keyword_in_h1 === "boolean") {
    return r as Record<string, boolean>;
  }
  return null;
}

function extractPass1Metrics(raw: Pass1DetailsRaw): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.metrics && typeof r.metrics === "object" && !Array.isArray(r.metrics)) {
    return r.metrics as Record<string, string>;
  }
  return null;
}

/** Build a specific keyword density label based on the stored metrics string, e.g. "4 mentions, 0.89% density" */
function getKeywordDensityLabel(metrics: Record<string, string> | null, level?: string | null): string {
  const MAX_KEYWORD_MENTIONS_UI: Record<string, number> = {
    cornerstone: 20,
    pillar: 15,
    cluster: 8,
  };
  const maxMentions = level ? (MAX_KEYWORD_MENTIONS_UI[level] ?? 20) : 20;

  const raw = metrics?.p1_keyword_density; // e.g. "4 mentions, 0.89% density"
  if (!raw) return "Keyword density too low or too high (need 4+ mentions, 1\u20132.5%)";
  // Parse: "N mentions, X.XX% density"
  const mentionMatch = raw.match(/(\d+)\s+mention/);
  const densityMatch = raw.match(/([\d.]+)%\s+density/);
  const kwMatches = mentionMatch ? parseInt(mentionMatch[1]) : null;
  const kwDensityPct = densityMatch ? parseFloat(densityMatch[1]) : null;
  // Check over-mention FIRST (takes priority over density % checks)
  if (kwMatches !== null && kwMatches > maxMentions) {
    return `Keyword used ${kwMatches} times \u2014 reduce to under ${maxMentions} mentions for natural reading`;
  }
  if (kwMatches !== null && kwMatches < 4) {
    return `Keyword used only ${kwMatches} time${kwMatches === 1 ? "" : "s"} \u2014 aim for 4+ mentions`;
  }
  if (kwDensityPct !== null && kwDensityPct > 2.5) {
    return `Keyword density ${kwDensityPct.toFixed(1)}% \u2014 slightly over 2.5% ceiling`;
  }
  if (kwDensityPct !== null && kwDensityPct < 1.0 && kwMatches !== null && kwMatches >= 4) {
    return `Keyword density ${kwDensityPct.toFixed(2)}% \u2014 just under 1% target (mentions are fine)`;
  }
  return `Keyword density ${kwDensityPct !== null ? kwDensityPct.toFixed(2) + "%" : ""} \u2014 outside 1\u20132.5% range`;
}

// Labels describe the PROBLEM (what is missing or wrong) — used in the failing-checks list.
// A label that appears in the amber/red failure list must always describe what needs fixing,
// not what the passing state looks like.
const PASS1_CHECK_LABELS: Record<keyof Pass1Checks, string> = {
  p1_keyword_density: "Keyword density too low or too high (need 4+ mentions, 1–2.5%)", // overridden dynamically via getKeywordDensityLabel()
  p2_keyword_in_h1: "Keyword missing from H1 title",
  p3_keyword_in_h2: "Keyword missing from H2 heading",
  p4_keyword_in_h3: "Keyword missing from H3 heading (or no H3s present)",
  p5_keyword_first_100: "Keyword not found in first 150 words",
  p6_keyword_in_slug: "Keyword missing from URL slug",
  p7_meta_title: "Meta title missing keyword or over 60 chars",
  p8_meta_description: "Meta description missing keyword or not 140–160 chars",
  p9_opening_answer: "Opening answer / question block missing",
  p10_external_link: "No external link found",
  p11_internal_cta: "No internal CTA link found",
  p12_internal_blog_links: "Fewer than 2 internal blog links",
  p13_schema: "Schema markup missing",
  p14_eeat: "E-E-A-T signals missing (experience, clients, awards)",
  p15_human_authenticity: "AI fingerprint phrases detected",
  p16_word_count: "Word count outside target range",
};

// Which checks are directly affected by editable SEO fields
const FIELD_CHECK_MAP = {
  urlSlug: ["p6_keyword_in_slug"] as (keyof Pass1Checks)[],
  metaTitle: ["p7_meta_title"] as (keyof Pass1Checks)[],
  metaDescription: ["p8_meta_description"] as (keyof Pass1Checks)[],
  focusKeyword: ["p1_keyword_density", "p2_keyword_in_h1", "p3_keyword_in_h2", "p4_keyword_in_h3", "p5_keyword_first_100", "p6_keyword_in_slug", "p7_meta_title", "p8_meta_description"] as (keyof Pass1Checks)[],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArticleStatus =
  | "pending_generation"
  | "generating"
  | "generated"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "published"
  | "failed";

type StatusBadge = "authority_ready" | "strong" | "needs_review" | null | undefined;

interface ArticleListItem {
  // articles.getAll returns id (article DB id) and articleNodeId (node id)
  id: number;
  articleNodeId: number;
  status: ArticleStatus;
  statusBadge: StatusBadge;
  title: string | null;
  wordCount: number | null;
  internalScore: number | null;
  pass2Score: number | null;
  pass2Details?: string | null;
  pass1Details: { points: Record<string, boolean>; metrics: Record<string, string> } | Record<string, boolean> | null | unknown;
  level: "cornerstone" | "pillar" | "cluster";
  articleType: string;
  urlSlug: string | null;
  sortOrder: number;
  errorMessage: string | null;
  generationAttempts: number | null;
  approvedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function StatusBadgeChip({
  badge,
  status,
}: {
  badge: StatusBadge;
  status: ArticleStatus;
}) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Published
      </span>
    );
  }
  if (status === "scheduled") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary">
        ⏰ Scheduled
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-destructive/15 text-destructive">
        <XCircle className="h-3 w-3" />
        Publish Failed
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  }
  if (!badge) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">
        ⏳ Pending Review
      </span>
    );
  }
  if (badge === "authority_ready") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400">
        <Trophy className="h-3 w-3" />
        Authority Ready
      </span>
    );
  }
  if (badge === "strong") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary">
        <Zap className="h-3 w-3" />
        Strong
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      Needs Review
    </span>
  );
}

function LevelLabel({ level }: { level: "cornerstone" | "pillar" | "cluster" }) {
  if (level === "cornerstone") {
    return (
      <span className="text-xs font-bold uppercase tracking-wide text-violet-400">
        Cornerstone
      </span>
    );
  }
  if (level === "pillar") {
    return (
      <span className="text-xs font-bold uppercase tracking-wide text-primary">
        Pillar
      </span>
    );
  }
  return (
    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
      Cluster
    </span>
  );
}

// Publish-readiness threshold: 14+ out of 16 is SEO-optimised and ready to publish.
// Only show warnings (orange) below 12. 12-13 is a soft info note. 14+ is green.
const PUBLISH_READY_THRESHOLD = 14;
const WARN_THRESHOLD = 12;

function ScoreBadgePanel({ liveChecks }: { badge?: StatusBadge; liveChecks?: Pass1Checks | null }) {
  const passCount = liveChecks ? Object.values(liveChecks).filter(Boolean).length : null;
  const score = passCount ?? 0;

  // Checks that are genuinely failing (not just "no H3 headings" which auto-passes)
  const failingChecks = liveChecks
    ? (Object.keys(liveChecks) as (keyof Pass1Checks)[]).filter(k => !liveChecks[k])
    : [];

  // 14+ = Ready to Publish (green) — show any failing checks as optional info
  if (score >= PUBLISH_READY_THRESHOLD) {
    const label = score === 16 ? "Perfect Score" : score === 15 ? "Authority Ready" : "Ready to Publish";
    const emoji = score === 16 ? "✨" : "✅";
    return (
      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
        <div className="flex items-center gap-3">
          <div className="text-xl">{emoji}</div>
          <div>
            <div className="text-sm font-bold text-emerald-400">{label} — {score}/16</div>
            <div className="text-xs text-emerald-600">
              {score === 16
                ? "All 16 SEO checks passed. Publish with confidence."
                : "SEO optimised and ready to publish. Over-editing can reduce the human quality Google rewards."
              }
            </div>
          </div>
        </div>
        {/* Show the 1–2 failing checks even at 15/16 so the user knows exactly what was missed */}
        {score < 16 && failingChecks.length > 0 && (
          <div className="mt-2 pt-2 border-t border-emerald-500/20">
            <div className="text-[10px] font-semibold text-emerald-600 mb-1">Missed point{failingChecks.length > 1 ? 's' : ''} (optional to fix):</div>
            <div className="flex flex-col gap-1">
              {failingChecks.map(k => (
                <div key={k} className="flex items-start gap-1.5 text-xs text-emerald-700">
                  <span className="mt-0.5 shrink-0">◦</span>
                  <span>{PASS1_CHECK_LABELS[k]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 12–13 = Soft info note (neutral blue/slate, no hazard icon)
  if (score >= WARN_THRESHOLD) {
    return (
      <div className="rounded-lg bg-slate-500/10 border border-slate-500/20 p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">📌</span>
          <div>
            <div className="text-sm font-semibold text-slate-300">Good — {score}/16</div>
            <div className="text-xs text-slate-400">A few optional improvements available.</div>
          </div>
        </div>
        {failingChecks.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {failingChecks.map(k => (
              <div key={k} className="flex items-start gap-1.5 text-xs text-slate-400">
                <span className="mt-0.5 shrink-0">◦</span>
                <span>{PASS1_CHECK_LABELS[k]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Below 12 = Needs attention (orange — only here)
  return (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">⚠️</span>
        <div>
          <div className="text-sm font-bold text-amber-400">Needs Attention — {score}/16</div>
          <div className="text-xs text-amber-500">Below the 12-point minimum. Review the items below.</div>
        </div>
      </div>
      {failingChecks.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="text-xs font-semibold text-amber-400 mb-1">To improve:</div>
          {failingChecks.map(k => (
            <div key={k} className="flex items-start gap-1.5 text-xs text-amber-600">
              <span className="mt-0.5 shrink-0">✗</span>
              <span>{PASS1_CHECK_LABELS[k]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyRow helper
// ---------------------------------------------------------------------------

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-full flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors text-left group"
      title={`Click to copy ${label}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
        {value ? (
          <div className={`text-xs text-foreground truncate ${mono ? "font-mono" : ""}`}>
            {value.length > 120 ? value.slice(0, 120) + "…" : value}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">Not set</div>
        )}
      </div>
      <div className={`shrink-0 mt-1 text-xs font-medium transition-colors ${
        copied ? "text-emerald-500" : "text-muted-foreground group-hover:text-primary"
      }`}>
        {copied ? "Copied!" : <ClipboardCopy className="h-3.5 w-3.5" />}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ArticleReview() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();

  // Business + articles data
  const { activeBusiness: business, isLoading: bizLoading, refetch: refetchBusiness } = useActiveBusiness();

  const { data: articlesData, isLoading: articlesLoading, refetch: refetchArticles } = trpc.articles.getAll.useQuery(
    { businessId: business?.id ?? 0 },
    {
      enabled: !!business?.id,
      // Poll every 4 seconds while any article is generating so the UI stays live
      refetchInterval: (data) => {
        const list = data?.state?.data as ArticleListItem[] | undefined;
        const anyGenerating = list?.some(a => a.status === "generating" || a.status === "pending_generation");
        return anyGenerating ? 4000 : false;
      },
    }
  );

  // Selected article
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvedModalCount, setApprovedModalCount] = useState(0);
  const [approveJustSucceeded, setApproveJustSucceeded] = useState(false);

  const articleList: ArticleListItem[] = useMemo(() => articlesData ?? [], [articlesData]);

  // Read ?articleId= from URL to deep-link to a specific article
  const searchString = useSearch();
  const urlArticleId = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const v = params.get("articleId");
    return v ? parseInt(v, 10) : null;
  }, [searchString]);

  // Auto-select: prefer URL articleId, then first article
  useEffect(() => {
    if (articleList.length === 0) return;
    if (selectedNodeId !== null) return; // already selected
    if (urlArticleId) {
      const target = articleList.find(a => a.id === urlArticleId);
      if (target) {
        setSelectedNodeId(target.articleNodeId);
        return;
      }
    }
    setSelectedNodeId(articleList[0].articleNodeId);
  }, [articleList, selectedNodeId, urlArticleId]);

  const selectedItem = articleList.find(a => a.articleNodeId === selectedNodeId) ?? null;

  // Full article data
  const { data: fullArticle, isLoading: articleLoading, refetch: refetchFull } = trpc.articles.get.useQuery(
    { articleId: selectedItem?.id ?? 0 },
    { enabled: !!selectedItem?.id }
  );

  // SEO field state (local edits)
  const [seoEdits, setSeoEdits] = useState<{
    urlSlug: string;
    metaTitle: string;
    metaDescription: string;
    focusKeyword: string;
    imageUrl: string;
  }>({ urlSlug: "", metaTitle: "", metaDescription: "", focusKeyword: "", imageUrl: "" });

  // Sync SEO fields when article changes
  useEffect(() => {
    if (fullArticle) {
      setSeoEdits({
        urlSlug: (fullArticle as any).urlSlug ?? "",
        metaTitle: (fullArticle as any).metaTitle ?? "",
        metaDescription: (fullArticle as any).metaDescription ?? "",
        focusKeyword: (fullArticle as any).focusKeyword ?? "",
        imageUrl: (fullArticle as any).imageUrl ?? "",
      });
    }
  }, [(fullArticle as any)?.id]);

  // Mutations
  const utils = trpc.useUtils();

  const updateSeoFields = trpc.articles.updateSeoFields.useMutation({
    onSuccess: () => {
      toast.success("SEO fields saved.");
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatus = trpc.articles.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Article moved back to review.");
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  const approve = trpc.articles.approve.useMutation({
    onSuccess: (data) => {
      if (data.alreadyApproved) {
        toast.info("Article already approved.");
      } else {
        setApproveJustSucceeded(true);
        setTimeout(() => setApproveJustSucceeded(false), 2500);
      }
      refetchArticles();
      refetchFull();
      refetchBusiness();
      // Check if all articles will now be approved after this one
      // We check after refetch settles via a short delay
      setTimeout(() => {
        refetchArticles().then((result) => {
          const list = result.data as ArticleListItem[] | undefined;
          if (!list) return;
          const total = list.length;
          const approved = list.filter(a =>
            a.status === "approved" || a.status === "scheduled" || a.status === "published"
          ).length;
          if (total > 0 && approved === total) {
            setApprovedModalCount(total);
            setShowApprovalModal(true);
          }
        });
      }, 400);
    },
    onError: (err) => toast.error(err.message),
  });

  const approveAll = trpc.articles.approveAll.useMutation({
    onSuccess: (data) => {
      refetchArticles();
      refetchFull();
      refetchBusiness();
      const count = data.approvedCount > 0 ? data.approvedCount : totalCount;
      setApprovedModalCount(count);
      setShowApprovalModal(true);
    },
    onError: (err) => toast.error(err.message),
  });

  const regenerate = trpc.articles.regenerate.useMutation({
    onSuccess: () => {
      toast.success("Regeneration started. This may take a minute.");
      refetchArticles();
    },
    onError: (err) => toast.error(err.message),
  });

  // Image URL is saved via updateSeoFields — no file upload needed

  const retryPublish = trpc.articles.retryPublish.useMutation({
    onSuccess: () => {
      toast.success("Publish retry started.");
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  // Article body editing state
  const [bodyEditMode, setBodyEditMode] = useState(false);
  const [bodyEditHtml, setBodyEditHtml] = useState("");

  // Sync body edit state when article changes
  useEffect(() => {
    setBodyEditMode(false);
    setBodyEditHtml((fullArticle as any)?.bodyHtml ?? "");
  }, [(fullArticle as any)?.id]);

  const updateBody = trpc.articles.updateBody.useMutation({
    onSuccess: (data) => {
      toast.success(`Article body saved. (${data.wordCount.toLocaleString()} words)`);
      setBodyEditMode(false);
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  // AI instruction panel state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");

  // Per-article publish action panel state
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [publishMode, setPublishMode] = useState<"live" | "draft" | "schedule">("live");
  const [scheduleDate, setScheduleDate] = useState(""); // datetime-local string

  // Integration data (to know which platforms are connected)
  const { data: integrationsData } = trpc.integrations.get.useQuery(
    { businessId: business?.id ?? 0 },
    { enabled: !!business?.id, refetchOnMount: true, staleTime: 0 }
  );
  const connectedPlatforms = (integrationsData ?? []).filter((i: any) => i.status === "connected").map((i: any) => i.platform as string);
  const defaultPlatform = connectedPlatforms.includes("wix") ? "wix" : connectedPlatforms.includes("wordpress") ? "wordpress" : connectedPlatforms[0] ?? null;
  const [publishPlatform, setPublishPlatform] = useState<string | null>(null);

  const publishSingle = trpc.articles.publishSingle.useMutation({
    onSuccess: (data) => {
      if (data.status === "draft_pushed") {
        toast.success("Article pushed as draft to your CMS.");
      } else if (data.status === "scheduled") {
        toast.success("Article scheduled for publishing.");
      } else {
        toast.success("Article published successfully!");
      }
      setPublishPanelOpen(false);
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  function handlePublishSingle() {
    if (!selectedItem?.id) return;
    const platform = publishPlatform ?? defaultPlatform;
    if (!platform) {
      toast.error("No CMS connected. Go to Integrations to connect WordPress, Wix, or Zapier.");
      return;
    }
    // datetime-local gives "YYYY-MM-DDTHH:mm" with no timezone — treat as local time
    // by replacing the T separator with a space so JS Date parses it as local, not UTC
    const scheduledAt = publishMode === "schedule" && scheduleDate
      ? new Date(scheduleDate.replace("T", " ")).getTime()
      : undefined;
    publishSingle.mutate({
      articleId: selectedItem.id,
      platform: platform as "wordpress" | "wix" | "zapier",
      publishAs: publishMode === "draft" ? "draft" : "live",
      scheduledAt,
    });
  }

  const aiEditInstruction = trpc.articles.aiEditInstruction.useMutation({
    onSuccess: (data) => {
      toast.success(`AI edit applied. (${data.wordCount.toLocaleString()} words)`);
      setAiPanelOpen(false);
      setAiInstruction("");
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  // ---------------------------------------------------------------------------
  // Live SEO check computation — re-runs whenever seoEdits or fullArticle changes
  // ---------------------------------------------------------------------------
  const liveChecks = useMemo((): Pass1Checks | null => {
    if (!fullArticle || !selectedItem) return null;
    const fa = fullArticle as any;
    return computePass1Checks({
      bodyHtml: fa.bodyHtml ?? "",
      title: fa.title ?? "",
      metaTitle: seoEdits.metaTitle,
      metaDescription: seoEdits.metaDescription,
      urlSlug: seoEdits.urlSlug,
      wordCount: fa.wordCount ?? 0,
      level: selectedItem.level,
      focusKeyword: seoEdits.focusKeyword,
      schemaMarkup: fa.schemaMarkup,
    });
  }, [fullArticle, selectedItem, seoEdits.metaTitle, seoEdits.metaDescription, seoEdits.urlSlug, seoEdits.focusKeyword]);

  // livePassCount is used only by fieldFailing() for SEO field warning indicators (amber borders).
  // It is NOT used for the score display — both sidebar and detail panel use selectedItem.internalScore.
  const livePassCount = liveChecks ? Object.values(liveChecks).filter(Boolean).length : null;

  // Helper: does a field have a failing check AND the overall score is below the publish threshold?
  // Only triggers amber/warning styling when the article genuinely needs attention (score < 14).
  // At 14+ the article is SEO-ready; individual check failures are not surfaced as warnings.
  function fieldFailing(field: keyof typeof FIELD_CHECK_MAP): boolean {
    if (!liveChecks) return false;
    if ((livePassCount ?? 0) >= PUBLISH_READY_THRESHOLD) return false; // 14+ = no field warnings
    return FIELD_CHECK_MAP[field].some(key => !liveChecks[key]);
  }

  // Derived state
  const approvedCount = articleList.filter(
    a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
  ).length;
  // Stage guard: need stage >= 4 (articles generated)
  const totalCount = articleList.length;
  const allApproved = approvedCount === totalCount && totalCount > 0;

  // Article list filter
  type ListFilter = "all" | "low_pass2" | "needs_review" | "approved";
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const filteredArticleList = useMemo(() => {
    switch (listFilter) {
      case "low_pass2":
        return articleList.filter(a => a.pass2Score != null && a.pass2Score < 70);
      case "needs_review":
        return articleList.filter(a => a.statusBadge === "needs_review" || a.status === "failed");
      case "approved":
        return articleList.filter(a => a.status === "approved" || a.status === "scheduled" || a.status === "published");
      default:
        return articleList;
    }
  }, [articleList, listFilter]);

  const lowPass2Count = useMemo(
    () => articleList.filter(a => a.pass2Score != null && a.pass2Score < 70).length,
    [articleList]
  );

  // Stage guard
  useEffect(() => {
    if (!authLoading && !bizLoading) {
      if (!user) {
        navigate("/login");
        return;
      }
      if (business && (business.currentStage ?? 0) < 4) {
        navigate("/generate");
      }
    }
  }, [authLoading, bizLoading, user, business, navigate]);

  if (authLoading || bizLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // isApproved controls the article body editor lock — NOT the SEO fields.
  // SEO fields (slug, meta title, meta description, focus keyword, image URL)
  // are always editable so users can update them before re-publishing.
  const isApproved =
    selectedItem?.status === "approved" ||
    selectedItem?.status === "scheduled" ||
    selectedItem?.status === "published" ||
    selectedItem?.status === "failed";

  // SEO fields are always editable regardless of publish status
  const seoFieldsLocked = false;
  const canRegenerate = !!selectedItem?.id &&
    selectedItem?.status !== "approved" &&
    selectedItem?.status !== "scheduled" &&
    selectedItem?.status !== "published";

  function handleSaveDraft() {
    if (!selectedItem?.id) return;
    updateSeoFields.mutate({
      articleId: selectedItem.id,
      urlSlug: seoEdits.urlSlug || undefined,
      metaTitle: seoEdits.metaTitle || undefined,
      metaDescription: seoEdits.metaDescription || undefined,
      focusKeyword: seoEdits.focusKeyword || undefined,
      imageUrl: seoEdits.imageUrl || undefined,
    });
  }

  function handleApprove() {
    if (!selectedItem?.id) return;
    // Save any pending SEO edits first, then approve
    if (
      seoEdits.urlSlug !== ((fullArticle as any)?.urlSlug ?? "") ||
      seoEdits.metaTitle !== ((fullArticle as any)?.metaTitle ?? "") ||
      seoEdits.metaDescription !== ((fullArticle as any)?.metaDescription ?? "") ||
      seoEdits.focusKeyword !== ((fullArticle as any)?.focusKeyword ?? "")
    ) {
      updateSeoFields.mutate(
        {
          articleId: selectedItem.id,
          urlSlug: seoEdits.urlSlug || undefined,
          metaTitle: seoEdits.metaTitle || undefined,
          metaDescription: seoEdits.metaDescription || undefined,
          focusKeyword: seoEdits.focusKeyword || undefined,
          imageUrl: seoEdits.imageUrl || undefined,
        },
        {
          onSuccess: () => {
            approve.mutate({ articleId: selectedItem.id! });
          },
        }
      );
    } else {
      approve.mutate({ articleId: selectedItem.id });
    }
  }

  const metaTitleLen = seoEdits.metaTitle.length;
  const metaDescLen = seoEdits.metaDescription.length;
  const currentStage = business?.currentStage ?? 1;

  return (
    <DashboardLayout>
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:"#faf9f5" }}>
      <StageStepper currentStage={allApproved ? Math.max(currentStage, 6) : currentStage} activeStage={allApproved ? 6 : 5} />
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* ── Left sidebar: article list ─────────────────────────────────── */}
      <div className="w-72 min-w-[280px] border-r border-border flex flex-col bg-card overflow-y-auto">
        {/* Header — green banner when all approved, otherwise normal progress */}
        {allApproved ? (
          <div className="px-4 py-3 border-b border-border bg-emerald-500/10">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-emerald-600">Ready to publish</p>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">{approvedCount} / {totalCount} approved</p>
              </div>
              <Button
                size="sm"
                type="button"
                className="shrink-0 text-xs font-bold"
                style={{ background: "#7c3aed", color: "#fff" }}
                onClick={() => navigate("/publish")}
              >
                Proceed to Schedule <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold text-foreground">Stage 5 — Review &amp; Publish</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {approvedCount} / {totalCount} approved
            </p>
            {totalCount > 0 && (
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${totalCount > 0 ? (approvedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Approve all button */}
        {!allApproved && totalCount > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <Button
              size="sm"
              variant="outline"
              type="button"
              className="w-full text-xs"
              onClick={() => business?.id && approveAll.mutate({ businessId: business.id })}
              disabled={approveAll.isPending}
            >
              {approveAll.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              Approve All
            </Button>
          </div>
        )}

        {/* Filter dropdown */}
        {totalCount > 0 && (
          <div className="px-3 py-2 border-b border-border">
            <div className="relative">
              <button
                className="w-full flex items-center justify-between gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-muted/50 transition-colors"
                onClick={() => setListFilter(prev => prev === "all" ? "low_pass2" : "all")}
                title="Cycle through filters"
              >
                <span className="flex items-center gap-1.5">
                  <Filter className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground font-medium">
                    {listFilter === "all" && "All articles"}
                    {listFilter === "low_pass2" && (
                      <span className="flex items-center gap-1">
                        Low quality score
                        {lowPass2Count > 0 && (
                          <span className="bg-amber-500/20 text-amber-600 text-[10px] px-1 rounded font-semibold">{lowPass2Count}</span>
                        )}
                      </span>
                    )}
                    {listFilter === "needs_review" && "Needs review"}
                    {listFilter === "approved" && "Approved"}
                  </span>
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
              {/* Filter options — shown as a small inline segmented row */}
              <div className="mt-1.5 flex gap-1 flex-wrap">
                {(["all", "low_pass2", "needs_review", "approved"] as ListFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setListFilter(f)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      listFilter === f
                        ? f === "low_pass2"
                          ? "bg-amber-500/20 border-amber-500/40 text-amber-600 font-semibold"
                          : "bg-primary/10 border-primary/40 text-primary font-semibold"
                        : "bg-transparent border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {f === "all" && "All"}
                    {f === "low_pass2" && (
                      <span>
                        Quality &lt; 70{lowPass2Count > 0 && ` (${lowPass2Count})`}
                      </span>
                    )}
                    {f === "needs_review" && "Needs review"}
                    {f === "approved" && "Approved"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Article list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {articlesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : articleList.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No articles generated yet.
              <br />
              <button
                className="mt-2 text-primary underline text-xs"
                onClick={() => navigate("/generate")}
              >
                Go to Article Generation
              </button>
            </div>
          ) : filteredArticleList.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No articles match this filter.
              <br />
              <button
                className="mt-2 text-primary underline text-xs"
                onClick={() => setListFilter("all")}
              >
                Show all articles
              </button>
            </div>
          ) : (
            filteredArticleList.map((item) => {
              const isSelected = item.articleNodeId === selectedNodeId;
              return (
                <div
                  key={item.articleNodeId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedNodeId(item.articleNodeId)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedNodeId(item.articleNodeId); } }}
                  className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-primary/10 border-primary"
                      : "bg-background border-border hover:bg-muted/50"
                  }`}
                >
                  <LevelLabel level={item.level} />
                  <div className="text-xs font-medium text-foreground mt-1 line-clamp-2">
                    {item.title ?? item.urlSlug ?? `Article ${item.articleNodeId}`}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <StatusBadgeChip badge={item.statusBadge as StatusBadge} status={item.status as ArticleStatus} />
                  </div>
                  {/* Publish Failed: show error hint + retry button */}
                  {item.status === "failed" && (
                    <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                      {item.errorMessage && (
                        <p className="text-[10px] text-destructive leading-tight mb-1.5 line-clamp-2">
                          {item.errorMessage}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        className="h-6 text-[10px] px-2 border-destructive/50 text-destructive hover:bg-destructive/10"
                        disabled={retryPublish.isPending && retryPublish.variables?.articleId === item.id}
                        onClick={() => item.id && retryPublish.mutate({ articleId: item.id })}
                      >
                        {retryPublish.isPending && retryPublish.variables?.articleId === item.id ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-2.5 w-2.5 mr-1" />
                        )}
                        Retry publish
                      </Button>
                    </div>
                  )}
                  {/* Checkpoint 1 mini-badge — always show stored DB score for all articles */}
                  {item.internalScore != null && (
                    <div className="mt-1 flex gap-1">
                      {(() => {
                        const displayScore = item.internalScore != null ? Math.round((item.internalScore / 100) * 16) : null;
                        if (displayScore == null) return null;
                        return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            displayScore >= 15
                              ? "bg-emerald-500/15 text-emerald-500"
                              : displayScore >= 13
                              ? "bg-blue-500/15 text-blue-400"
                              : "bg-amber-500/15 text-amber-500"
                          }`}>
                            ✓1 {displayScore}/16
                          </span>
                        );
                      })()}
                      {item.pass2Score != null && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          item.pass2Score >= 70
                            ? "bg-emerald-500/15 text-emerald-500"
                            : item.pass2Score >= 50
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-red-500/15 text-red-400"
                        }`}>
                          ✓2 {item.pass2Score}/100
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom CTA removed — top sidebar has Approve All + green banner when all approved */}
      </div>

      {/* ── Right panel: article body + SEO panel ─────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedItem ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an article from the list to review it.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_360px] gap-6 p-6 min-h-full">
            {/* ── Article body ────────────────────────────────────────── */}
            <div className="bg-card border border-border rounded-xl p-6 overflow-y-auto">
              {/* Article header bar */}
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
                <StatusBadgeChip badge={selectedItem.statusBadge as StatusBadge} status={selectedItem.status as ArticleStatus} />
                <span className="text-xs text-muted-foreground">
                  {selectedItem.wordCount ? `${selectedItem.wordCount.toLocaleString()} words` : ""}{" "}
                  {selectedItem.wordCount && "•"}{" "}
                  <span className="capitalize">{selectedItem.level}</span>
                </span>
                {canRegenerate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-xs"
                    onClick={() =>
                      selectedItem.id &&
                      regenerate.mutate({ articleId: selectedItem.id })
                    }
                    disabled={regenerate.isPending || selectedItem.status === "generating" || selectedItem.status === "pending_generation"}
                  >
                    {(regenerate.isPending || selectedItem.status === "generating" || selectedItem.status === "pending_generation") ? (
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    {(selectedItem.status === "generating" || selectedItem.status === "pending_generation") ? "Generating…" : "Regenerate"}
                  </Button>
                )}
              </div>

              {articleLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : fullArticle ? (
                <div>
                  {/* Edit / Preview toggle bar */}
                  {!isApproved && (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          if (bodyEditMode) {
                            // Discard changes
                            setBodyEditHtml((fullArticle as any).bodyHtml ?? "");
                            setBodyEditMode(false);
                          } else {
                            setBodyEditHtml((fullArticle as any).bodyHtml ?? "");
                            setBodyEditMode(true);
                            setAiPanelOpen(false);
                          }
                        }}
                        className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
                          bodyEditMode
                            ? "bg-muted border-border text-muted-foreground hover:bg-muted/80"
                            : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                        }`}
                      >
                        {bodyEditMode ? "Cancel Editing" : "✏️ Edit Article Body"}
                      </button>
                      {!bodyEditMode && (
                        <button
                          type="button"
                          onClick={() => setAiPanelOpen(v => !v)}
                          className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
                            aiPanelOpen
                              ? "bg-violet-100 border-violet-300 text-violet-700 hover:bg-violet-200"
                              : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100"
                          }`}
                        >
                          ✨ AI Edit Instruction
                        </button>
                      )}
                      {bodyEditMode && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedItem?.id) return;
                            updateBody.mutate({ articleId: selectedItem.id, bodyHtml: bodyEditHtml });
                          }}
                          disabled={updateBody.isPending}
                          className="text-xs px-3 py-1.5 rounded-md border font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {updateBody.isPending ? (
                            <><Loader2 className="inline h-3 w-3 animate-spin mr-1" />Saving...</>
                          ) : (
                            <><Save className="inline h-3 w-3 mr-1" />Save Body</>
                          )}
                        </button>
                      )}
                      {bodyEditMode && (
                        <span className="text-xs text-muted-foreground ml-1">
                          Editing raw HTML — preserve all tags. Keyword placement affects SEO score.
                        </span>
                      )}
                    </div>
                  )}

                  {/* AI Instruction Panel */}
                  {aiPanelOpen && !bodyEditMode && !isApproved && (
                    <div className="mb-4 p-4 rounded-xl border border-violet-200 bg-violet-50/60">
                      <div className="flex items-start gap-2 mb-3">
                        <span className="text-violet-600 text-base mt-0.5">✨</span>
                        <div>
                          <p className="text-sm font-semibold text-violet-800">AI Edit Instruction</p>
                          <p className="text-xs text-violet-600 mt-0.5">
                            Describe what you want changed in plain English. The AI will apply only your instruction and preserve everything else.
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-violet-500 font-medium">Examples:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            "Change '1 year in business' to reflect 30+ years of combined experience",
                            "Replace 'we' with the business name throughout",
                            "Make the tone more conversational and less formal",
                            "Add a paragraph about our free consultation offer",
                          ].map(example => (
                            <button
                              key={example}
                              type="button"
                              onClick={() => setAiInstruction(example)}
                              className="text-xs px-2 py-1 rounded-md bg-violet-100 border border-violet-200 text-violet-700 hover:bg-violet-200 transition-colors text-left"
                            >
                              {example}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className="w-full min-h-[80px] text-sm bg-white border border-violet-200 rounded-lg p-3 resize-y focus:outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-violet-300"
                          placeholder="e.g. Change '1 year in business' to reflect 30+ years of combined business experience across multiple businesses..."
                          value={aiInstruction}
                          onChange={e => setAiInstruction(e.target.value)}
                          disabled={aiEditInstruction.isPending}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!aiInstruction.trim() || aiEditInstruction.isPending || !selectedItem?.id}
                            onClick={() => {
                              if (!selectedItem?.id || !aiInstruction.trim()) return;
                              aiEditInstruction.mutate({ articleId: selectedItem.id, instruction: aiInstruction.trim() });
                            }}
                            className="text-sm px-4 py-2 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            {aiEditInstruction.isPending ? (
                              <><Loader2 className="h-4 w-4 animate-spin" />Applying AI edit…</>
                            ) : (
                              <>✨ Apply AI Edit</>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAiPanelOpen(false); setAiInstruction(""); }}
                            className="text-sm px-3 py-2 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-100 transition-colors"
                            disabled={aiEditInstruction.isPending}
                          >
                            Cancel
                          </button>
                          {aiEditInstruction.isPending && (
                            <span className="text-xs text-violet-500">This may take 15–30 seconds…</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {bodyEditMode ? (
                    <textarea
                      className="w-full min-h-[600px] text-xs font-mono bg-muted/40 border border-border rounded-lg p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                      value={bodyEditHtml}
                      onChange={e => setBodyEditHtml(e.target.value)}
                      spellCheck={false}
                    />
                  ) : (
                    <div>
                      {/* Position Zero Answer Block callout */}
                      {fullArticle.bodyHtml && /class="position-zero-answer"|<blockquote|<strong>[^<]*\?/i.test(fullArticle.bodyHtml) && (
                        <div className="mb-4 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/20 text-xs text-primary font-medium">
                          📌 Position Zero Answer Block
                        </div>
                      )}
                      <div
                        className="prose prose-sm max-w-none text-foreground"
                        dangerouslySetInnerHTML={{ __html: (fullArticle.bodyHtml ?? "").replace(/<p[^>]*class="ai-disclosure"[^>]*>[\s\S]*?<\/p>/gi, "").replace(/<p[^>]*>[\s\S]*?This article was researched and drafted with AI assistance[\s\S]*?<\/p>/gi, "").trim() }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Article content not available. The article may still be generating.
                </div>
              )}
            </div>

            {/* ── SEO Panel ───────────────────────────────────────────── */}
            <div className="flex flex-col gap-4">
              {/* URL Slug */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className={`text-xs font-semibold ${fieldFailing("urlSlug") ? "text-amber-600" : "text-foreground"}`}>URL Slug</Label>
                  {fieldFailing("urlSlug") && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                  <HelpLink slug="url-slug-best-practices" label="How to write a good URL slug" />
                </div>
                <div className="flex gap-1">
                  <Input
                    value={seoEdits.urlSlug}
                    onChange={e => setSeoEdits(prev => ({ ...prev, urlSlug: e.target.value }))}
                    placeholder="url-slug-here"
                    className={`text-xs font-mono flex-1 ${fieldFailing("urlSlug") ? "border-amber-400 focus-visible:ring-amber-400" : ""}`}
                    disabled={seoFieldsLocked}
                  />
                  <button
                    type="button"
                    title="Copy slug"
                    onClick={() => { navigator.clipboard.writeText(seoEdits.urlSlug); toast.success("Slug copied"); }}
                    className="px-2 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                {fieldFailing("urlSlug") && (
                  <p className="text-[11px] text-amber-600">Include your focus keyword in the slug (e.g. focus-keyword-topic)</p>
                )}
              </div>

              {/* Meta Title */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className={`text-xs font-semibold ${fieldFailing("metaTitle") ? "text-red-600" : "text-foreground"}`}>Meta Title</Label>
                  {fieldFailing("metaTitle") && <XCircle className="h-3 w-3 text-red-500" />}
                  <HelpLink slug="meta-title-description" label="Meta title best practices" />
                </div>
                <div className="flex gap-1">
                  <Input
                    value={seoEdits.metaTitle}
                    onChange={e => setSeoEdits(prev => ({ ...prev, metaTitle: e.target.value }))}
                    placeholder="Meta title (max 60 chars)"
                    className={`text-xs flex-1 ${fieldFailing("metaTitle") ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                    disabled={seoFieldsLocked}
                  />
                  <button
                    type="button"
                    title="Copy meta title"
                    onClick={() => { navigator.clipboard.writeText(seoEdits.metaTitle); toast.success("Meta title copied"); }}
                    className="px-2 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className={`text-xs text-right ${
                  metaTitleLen > 60 ? "text-destructive" :
                  fieldFailing("metaTitle") ? "text-amber-600" :
                  "text-muted-foreground"
                }`}>
                  {metaTitleLen} / 60 chars {metaTitleLen <= 60 && !fieldFailing("metaTitle") ? "✓" : metaTitleLen > 60 ? "✗ too long" : "⚠ add keyword"}
                </div>
              </div>

              {/* Meta Description */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className={`text-xs font-semibold ${fieldFailing("metaDescription") ? "text-red-600" : "text-foreground"}`}>Meta Description</Label>
                  {fieldFailing("metaDescription") && <XCircle className="h-3 w-3 text-red-500" />}
                  <HelpLink slug="meta-title-description" label="Meta description best practices" />
                </div>
                <div className="relative">
                  <Textarea
                    value={seoEdits.metaDescription}
                    onChange={e => setSeoEdits(prev => ({ ...prev, metaDescription: e.target.value }))}
                    placeholder="Meta description (140–160 chars)"
                    className={`text-xs min-h-[70px] resize-none pr-8 ${fieldFailing("metaDescription") ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                    disabled={seoFieldsLocked}
                  />
                  <button
                    type="button"
                    title="Copy meta description"
                    onClick={() => { navigator.clipboard.writeText(seoEdits.metaDescription); toast.success("Meta description copied"); }}
                    className="absolute top-2 right-2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className={`text-xs text-right ${
                  (metaDescLen < 140 || metaDescLen > 160) ? "text-amber-600" :
                  fieldFailing("metaDescription") ? "text-amber-600" :
                  "text-muted-foreground"
                }`}>
                  {metaDescLen} / 160 chars {metaDescLen >= 140 && metaDescLen <= 160 && !fieldFailing("metaDescription") ? "✓" : metaDescLen < 140 ? "⚠ too short" : metaDescLen > 160 ? "⚠ too long" : "⚠ add keyword"}
                </div>
              </div>

              {/* Focus Keyword */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className={`text-xs font-semibold ${fieldFailing("focusKeyword") ? "text-amber-600" : "text-foreground"}`}>Focus Keyword</Label>
                  {fieldFailing("focusKeyword") && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                  <HelpLink slug="focus-keyword" label="What is a focus keyword?" />
                </div>
                <div className="flex gap-1">
                  <Input
                    value={seoEdits.focusKeyword}
                    onChange={e => setSeoEdits(prev => ({ ...prev, focusKeyword: e.target.value }))}
                    placeholder="focus keyword phrase"
                    className={`text-xs flex-1 ${fieldFailing("focusKeyword") ? "border-amber-400 focus-visible:ring-amber-400" : ""}`}
                    disabled={seoFieldsLocked}
                  />
                  <button
                    type="button"
                    title="Copy focus keyword"
                    onClick={() => { navigator.clipboard.writeText(seoEdits.focusKeyword); toast.success("Focus keyword copied"); }}
                    className="px-2 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                {fieldFailing("focusKeyword") && (
                  <p className="text-[11px] text-amber-600">Keyword should appear in H1, H2, first 150 words, meta title, and slug</p>
                )}
              </div>

              {/* Image URL */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold text-foreground">Featured Image URL</Label>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">optional</span>
                </div>
                <Input
                  value={seoEdits.imageUrl}
                  onChange={e => setSeoEdits(prev => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="https://your-site.com/wp-content/uploads/image.jpg"
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Paste the public URL of your image. Upload the image to your CMS media library first (Wix Media, WordPress Media, Shopify Files, etc.), then copy and paste the URL here. This URL will be sent to your CMS when you publish.
                </p>
              </div>

              {/* Action buttons */}
              {!isApproved ? (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={handleSaveDraft}
                    disabled={updateSeoFields.isPending}
                  >
                    {updateSeoFields.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    Save Draft
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={handleApprove}
                    disabled={approve.isPending || updateSeoFields.isPending}
                  >
                    {approve.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : approveJustSucceeded ? (
                      <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    )}
                    {approveJustSucceeded ? "Approved ✓" : "Approve & Publish →"}
                  </Button>
                </div>
              ) : selectedItem.status === "failed" ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold">Publish failed</div>
                      {selectedItem.errorMessage && (
                        <div className="mt-1 text-red-600">{selectedItem.errorMessage}</div>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => selectedItem.id && retryPublish.mutate({ articleId: selectedItem.id })}
                    disabled={retryPublish.isPending}
                  >
                    {retryPublish.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Retry Publish
                  </Button>
                </div>
              ) : selectedItem.status === "published" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Article published successfully.
                  </div>
                  {(fullArticle as any)?.cmsPostUrl && (
                    <a
                      href={(fullArticle as any).cmsPostUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View on CMS
                    </a>
                  )}
                  {/* Wix manual fields notice */}
                  {connectedPlatforms.includes("wix") && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-[11px] text-amber-400 leading-relaxed">
                          <span className="font-semibold">2 fields must be set manually in Wix</span> — the Wix API does not support setting these programmatically. Copy them below and paste into your Wix post editor.
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {[
                          { label: "Focus Keyword", value: (fullArticle as any)?.focusKeyword ?? "", hint: "Wix dashboard → Blog post → SEO tab → Focus keyword" },
                          { label: "Featured Image Alt Text", value: (fullArticle as any)?.imageAltText ?? "", hint: "Wix dashboard → Blog post → Featured image → Alt text" },
                        ].map(({ label, value, hint }) => (
                          <div key={label} className="rounded-md bg-background/60 border border-border p-2 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold text-foreground">{label}</span>
                              <button
                                onClick={() => { navigator.clipboard.writeText(value); toast.success(`${label} copied`); }}
                                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                              >
                                <ClipboardCopy className="h-3 w-3" />
                                Copy
                              </button>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">{value || "(not set)"}</p>
                            <p className="text-[9px] text-muted-foreground/60 italic">{hint}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Save Changes button for published articles */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    onClick={handleSaveDraft}
                    disabled={updateSeoFields.isPending}
                  >
                    {updateSeoFields.isPending ? (
                      <><span className="animate-spin mr-1.5">⟳</span> Saving...</>
                    ) : (
                      <>Save Changes</>
                    )}
                  </Button>
                  {/* Re-publish panel — full options (live / draft / schedule) */}
                  {!publishPanelOpen ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => {
                        setPublishPlatform(defaultPlatform);
                        setPublishMode("live");
                        setScheduleDate("");
                        setPublishPanelOpen(true);
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1.5" />
                      Re-publish to CMS
                    </Button>
                  ) : (
                    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Re-publish Options</span>
                        <button
                          type="button"
                          onClick={() => setPublishPanelOpen(false)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >✕</button>
                      </div>

                      {/* Platform selector */}
                      {connectedPlatforms.length > 0 ? (
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Platform</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {connectedPlatforms.map(p => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setPublishPlatform(p)}
                                className={`text-xs px-2.5 py-1 rounded-md border font-medium capitalize transition-colors ${
                                  (publishPlatform ?? defaultPlatform) === p
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background border-border text-foreground hover:bg-muted"
                                }`}
                              >
                                {p === "wix" ? "Wix" : p === "wordpress" ? "WordPress" : "Zapier"}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-500 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3" />
                          No CMS connected. <a href="/integrations" className="underline">Go to Integrations</a>
                        </div>
                      )}

                      {/* Publish mode — live / draft / schedule */}
                      {connectedPlatforms.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Action</Label>
                          <div className="flex gap-1.5">
                            {([
                              { mode: "live" as const, icon: Globe, label: "Publish live" },
                              { mode: "draft" as const, icon: Save, label: "Push as draft" },
                              { mode: "schedule" as const, icon: Calendar, label: "Schedule" },
                            ] as const).map(({ mode, icon: Icon, label }) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setPublishMode(mode)}
                                className={`flex-1 text-[11px] px-2 py-1.5 rounded-md border font-medium transition-colors flex flex-col items-center gap-0.5 ${
                                  publishMode === mode
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background border-border text-foreground hover:bg-muted"
                                }`}
                              >
                                <Icon className="h-3 w-3" />
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Date/time picker for schedule mode */}
                      {publishMode === "schedule" && connectedPlatforms.length > 0 && (
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Publish date &amp; time</Label>
                          <Input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={e => setScheduleDate(e.target.value)}
                            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                            className="text-xs h-8"
                          />
                        </div>
                      )}

                      {connectedPlatforms.length > 0 && (
                        <Button
                          size="sm"
                          className="w-full text-xs"
                          onClick={handlePublishSingle}
                          disabled={publishSingle.isPending || (publishMode === "schedule" && !scheduleDate)}
                        >
                          {publishSingle.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : publishMode === "live" ? (
                            <Globe className="h-3 w-3 mr-1" />
                          ) : publishMode === "draft" ? (
                            <Save className="h-3 w-3 mr-1" />
                          ) : (
                            <Calendar className="h-3 w-3 mr-1" />
                          )}
                          {publishSingle.isPending
                            ? "Publishing…"
                            : publishMode === "live"
                            ? "Publish live now"
                            : publishMode === "draft"
                            ? "Push as draft"
                            : "Schedule"
                          }
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Per-article publish action panel ───────────────────── */
                <div className="space-y-2 mt-1">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Article approved.
                    </span>
                    <button
                      type="button"
                      className="text-[10px] text-amber-500 hover:text-amber-400 underline transition-colors"
                      onClick={() => selectedItem?.id && updateStatus.mutate({ articleId: selectedItem.id, status: "pending_approval" })}
                      disabled={updateStatus.isPending}
                    >
                      {updateStatus.isPending ? "Reverting…" : "Unapprove"}
                    </button>
                  </div>

                  {/* Save Changes button — always visible for approved articles */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    onClick={handleSaveDraft}
                    disabled={updateSeoFields.isPending}
                  >
                    {updateSeoFields.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    Save Changes
                  </Button>

                  {/* Publish action button */}
                  {!publishPanelOpen ? (
                    <Button
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        setPublishPlatform(defaultPlatform);
                        setPublishMode("live");
                        setScheduleDate("");
                        setPublishPanelOpen(true);
                      }}
                    >
                      <Send className="h-3 w-3 mr-1.5" />
                      Publish this article →
                    </Button>
                  ) : (
                    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Publish Options</span>
                        <button
                          type="button"
                          onClick={() => setPublishPanelOpen(false)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >✕</button>
                      </div>

                      {/* Platform selector */}
                      {connectedPlatforms.length > 0 ? (
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Platform</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {connectedPlatforms.map(p => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setPublishPlatform(p)}
                                className={`text-xs px-2.5 py-1 rounded-md border font-medium capitalize transition-colors ${
                                  (publishPlatform ?? defaultPlatform) === p
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background border-border text-foreground hover:bg-muted"
                                }`}
                              >
                                {p === "wix" ? "Wix" : p === "wordpress" ? "WordPress" : "Zapier"}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-500 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3" />
                          No CMS connected. <a href="/integrations" className="underline">Go to Integrations</a>
                        </div>
                      )}

                      {/* Publish mode */}
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Action</Label>
                        <div className="flex gap-1.5">
                          {([
                            { mode: "live" as const, icon: Globe, label: "Publish live" },
                            { mode: "draft" as const, icon: Save, label: "Push as draft" },
                            { mode: "schedule" as const, icon: Calendar, label: "Schedule" },
                          ] as const).map(({ mode, icon: Icon, label }) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setPublishMode(mode)}
                              className={`flex-1 text-[11px] px-2 py-1.5 rounded-md border font-medium transition-colors flex flex-col items-center gap-0.5 ${
                                publishMode === mode
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              <Icon className="h-3 w-3" />
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Date/time picker for schedule mode */}
                      {publishMode === "schedule" && (
                        <div className="space-y-1">
                          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Publish date &amp; time</Label>
                          <Input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={e => setScheduleDate(e.target.value)}
                            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                            className="text-xs h-8"
                          />
                        </div>
                      )}

                      {/* Download option */}
                      <div className="pt-1 border-t border-border">
                        <a
                          href={`/api/articles/export-zip?businessId=${business?.id}&articleId=${selectedItem?.id}`}
                          download
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="h-3 w-3" />
                          Download article as ZIP
                        </a>
                      </div>

                      {/* Confirm button */}
                      <Button
                        size="sm"
                        className="w-full text-xs"
                        onClick={handlePublishSingle}
                        disabled={publishSingle.isPending || (publishMode === "schedule" && !scheduleDate) || connectedPlatforms.length === 0}
                      >
                        {publishSingle.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : publishMode === "live" ? (
                          <Globe className="h-3 w-3 mr-1" />
                        ) : publishMode === "draft" ? (
                          <Save className="h-3 w-3 mr-1" />
                        ) : (
                          <Calendar className="h-3 w-3 mr-1" />
                        )}
                        {publishSingle.isPending
                          ? "Publishing…"
                          : publishMode === "live"
                          ? "Publish live now"
                          : publishMode === "draft"
                          ? "Push as draft"
                          : "Schedule"
                        }
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Dual checkpoint badges */}
              {(() => {
                // Always use the DB-stored internalScore (same source as the sidebar card).
                // internalScore is 0-100; convert to a /16 display value.
                const dbScore = selectedItem.internalScore != null ? Math.round((selectedItem.internalScore / 100) * 16) : null;
                if (dbScore == null) return null;
                const liveScore = dbScore;

                // Failing checks: use stored pass1Details from the DB (handles both legacy boolean-map and new {points,metrics} format)
                const storedDetails = extractPass1Points((selectedItem as any).pass1Details);
                const storedMetrics = extractPass1Metrics((selectedItem as any).pass1Details);
                const failingKeys = storedDetails
                  ? (Object.keys(storedDetails) as string[]).filter(k => !storedDetails[k] && k !== "p13_schema")
                  : [];

                const cp1Color = liveScore >= 15
                  ? { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-500" }
                  : liveScore >= 13
                  ? { bg: "bg-blue-500/10 border-blue-500/30", text: "text-blue-400" }
                  : { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-500" };

                // Status label for the top of the Quality Checkpoints section
                const statusLabel = liveScore >= 16
                  ? { emoji: "✨", label: "Perfect Score — 16/16", sub: "All 16 SEO checks passed. Publish with confidence.", cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", sub_cls: "text-emerald-600" }
                  : liveScore >= 15
                  ? { emoji: "✅", label: "Authority Ready — 15/16", sub: "SEO optimised and ready to publish. Over-editing can reduce the human quality Google rewards.", cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", sub_cls: "text-emerald-600" }
                  : liveScore >= 14
                  ? { emoji: "✅", label: "Ready to Publish — 14/16", sub: "SEO optimised and ready to publish. Over-editing can reduce the human quality Google rewards.", cls: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", sub_cls: "text-emerald-600" }
                  : liveScore >= 13
                  ? { emoji: "⚡", label: `Strong — ${liveScore}/16`, sub: "Good SEO structure. A few optional improvements available.", cls: "bg-blue-500/10 border-blue-500/30 text-blue-400", sub_cls: "text-blue-500" }
                  : { emoji: "⚠️", label: `Needs Review — ${liveScore}/16`, sub: "Below the 13-point threshold. Review the items below before publishing.", cls: "bg-amber-500/10 border-amber-500/30 text-amber-500", sub_cls: "text-amber-600" };

                return (
                  <div className="space-y-2 mt-1">
                    {/* Status header — replaces the old ScoreBadgePanel at the top */}
                    <div className={`rounded-lg border p-3 ${statusLabel.cls.split(' ').slice(0,2).join(' ')}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{statusLabel.emoji}</span>
                        <div>
                          <div className={`text-sm font-bold ${statusLabel.cls.split(' ')[2]}`}>{statusLabel.label}</div>
                          <div className={`text-xs ${statusLabel.sub_cls}`}>{statusLabel.sub}</div>
                        </div>
                      </div>
                    </div>

                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quality Checkpoints</div>
                    <div className="flex gap-2">
                      {/* Checkpoint 1 — SEO Structure */}
                      <div className={`flex-1 rounded-lg border p-2 text-center ${cp1Color.bg}`}>
                        <div className={`text-base font-bold ${cp1Color.text}`}>{liveScore}/16</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">SEO Structure</div>
                        <div className="text-[9px] text-muted-foreground/70 mt-0.5">Checkpoint 1</div>
                      </div>
                      {/* Checkpoint 2 — Writing Quality (label only, no score number) */}
                      <div className={`flex-1 rounded-lg border p-2 text-center ${
                        (selectedItem as any).pass2Score == null
                          ? "bg-muted/30 border-border"
                          : (selectedItem as any).pass2Score >= 70
                          ? "bg-emerald-500/10 border-emerald-500/30"
                          : "bg-amber-500/10 border-amber-500/30"
                      }`}>
                        <div className={`text-[11px] font-semibold leading-tight ${
                          (selectedItem as any).pass2Score == null
                            ? "text-muted-foreground"
                            : (selectedItem as any).pass2Score >= 70
                            ? "text-emerald-500"
                            : "text-amber-500"
                        }`}>
                          {(selectedItem as any).pass2Score == null
                            ? "—"
                            : (selectedItem as any).pass2Score >= 70
                            ? "Excellent — ready to publish"
                            : "Improving quality..."}
                        </div>
                        {(selectedItem as any).pass2Score != null &&
                          (selectedItem as any).pass2Score < 70 &&
                          (selectedItem as any).pass2Details && (
                          <div className="text-[9px] text-muted-foreground/80 mt-1 leading-tight text-left px-0.5">
                            <span className="font-medium text-amber-500/80">Low score reason:</span>{" "}
                            {(selectedItem as any).pass2Details}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Writing Quality</div>
                        <div className="text-[9px] text-muted-foreground/70 mt-0.5">Checkpoint 2</div>
                      </div>
                    </div>

                    {/* Failing checklist breakdown — shown whenever score < 16 (even Authority Ready 15/16 shows the 1 missed point) */}
                    {liveScore < 16 && failingKeys.length > 0 && (
                      <div className={`rounded-lg border p-2.5 ${
                        liveScore >= 15
                          ? "bg-emerald-500/5 border-emerald-500/20"
                          : liveScore >= 13
                          ? "bg-blue-500/5 border-blue-500/20"
                          : "bg-amber-500/5 border-amber-500/20"
                      }`}>
                        <div className={`text-[10px] font-semibold mb-1.5 ${
                          liveScore >= 15 ? "text-emerald-600" : liveScore >= 13 ? "text-blue-400" : "text-amber-500"
                        }`}>
                          {liveScore >= 15 ? `Missed point${failingKeys.length > 1 ? 's' : ''} (optional to fix):` : liveScore >= 13 ? "Optional improvements:" : "Points to fix:"}
                        </div>
                        <div className="flex flex-col gap-1">
                          {failingKeys.map(k => (
                            <div key={k} className="flex items-start gap-1.5">
                              <span className={`mt-0.5 shrink-0 text-[10px] ${
                                liveScore >= 15 ? "text-emerald-600" : liveScore >= 13 ? "text-blue-400/70" : "text-amber-500"
                              }`}>{liveScore >= 13 ? "◦" : "✗"}</span>
                              <span className={`text-[10px] leading-tight ${
                                liveScore >= 15 ? "text-emerald-700" : liveScore >= 13 ? "text-muted-foreground" : "text-amber-600"
                              }`}>
                                {k === "p1_keyword_density"
                                  ? getKeywordDensityLabel(storedMetrics, selectedItem.level)
                                  : (PASS1_CHECK_LABELS[k as keyof Pass1Checks] ?? k)}
                              </span>
                            </div>
                          ))}
                          {/* Schema markup — always shown as last item: a point gained automatically on publish */}
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 shrink-0 text-[10px] text-emerald-500">✓</span>
                            <span className="text-[10px] leading-tight text-emerald-600">
                              Schema markup — added automatically on publish (+1 point)
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Copy to Clipboard Export Panel ─────────────────── */}
              {fullArticle && (
                <div className="mt-2 rounded-xl border border-border bg-card overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center gap-2">
                    <ClipboardCopy className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">Copy for Manual Publishing</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">Click any field to copy</span>
                  </div>
                  <div className="divide-y divide-border">
                    {([
                      { label: "URL Slug", value: (fullArticle as any).urlSlug ?? "" },
                      { label: "Meta Title", value: (fullArticle as any).metaTitle ?? "" },
                      { label: "Meta Description", value: (fullArticle as any).metaDescription ?? "" },
                      { label: "Focus Keyword", value: (fullArticle as any).focusKeyword ?? "" },
                      { label: "Image Alt Text", value: (fullArticle as any).imageAltText ?? "" },
                    ]).map(({ label, value }) => (
                      <CopyRow key={label} label={label} value={value} />
                    ))}
                    {(fullArticle as any).schemaMarkup && (
                      <CopyRow label="Schema JSON-LD" value={(fullArticle as any).schemaMarkup} mono />
                    )}
                    {(fullArticle as any).bodyMarkdown && (
                      <CopyRow label="Article Body (Markdown)" value={(fullArticle as any).bodyMarkdown} mono />
                    )}
                    {(fullArticle as any).bodyHtml && (
                      <CopyRow label="Article Body (HTML)" value={(fullArticle as any).bodyHtml} mono />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
      {/* ── All-articles-approved success modal ─────────────────────── */}
      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent
          className="max-w-md text-center"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="items-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            </div>
            <DialogTitle className="text-2xl font-bold">All articles approved!</DialogTitle>
            <DialogDescription className="text-base mt-2">
              Your {approvedModalCount} article{approvedModalCount === 1 ? " is" : "s are"} ready to schedule and publish.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-col gap-2 sm:flex-col">
            <Button
              className="w-full text-base py-6 font-bold"
              style={{ background: "#7c3aed", color: "#fff" }}
              onClick={() => {
                setShowApprovalModal(false);
                navigate("/publish");
              }}
            >
              Set up publishing schedule <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              className="w-full text-sm text-muted-foreground"
              onClick={() => setShowApprovalModal(false)}
            >
              Stay on this page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
