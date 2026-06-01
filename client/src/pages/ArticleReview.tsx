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
  FileText,
  ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  Star,
  Trophy,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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
  if (status === "approved" || status === "scheduled" || status === "published") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  }
  if (!badge) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
        ⏳ Pending Review
      </span>
    );
  }
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
        <Zap className="h-3 w-3" />
        Strong
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      Needs Review
    </span>
  );
}

function LevelLabel({ level }: { level: "cornerstone" | "pillar" | "cluster" }) {
  if (level === "cornerstone") {
    return (
      <span className="text-xs font-bold uppercase tracking-wide text-purple-600">
        Cornerstone
      </span>
    );
  }
  if (level === "pillar") {
    return (
      <span className="text-xs font-bold uppercase tracking-wide text-blue-500">
        Pillar
      </span>
    );
  }
  return (
    <span className="text-xs font-bold uppercase tracking-wide text-gray-400">
      Cluster
    </span>
  );
}

function ScoreBadgePanel({ badge }: { badge: StatusBadge }) {
  if (badge === "authority_ready") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <div className="text-2xl">✅</div>
        <div>
          <div className="text-sm font-bold text-emerald-800">Authority Ready</div>
          <div className="text-xs text-emerald-600">All 16 points met. Publish with confidence.</div>
        </div>
      </div>
    );
  }
  if (badge === "strong") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
        <div className="text-2xl">⚡</div>
        <div>
          <div className="text-sm font-bold text-blue-800">Strong</div>
          <div className="text-xs text-blue-600">14–15 points met. Good to publish.</div>
        </div>
      </div>
    );
  }
  if (badge === "needs_review") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
        <div className="text-2xl">⚠️</div>
        <div>
          <div className="text-sm font-bold text-amber-800">Needs Review</div>
          <div className="text-xs text-amber-600">Below 14 points. Review SEO fields before publishing.</div>
        </div>
      </div>
    );
  }
  return null;
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
    selectedItem?.status === "published";
  const canRegenerate = !!selectedItem?.id && !isApproved;

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

  return (
    <div className="flex h-screen bg-background overflow-hidden">
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
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                Over-editing keyword placement can reduce your ranking potential. We recommend publishing as-is.
              </div>

              {/* URL Slug */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-foreground">URL Slug</Label>
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
                <Label className="text-xs font-semibold text-foreground">Meta Title</Label>
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
                <Label className="text-xs font-semibold text-foreground">Meta Description</Label>
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
                <Label className="text-xs font-semibold text-foreground">Focus Keyword</Label>
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
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
