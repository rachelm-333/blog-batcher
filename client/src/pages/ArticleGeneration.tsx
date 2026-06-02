/**
 * Stage 4 — Article Generation Page
 *
 * Shows:
 *  1. "Start Generation" button (only if not yet started)
 *  2. Live progress bar (polls getGenerationStatus every 4s while generating)
 *  3. Article cards with status badges (authority_ready / strong / needs_review)
 *  4. Per-article retry button for failed articles
 *  5. "Proceed to Review" gate — enabled only when all articles are generated
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { HelpLink } from "@/components/HelpLink";

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

interface ArticleRow {
  articleId: number | null;
  nodeId: number;
  status: ArticleStatus;
  statusBadge: StatusBadge;
  title: string | null;
  wordCount: number | null;
  internalScore: number | null;
  errorMessage: string | null;
  level: "cornerstone" | "pillar" | "cluster";
  articleType: string;
  urlSlug: string | null;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function StatusBadgeChip({ badge }: { badge: StatusBadge }) {
  if (!badge) return null;
  if (badge === "authority_ready") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
        <Trophy className="h-3 w-3" />
        Authority Ready
      </span>
    );
  }
  if (badge === "strong") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
        <Star className="h-3 w-3" />
        Strong
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <AlertCircle className="h-3 w-3" />
      Needs Review
    </span>
  );
}

function ArticleStatusChip({ status }: { status: ArticleStatus }) {
  if (status === "generating") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <AlertCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  if (status === "pending_generation") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
        <FileText className="h-3 w-3" />
        Queued
      </span>
    );
  }
  if (status === "generated" || status === "pending_approval" || status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Generated
      </span>
    );
  }
  return null;
}

function LevelBadge({ level }: { level: "cornerstone" | "pillar" | "cluster" }) {
  if (level === "cornerstone") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
        <Zap className="h-3 w-3" />
        Cornerstone
      </span>
    );
  }
  if (level === "pillar") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
        Pillar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
      Cluster
    </span>
  );
}

// ---------------------------------------------------------------------------
// Article card
// ---------------------------------------------------------------------------

function ArticleCard({
  article,
  onRetry,
  retrying,
}: {
  article: ArticleRow;
  onRetry: (articleId: number) => void;
  retrying: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const isGenerating = article.status === "generating";
  const isFailed = article.status === "failed";
  const isDone =
    article.status === "generated" ||
    article.status === "pending_approval" ||
    article.status === "approved";

  return (
    <div
      className={`rounded-xl border transition-all ${
        isGenerating
          ? "border-violet-200 bg-violet-50/30"
          : isFailed
          ? "border-red-200 bg-red-50/30"
          : isDone
          ? "border-slate-200 bg-white"
          : "border-slate-200 bg-slate-50/50 opacity-70"
      }`}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => isDone && setExpanded(e => !e)}
      >
        {/* Level indicator */}
        <div
          className={`shrink-0 w-1 self-stretch rounded-full ${
            article.level === "cornerstone"
              ? "bg-purple-400"
              : article.level === "pillar"
              ? "bg-indigo-400"
              : "bg-slate-300"
          }`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <LevelBadge level={article.level} />
            <ArticleStatusChip status={article.status} />
            {isDone && article.statusBadge && (
              <StatusBadgeChip badge={article.statusBadge} />
            )}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-800 truncate">
            {article.title ?? (
              <span className="text-slate-400 italic">
                {isGenerating ? "Writing article…" : "Waiting…"}
              </span>
            )}
          </div>
          {isDone && (
            <div className="text-xs text-slate-400 mt-0.5">
              {article.wordCount ? `${article.wordCount.toLocaleString()} words` : ""}
              {article.urlSlug ? ` · /${article.urlSlug}` : ""}
            </div>
          )}
          {isFailed && article.errorMessage && (
            <div className="text-xs text-red-600 mt-0.5 truncate">{article.errorMessage}</div>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {isFailed && article.articleId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={retrying}
              onClick={e => {
                e.stopPropagation();
                onRetry(article.articleId!);
              }}
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry
            </Button>
          )}
          {isDone && (
            <span className="text-slate-300">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && isDone && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-100 mt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs">
            <div>
              <div className="text-slate-400 mb-0.5">Article Type</div>
              <div className="font-medium text-slate-700 capitalize">
                {article.articleType.replace(/_/g, " ")}
              </div>
            </div>
            {article.wordCount && (
              <div>
                <div className="text-slate-400 mb-0.5">Word Count</div>
                <div className="font-medium text-slate-700">
                  {article.wordCount.toLocaleString()}
                </div>
              </div>
            )}
            {article.internalScore !== null && article.internalScore !== undefined && (
              <div>
                <div className="text-slate-400 mb-0.5">Quality Score</div>
                <div className="font-medium text-slate-700">{article.internalScore}/100</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ArticleGeneration() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  // Auth check
  const { data: user, isLoading: userLoading } = trpc.auth.me.useQuery();
  const { data: business, isLoading: bizLoading } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });

  // Polling state
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  // Generation status (polled)
  const { data: genStatus, refetch: refetchStatus } = trpc.articles.getGenerationStatus.useQuery(
    { businessId: business?.id ?? 0 },
    {
      enabled: !!business?.id && hasStarted,
      refetchInterval: isPolling ? 4000 : false,
    }
  );

  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState<"trial_complete" | "no_credits" | "trial_blocked">("no_credits");

  // Start generation mutation
  const startGen = trpc.articles.startGeneration.useMutation({
    onSuccess: (data) => {
      setHasStarted(true);
      setIsPolling(true);
      toast.success(`Generation started — ${data.totalArticles} articles queued`);
    },
    onError: (err) => {
      if (err.message === "FREE_TRIAL_USED") {
        setUpgradeReason("trial_blocked");
        setShowUpgrade(true);
      } else if (err.message === "INSUFFICIENT_CREDITS") {
        setUpgradeReason("no_credits");
        setShowUpgrade(true);
      } else {
        toast.error("Could not start generation", {
          description: `${err.message}. Make sure your business profile and keyword research are complete before generating articles.`,
          duration: 8000,
        });
      }
    },
  });

  // Regenerate mutation
  const regenerate = trpc.articles.regenerate.useMutation({
    onSuccess: () => {
      setRetryingId(null);
      setIsPolling(true);
      toast.success("Article queued for regeneration");
      refetchStatus();
    },
    onError: (err) => {
      setRetryingId(null);
      toast.error("Regeneration failed", {
        description: `${err.message}. If this keeps happening, try refreshing the page or contact support.`,
        duration: 8000,
      });
    },
  });

  // Stop polling when complete
  useEffect(() => {
    if (genStatus?.isComplete) {
      setIsPolling(false);
    }
  }, [genStatus?.isComplete]);

  // Auth guard
  useEffect(() => {
    if (!userLoading && !user) navigate("/login");
  }, [user, userLoading, navigate]);

  // Redirect if no business
  useEffect(() => {
    if (!userLoading && !bizLoading && user && !business) navigate("/onboarding");
  }, [user, business, userLoading, bizLoading, navigate]);

  // Stage guard — must have completed Stage 3 (currentStage >= 4)
  useEffect(() => {
    if (!bizLoading && business && (business.currentStage ?? 1) < 4) {
      navigate("/keywords");
    }
  }, [business, bizLoading, navigate]);

  // Check if generation was already in progress on mount
  useEffect(() => {
    if (business?.id && !hasStarted) {
      refetchStatus().then(result => {
        if (result.data && result.data.total > 0) {
          setHasStarted(true);
          if (!result.data.isComplete) {
            setIsPolling(true);
          }
        }
      });
    }
  }, [business?.id]);

  if (userLoading || bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !business) return null;

  const articles = genStatus?.articles ?? [];
  const total = genStatus?.total ?? 0;
  const completed = genStatus?.completed ?? 0;
  const failed = genStatus?.failed ?? 0;
  const isGenerating = (genStatus?.generating ?? 0) > 0;
  const isComplete = genStatus?.isComplete ?? false;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const allDone = isComplete && failed === 0;
  const canProceed = isComplete && completed > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            ← Dashboard
          </button>
          <span className="text-slate-300">|</span>
          <span className="text-xl font-bold text-slate-900 tracking-tight">
            Blog <span className="text-blue-600">Batcher</span>
          </span>
        </div>
        <div className="text-sm text-slate-500">
          Stage 4: Article Generation
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Article Generation</h1>
          <p className="text-slate-500 text-sm mt-1">
            Articles are written one at a time in order: Cornerstones first, then Pillars, then Clusters.
            Each article goes through a 16-point Authority Standard check and an AI fingerprint scrub.
          </p>
        </div>

        {/* Start generation card */}
        {!hasStarted && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-8 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="h-8 w-8 text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Ready to Generate</h2>
            <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
              Your keywords and PAA questions are approved. Click below to start writing your articles.
              Generation runs in the background — you can leave this page and come back.
            </p>
            <Button
              size="lg"
              onClick={() => startGen.mutate({ businessId: business.id })}
              disabled={startGen.isPending || (business.currentStage ?? 1) < 4}
              className="gap-2"
            >
              {startGen.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Start Article Generation
                </>
              )}
            </Button>
          </div>
        )}

        {/* Progress bar */}
        {hasStarted && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-slate-700">
                {isGenerating ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                    Writing articles…
                  </span>
                ) : isComplete ? (
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {allDone ? "All articles generated" : `${completed} of ${total} articles generated`}
                  </span>
                ) : (
                  "Queued"
                )}
              </div>
              <div className="text-sm text-slate-500">
                {completed}/{total}
                {failed > 0 && (
                  <span className="ml-2 text-red-500">{failed} failed</span>
                )}
              </div>
            </div>
            <Progress value={progressPct} className="h-2" />
            {/* Current article being written */}
            {isGenerating && (() => {
              const currentArticle = articles.find(a => a.status === "generating");
              return currentArticle?.title ? (
                <div className="mt-2 text-xs text-slate-500">
                  Now writing: <span className="font-medium">{currentArticle.title}</span>
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-400">Each article takes 30–90 seconds. This page auto-updates.</div>
              );
            })()}
            {!isGenerating && (
              <div className="mt-2 text-xs text-slate-400">
                {isComplete ? "Generation complete." : "Waiting to start…"}
              </div>
            )}
          </div>
        )}

        {/* Article list */}
        {articles.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
              Articles ({articles.length})
            </h2>
            {articles.map((article) => (
              <ArticleCard
                key={article.nodeId}
                article={article as ArticleRow}
                onRetry={(articleId) => {
                  setRetryingId(articleId);
                  regenerate.mutate({ articleId });
                }}
                retrying={retryingId === article.articleId}
              />
            ))}
          </div>
        )}

        {/* Proceed to Review gate */}
        {canProceed && (
          <div className="space-y-3">
            {/* Failed articles warning */}
            {failed > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <div className="text-sm font-medium text-red-700">
                  {failed} article{failed !== 1 ? "s" : ""} failed to generate
                </div>
                <div className="text-xs text-red-600 mt-0.5">
                  Retry the failed articles above before proceeding, or click "Proceed anyway" to continue with the {completed} completed article{completed !== 1 ? "s" : ""}.
                </div>
                <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <HelpLink slug="article-generation-failed" label="Why did my articles fail to generate?" />
                </div>
              </div>
            )}
            <div
              className={`rounded-2xl border p-6 flex items-center justify-between ${
                allDone
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <div>
                <div className="font-semibold text-slate-900 text-sm">
                  {allDone
                    ? "All articles are ready for review"
                    : `${completed} article${completed !== 1 ? "s" : ""} ready — ${failed} failed`}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {allDone
                    ? "Proceed to Stage 5 to review, edit, and approve your articles."
                    : "Retry failed articles first, or proceed with completed articles only."}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Button
                  onClick={() => toast.info("Coming soon", { description: "Stage 5: Review & Publish is not yet available." })}
                  disabled={completed === 0}
                  className="gap-2"
                >
                  {allDone ? "Proceed to Review" : "Proceed anyway"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Upgrade prompt — shown when trial is used or credits are insufficient */}
      <UpgradePrompt
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        reason={upgradeReason}
      />
    </div>
  );
}
