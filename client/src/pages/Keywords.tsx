/**
 * Layer 5 — Stage 3: SEO Keyword Research
 *
 * Three sub-stages:
 *   1. Assign — trigger auto-assignment via DataForSEO + Claude
 *   2. Keyword Review — review/swap/approve each keyword row
 *   3. PAA Review — approve one PAA question per article
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KwRow = {
  id: number;
  articleNodeId: number;
  primaryKeyword: string;
  monthlySearchVolume: number | null;
  competitionLevel: string | null;
  paaQuestions: unknown;
  approvedPaaQuestion: string | null;
  keywordApproved: boolean;
  paaApproved: boolean;
  cannibalizationWarning: boolean;
  nodeLevel: string;
  nodeArticleType: string;
  nodeSortOrder: number;
  nodeParentCornerstoneId: number | null;
  nodeParentPillarId: number | null;
};

type SubStage = "assign" | "keyword-review" | "paa-review" | "complete";

/**
 * Derive a human-readable node label from hierarchy fields.
 * Uses the same naming convention as the architecture rules engine:
 *   Cornerstone N, Pillar N.P, Cluster N.P.C
 */
function deriveNodeLabel(rows: KwRow[], row: KwRow): string {
  if (row.nodeLevel === "cornerstone") {
    const cornerstones = rows
      .filter((r) => r.nodeLevel === "cornerstone")
      .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
    const idx = cornerstones.findIndex((r) => r.articleNodeId === row.articleNodeId);
    return `Cornerstone ${idx + 1}`;
  }
  if (row.nodeLevel === "pillar") {
    const cornerstones = rows
      .filter((r) => r.nodeLevel === "cornerstone")
      .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
    const cIdx = cornerstones.findIndex((r) => r.articleNodeId === row.nodeParentCornerstoneId);
    const pillarsUnderCornerstone = rows
      .filter((r) => r.nodeLevel === "pillar" && r.nodeParentCornerstoneId === row.nodeParentCornerstoneId)
      .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
    const pIdx = pillarsUnderCornerstone.findIndex((r) => r.articleNodeId === row.articleNodeId);
    return `Pillar ${cIdx + 1}.${pIdx + 1}`;
  }
  // cluster
  const cornerstones = rows
    .filter((r) => r.nodeLevel === "cornerstone")
    .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
  const cIdx = cornerstones.findIndex((r) => r.articleNodeId === row.nodeParentCornerstoneId);
  const pillarsUnderCornerstone = rows
    .filter((r) => r.nodeLevel === "pillar" && r.nodeParentCornerstoneId === row.nodeParentCornerstoneId)
    .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
  const pIdx = pillarsUnderCornerstone.findIndex((r) => r.articleNodeId === row.nodeParentPillarId);
  const clustersUnderPillar = rows
    .filter((r) => r.nodeLevel === "cluster" && r.nodeParentPillarId === row.nodeParentPillarId)
    .sort((a, b) => a.nodeSortOrder - b.nodeSortOrder);
  const clIdx = clustersUnderPillar.findIndex((r) => r.articleNodeId === row.articleNodeId);
  return `Cluster ${cIdx + 1}.${pIdx + 1}.${clIdx + 1}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelBadge(level: string) {
  if (level === "cornerstone")
    return <Badge className="bg-purple-100 text-purple-700 border-purple-200">Cornerstone</Badge>;
  if (level === "pillar")
    return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Pillar</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Cluster</Badge>;
}

function msvLabel(msv: number | null) {
  if (msv === null) return <span className="text-slate-400">—</span>;
  if (msv >= 10000) return <span className="text-emerald-600 font-medium">{msv.toLocaleString()}</span>;
  if (msv >= 1000) return <span className="text-blue-600 font-medium">{msv.toLocaleString()}</span>;
  return <span className="text-slate-600">{msv.toLocaleString()}</span>;
}

function compBadge(comp: string | null) {
  if (!comp) return <span className="text-slate-400">—</span>;
  if (comp === "high") return <Badge className="bg-red-100 text-red-700 border-red-200">High</Badge>;
  if (comp === "medium") return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Medium</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Low</Badge>;
}

function articleTypeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Swap Modal
// ---------------------------------------------------------------------------

function SwapModal({
  open,
  onClose,
  businessId,
  kwRow,
  onSwapped,
}: {
  open: boolean;
  onClose: () => void;
  businessId: number;
  kwRow: KwRow | null;
  onSwapped: () => void;
}) {
  const [manualKw, setManualKw] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);

  const suggestions = trpc.keywords.getSuggestions.useQuery(
    { businessId, keyword: kwRow?.primaryKeyword ?? "" },
    { enabled: open && !!kwRow }
  );

  const swapMutation = trpc.keywords.swap.useMutation({
    onSuccess: () => {
      toast.success("Keyword swapped successfully");
      onSwapped();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSwap = () => {
    if (!kwRow) return;
    const kw = selectedSuggestion ?? manualKw.trim();
    if (!kw) {
      toast.error("Please select a suggestion or enter a keyword");
      return;
    }
    swapMutation.mutate({ businessId, keywordId: kwRow.id, newKeyword: kw });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Swap Keyword</DialogTitle>
          <DialogDescription>
            Replace <strong>{kwRow?.primaryKeyword}</strong> with a different keyword.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {suggestions.isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching suggestions…
            </div>
          )}

          {!suggestions.isLoading && (suggestions.data?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">DataForSEO Suggestions</p>
              <div className="space-y-2">
                {suggestions.data?.map((s) => (
                  <button
                    key={s.keyword}
                    onClick={() => {
                      setSelectedSuggestion(s.keyword);
                      setManualKw("");
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      selectedSuggestion === s.keyword
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <span className="font-medium text-slate-900">{s.keyword}</span>
                    <span className="ml-2 text-slate-400 text-xs">
                      {s.msv !== null ? `${s.msv.toLocaleString()} MSV` : "MSV n/a"}
                      {s.competition ? ` · ${s.competition} comp` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-slate-700 mb-1">Or enter manually</p>
            <Input
              placeholder="Type a custom keyword…"
              value={manualKw}
              onChange={(e) => {
                setManualKw(e.target.value);
                setSelectedSuggestion(null);
              }}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSwap} disabled={swapMutation.isPending}>
              {swapMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Swapping…</>
              ) : (
                "Confirm Swap"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Keywords() {
  const [, navigate] = useLocation();
  const [subStage, setSubStage] = useState<SubStage>("assign");
  const [swapTarget, setSwapTarget] = useState<KwRow | null>(null);

  const { data: user, isLoading: userLoading } = trpc.auth.me.useQuery();
  const { data: business, isLoading: bizLoading } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });

  const businessId = business?.id ?? 0;

  const {
    data: kwData,
    isLoading: kwLoading,
    refetch: refetchKw,
  } = trpc.keywords.getAll.useQuery(
    { businessId },
    { enabled: !!businessId }
  );

  // Auth guard
  useEffect(() => {
    if (!userLoading && !user) navigate("/login");
  }, [user, userLoading, navigate]);

  // Stage guard — must have completed Stage 2
  useEffect(() => {
    if (!bizLoading && business && (business.currentStage ?? 1) < 3) {
      navigate("/architecture");
    }
  }, [business, bizLoading, navigate]);

  // Determine sub-stage from existing data
  useEffect(() => {
    if (!kwData) return;
    if (kwData.length === 0) {
      setSubStage("assign");
      return;
    }
    const allKwApproved = kwData.every((k) => k.keywordApproved);
    const allPaaApproved = kwData.every((k) => k.paaApproved);
    if (allPaaApproved) {
      setSubStage("complete");
    } else if (allKwApproved) {
      setSubStage("paa-review");
    } else {
      setSubStage("keyword-review");
    }
  }, [kwData]);

  // Mutations
  const assignAll = trpc.keywords.assignAll.useMutation({
    onSuccess: async (data) => {
      toast.success(`${data.assigned} keywords assigned`);
      await refetchKw();
      setSubStage("keyword-review");
    },
    onError: (err) => toast.error(err.message),
  });

  const approveOne = trpc.keywords.approveOne.useMutation({
    onSuccess: async () => {
      await refetchKw();
    },
    onError: (err) => toast.error(err.message),
  });

  const approveAll = trpc.keywords.approveAll.useMutation({
    onSuccess: async (data) => {
      toast.success(`${data.approved} keywords approved`);
      await refetchKw();
      setSubStage("paa-review");
    },
    onError: (err) => toast.error(err.message),
  });

  const fetchPAA = trpc.keywords.fetchPAA.useMutation({
    onSuccess: async (data) => {
      toast.success(`PAA questions fetched for ${data.fetched} keywords`);
      await refetchKw();
    },
    onError: (err) => toast.error(err.message),
  });

  const approvePAA = trpc.keywords.approvePAA.useMutation({
    onSuccess: async (data) => {
      await refetchKw();
      if (data.stageAdvanced) {
        toast.success("All PAA approved! Moving to Article Generation.");
        setSubStage("complete");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Derived state
  const cannibalizationConflicts = useMemo(() => {
    if (!kwData) return [];
    return kwData.filter((k) => k.cannibalizationWarning);
  }, [kwData]);

  /**
   * Build explicit conflict pairs for the warning banner.
   * Reconstructed client-side from flagged rows so the banner can show
   * "Cornerstone 1 vs Pillar 2.1" with exact-duplicate / semantic-overlap labels.
   */
  const conflictPairs = useMemo(() => {
    if (!kwData || cannibalizationConflicts.length === 0) return [];
    const flagged = cannibalizationConflicts;
    const pairs: Array<{ labelA: string; kwA: string; labelB: string; kwB: string; type: string }> = [];
    for (let i = 0; i < flagged.length; i++) {
      for (let j = i + 1; j < flagged.length; j++) {
        const a = flagged[i]!;
        const b = flagged[j]!;
        const normA = a.primaryKeyword.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        const normB = b.primaryKeyword.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        const type = normA === normB ? "Exact duplicate" : "Semantic overlap";
        pairs.push({
          labelA: deriveNodeLabel(kwData, a),
          kwA: a.primaryKeyword,
          labelB: deriveNodeLabel(kwData, b),
          kwB: b.primaryKeyword,
          type,
        });
      }
    }
    return pairs;
  }, [kwData, cannibalizationConflicts]);

  const allKwApproved = useMemo(
    () => (kwData?.length ?? 0) > 0 && kwData!.every((k) => k.keywordApproved),
    [kwData]
  );

  const allPaaFetched = useMemo(
    () =>
      (kwData?.length ?? 0) > 0 &&
      kwData!.every((k) => {
        const q = k.paaQuestions as string[] | null;
        return q && q.length > 0;
      }),
    [kwData]
  );

  const allPaaApproved = useMemo(
    () => (kwData?.length ?? 0) > 0 && kwData!.every((k) => k.paaApproved),
    [kwData]
  );

  if (userLoading || bizLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !business) return null;

  // ---------------------------------------------------------------------------
  // Sub-stage: Assign
  // ---------------------------------------------------------------------------
  const renderAssign = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-500" />
          Auto-Assign Keywords
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Blog Batcher will assign one primary keyword to every article slot in your architecture
          using DataForSEO data and your brand voice brief. You can swap any keyword in the next
          step.
        </p>
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-1">
          <div><span className="font-medium">Business:</span> {business.name}</div>
          <div><span className="font-medium">Location:</span> {business.location ?? "—"}</div>
          <div><span className="font-medium">Industry:</span> {business.industry ?? "—"}</div>
        </div>
        <Button
          onClick={() => assignAll.mutate({ businessId })}
          disabled={assignAll.isPending}
          className="w-full"
        >
          {assignAll.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Assigning keywords…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Assign Keywords</>
          )}
        </Button>
      </CardContent>
    </Card>
  );

  // ---------------------------------------------------------------------------
  // Sub-stage: Keyword Review
  // ---------------------------------------------------------------------------
  const renderKeywordReview = () => (
    <div className="space-y-4">
      {cannibalizationConflicts.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <div className="flex items-start gap-3 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="font-semibold">
              {cannibalizationConflicts.length} keyword conflict
              {cannibalizationConflicts.length !== 1 ? "s" : ""} detected — swap before approving all
            </p>
          </div>
          {conflictPairs.length > 0 && (
            <ul className="ml-8 space-y-1.5">
              {conflictPairs.map((pair, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${
                    pair.type === "Exact duplicate"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}>
                    {pair.type}
                  </span>
                  <span>
                    <strong>{pair.labelA}</strong> &ldquo;{pair.kwA}&rdquo; conflicts with{" "}
                    <strong>{pair.labelB}</strong> &ldquo;{pair.kwB}&rdquo;
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Keyword Review</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => assignAll.mutate({ businessId })}
                disabled={assignAll.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Re-assign All
              </Button>
              <Button
                size="sm"
                onClick={() => approveAll.mutate({ businessId })}
                disabled={approveAll.isPending || cannibalizationConflicts.length > 0}
              >
                {approveAll.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Approve All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Level</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Node</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Primary Keyword</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">MSV</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Competition</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {kwLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : (
                  kwData?.map((kw) => (
                    <tr
                      key={kw.id}
                      className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${
                        kw.cannibalizationWarning ? "bg-amber-50/50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">{levelBadge(kw.nodeLevel)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {kwData ? deriveNodeLabel(kwData, kw) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {articleTypeLabel(kw.nodeArticleType)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {kw.cannibalizationWarning && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          )}
                          <span className="font-medium text-slate-900">{kw.primaryKeyword}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{msvLabel(kw.monthlySearchVolume)}</td>
                      <td className="px-4 py-3">{compBadge(kw.competitionLevel)}</td>
                      <td className="px-4 py-3">
                        {kw.keywordApproved ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Approved
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 border-slate-200">Pending</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setSwapTarget(kw)}
                          >
                            Swap
                          </Button>
                          {!kw.keywordApproved && (
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                approveOne.mutate({ businessId, keywordId: kw.id })
                              }
                              disabled={approveOne.isPending}
                            >
                              Approve
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {allKwApproved && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setSubStage("paa-review");
              if (!allPaaFetched) {
                fetchPAA.mutate({ businessId });
              }
            }}
          >
            Proceed to PAA Review
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Sub-stage: PAA Review
  // ---------------------------------------------------------------------------
  const renderPAAReview = () => (
    <div className="space-y-4">
      {fetchPAA.isPending && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Fetching People Also Ask questions from DataForSEO…
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">People Also Ask Review</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPAA.mutate({ businessId })}
              disabled={fetchPAA.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Re-fetch PAA
            </Button>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Select the best PAA question for each article. This becomes the opening answer block.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {kwData?.map((kw) => {
            const questions = (kw.paaQuestions as string[] | null) ?? [];
            return (
              <div
                key={kw.id}
                className={`p-4 rounded-xl border ${
                  kw.paaApproved ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      {levelBadge(kw.nodeLevel)}
                      {kw.paaApproved && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                    <p className="font-medium text-slate-900 text-sm">{kw.primaryKeyword}</p>
                  </div>
                </div>

                {questions.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No PAA questions found for this keyword.</p>
                ) : kw.paaApproved ? (
                  <div className="text-sm text-emerald-700 font-medium">
                    ✓ {kw.approvedPaaQuestion}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
                      Select a question:
                    </p>
                    <Select
                      onValueChange={(q) =>
                        approvePAA.mutate({
                          businessId,
                          keywordId: kw.id,
                          approvedQuestion: q,
                        })
                      }
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="Choose a PAA question…" />
                      </SelectTrigger>
                      <SelectContent>
                        {questions.map((q) => (
                          <SelectItem key={q} value={q}>
                            {q}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {allPaaApproved && (
        <div className="flex justify-end">
          <Button onClick={() => navigate("/dashboard")}>
            Proceed to Article Generation
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Sub-stage: Complete
  // ---------------------------------------------------------------------------
  const renderComplete = () => (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Stage 3 Complete</h2>
        <p className="text-slate-500 text-sm max-w-sm mx-auto">
          All keywords and PAA questions are approved. Your articles are ready for generation.
        </p>
        <Button onClick={() => navigate("/dashboard")}>
          Go to Dashboard
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );

  // ---------------------------------------------------------------------------
  // Progress steps
  // ---------------------------------------------------------------------------
  const STEPS = [
    { id: "assign", label: "Assign" },
    { id: "keyword-review", label: "Keyword Review" },
    { id: "paa-review", label: "PAA Review" },
    { id: "complete", label: "Approved" },
  ];

  const stepIndex = STEPS.findIndex((s) => s.id === subStage);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-slate-900 tracking-tight">
          Blog <span className="text-blue-600">Batcher</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Dashboard
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Stage 3: Keyword Research</h1>
          <p className="text-slate-500 text-sm mt-1">
            {business.name} · {(kwData?.length ?? 0)} article slots
          </p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-0 mb-8">
          {STEPS.map((step, i) => {
            const isComplete = i < stepIndex;
            const isCurrent = i === stepIndex;
            return (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-blue-600 text-white"
                      : isComplete
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                  {step.label}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-px w-6 mx-1 ${
                      i < stepIndex ? "bg-emerald-300" : "bg-slate-200"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Sub-stage content */}
        {subStage === "assign" && renderAssign()}
        {subStage === "keyword-review" && renderKeywordReview()}
        {subStage === "paa-review" && renderPAAReview()}
        {subStage === "complete" && renderComplete()}
      </main>

      {/* Swap modal */}
      <SwapModal
        open={!!swapTarget}
        onClose={() => setSwapTarget(null)}
        businessId={businessId}
        kwRow={swapTarget}
        onSwapped={async () => {
          await refetchKw();
        }}
      />
    </div>
  );
}
