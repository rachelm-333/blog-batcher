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

import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Code2,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  Star,
  Trophy,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

interface ArticleListItem {
  // articles.getAll returns id (article DB id) and articleNodeId (node id)
  id: number;
  articleNodeId: number;
  status: ArticleStatus;
  statusBadge: StatusBadge;
  title: string | null;
  wordCount: number | null;
  internalScore: number | null;
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

function ScoreBadgePanel({ badge }: { badge: StatusBadge }) {
  if (badge === "authority_ready") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <div className="text-2xl">✅</div>
        <div>
          <div className="text-sm font-bold text-emerald-400">Authority Ready</div>
          <div className="text-xs text-emerald-500">All 16 points met. Publish with confidence.</div>
        </div>
      </div>
    );
  }
  if (badge === "strong") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/30">
        <div className="text-2xl">⚡</div>
        <div>
          <div className="text-sm font-bold text-primary">Strong</div>
          <div className="text-xs text-primary">14–15 points met. Good to publish.</div>
        </div>
      </div>
    );
  }
  if (badge === "needs_review") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <div className="text-2xl">⚠️</div>
        <div>
          <div className="text-sm font-bold text-amber-400">Needs Review</div>
          <div className="text-xs text-amber-500">Below 14 points. Review SEO fields before publishing.</div>
        </div>
      </div>
    );
  }
  return null;
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
  const { data: businessData, isLoading: bizLoading } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });
  // business.get returns the flat business row (not nested under .business)
  const business = businessData ?? null;

  const { data: articlesData, isLoading: articlesLoading, refetch: refetchArticles } = trpc.articles.getAll.useQuery(
    { businessId: business?.id ?? 0 },
    { enabled: !!business?.id }
  );

  // Selected article
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  const articleList: ArticleListItem[] = useMemo(() => articlesData ?? [], [articlesData]);

  // Auto-select first article
  useEffect(() => {
    if (articleList.length > 0 && selectedNodeId === null) {
      setSelectedNodeId(articleList[0].articleNodeId);
    }
  }, [articleList, selectedNodeId]);

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
        imageUrl: "",
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

  const approve = trpc.articles.approve.useMutation({
    onSuccess: (data) => {
      if (data.alreadyApproved) {
        toast.info("Article already approved.");
      } else {
        toast.success("Article approved!");
      }
      refetchArticles();
      refetchFull();
    },
    onError: (err) => toast.error(err.message),
  });

  const approveAll = trpc.articles.approveAll.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.approvedCount} articles approved.`);
      refetchArticles();
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

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveImage = trpc.articles.saveImage.useMutation({
    onSuccess: (data) => {
      toast.success("Image saved.");
      setSeoEdits(prev => ({ ...prev, imageUrl: data.imageUrl }));
    },
    onError: (err) => toast.error(err.message),
  });

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedItem?.id) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      saveImage.mutate({
        articleId: selectedItem.id,
        imageBase64: base64,
        mimeType: file.type,
        filename: file.name,
      });
    };
    reader.readAsDataURL(file);
  }

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

  // Derived state
  const approvedCount = articleList.filter(
    a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
  ).length;
  // Stage guard: need stage >= 4 (articles generated)
  const totalCount = articleList.length;
  const allApproved = approvedCount === totalCount && totalCount > 0;

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

  const isApproved =
    selectedItem?.status === "approved" ||
    selectedItem?.status === "scheduled" ||
    selectedItem?.status === "published" ||
    selectedItem?.status === "failed";
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
    });
    if (seoEdits.imageUrl) {
      saveImage.mutate({ articleId: selectedItem.id!, imageUrl: seoEdits.imageUrl });
    }
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
      <StageStepper currentStage={currentStage} />
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* ── Left sidebar: article list ─────────────────────────────────── */}
      <div className="w-72 min-w-[280px] border-r border-border flex flex-col bg-card overflow-y-auto">
        {/* Header */}
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

        {/* Approve all button */}
        {!allApproved && totalCount > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <Button
              size="sm"
              variant="outline"
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
          ) : (
            articleList.map((item) => {
              const isSelected = item.articleNodeId === selectedNodeId;
              return (
                <button
                  key={item.articleNodeId}
                    onClick={() => setSelectedNodeId(item.articleNodeId)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? "bg-primary/10 border-primary"
                      : "bg-background border-border hover:bg-muted/50"
                  }`}
                >
                  <LevelLabel level={item.level} />
                  <div className="text-xs font-medium text-foreground mt-1 line-clamp-2">
                    {item.title ?? item.urlSlug ?? `Article ${item.articleNodeId}`}
                  </div>
                  <div className="mt-1.5">
                    <StatusBadgeChip badge={item.statusBadge as StatusBadge} status={item.status as ArticleStatus} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Proceed to Publish */}
        <div className="p-4 border-t border-border">
          <Button
            className="w-full"
            disabled={!allApproved}
            onClick={() => navigate("/publish")}
          >
            {allApproved ? (
              <>
                Proceed to Publish <ArrowRight className="ml-2 h-4 w-4" />
              </>
            ) : (
              `Approve all ${totalCount} articles to proceed`
            )}
          </Button>
        </div>
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
                    disabled={regenerate.isPending}
                  >
                    {regenerate.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    Regenerate
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
                    <div className="flex items-center gap-2 mb-4">
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
                        dangerouslySetInnerHTML={{ __html: fullArticle.bodyHtml ?? "" }}
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
              {/* Score badge */}
              <ScoreBadgePanel badge={selectedItem.statusBadge as StatusBadge} />

              {/* Over-editing warning */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                Over-editing keyword placement can reduce your ranking potential. We recommend publishing as-is.
              </div>

              {/* URL Slug */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold text-foreground">URL Slug</Label>
                  <HelpLink slug="url-slug-best-practices" label="How to write a good URL slug" />
                </div>
                <Input
                  value={seoEdits.urlSlug}
                  onChange={e => setSeoEdits(prev => ({ ...prev, urlSlug: e.target.value }))}
                  placeholder="url-slug-here"
                  className="text-xs font-mono"
                  disabled={isApproved}
                />
              </div>

              {/* Meta Title */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold text-foreground">Meta Title</Label>
                  <HelpLink slug="meta-title-description" label="Meta title best practices" />
                </div>
                <Input
                  value={seoEdits.metaTitle}
                  onChange={e => setSeoEdits(prev => ({ ...prev, metaTitle: e.target.value }))}
                  placeholder="Meta title (max 60 chars)"
                  className="text-xs"
                  disabled={isApproved}
                />
                <div className={`text-xs text-right ${metaTitleLen > 60 ? "text-destructive" : "text-muted-foreground"}`}>
                  {metaTitleLen} / 60 chars {metaTitleLen <= 60 ? "✓" : "✗"}
                </div>
              </div>

              {/* Meta Description */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold text-foreground">Meta Description</Label>
                  <HelpLink slug="meta-title-description" label="Meta description best practices" />
                </div>
                <Textarea
                  value={seoEdits.metaDescription}
                  onChange={e => setSeoEdits(prev => ({ ...prev, metaDescription: e.target.value }))}
                  placeholder="Meta description (140–160 chars)"
                  className="text-xs min-h-[70px] resize-none"
                  disabled={isApproved}
                />
                <div className={`text-xs text-right ${metaDescLen < 140 || metaDescLen > 160 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {metaDescLen} / 160 chars {metaDescLen >= 140 && metaDescLen <= 160 ? "✓" : "⚠"}
                </div>
              </div>

              {/* Focus Keyword */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-semibold text-foreground">Focus Keyword</Label>
                  <HelpLink slug="focus-keyword" label="What is a focus keyword?" />
                </div>
                <Input
                  value={seoEdits.focusKeyword}
                  onChange={e => setSeoEdits(prev => ({ ...prev, focusKeyword: e.target.value }))}
                  placeholder="focus keyword phrase"
                  className="text-xs"
                  disabled={isApproved}
                />
              </div>

              {/* Image */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">Image (optional)</Label>
                <Input
                  value={seoEdits.imageUrl}
                  onChange={e => setSeoEdits(prev => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="Paste image URL or upload below"
                  className="text-xs"
                  disabled={isApproved}
                />
                {!isApproved && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs mt-1"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={saveImage.isPending}
                    >
                      {saveImage.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Upload className="h-3 w-3 mr-1" />
                      )}
                      Upload Image
                    </Button>
                  </>
                )}
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
                    ) : (
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                    )}
                    Approve &amp; Publish →
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
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Article approved. Proceed to Publish &amp; Schedule when all articles are ready.
                </div>
              )}

              {/* Internal score */}
              {selectedItem.internalScore != null && (
                <div className="text-xs text-muted-foreground text-center">
                  Internal score: {selectedItem.internalScore}/100
                </div>
              )}

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
    </DashboardLayout>
  );
}
