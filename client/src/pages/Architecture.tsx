import { useActiveBusiness } from "@/contexts/BusinessContext";
import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import {
  ARTICLE_TYPE_LABELS,
  ARTICLE_TYPES,
  VALID_TYPES_BY_LEVEL,
  calcBreakdown,
  validateArchitecture,
  type ArticleType,
  type PackSize,
} from "@shared/architectureRules";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Lock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { HelpLink } from "@/components/HelpLink";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArchNode {
  id: number;
  level: "cornerstone" | "pillar" | "cluster";
  articleType: string;
  parentCornerstoneId: number | null;
  parentPillarId: number | null;
  sortOrder: number;
}

// ─── Tree Map Component ───────────────────────────────────────────────────────

function TreeMap({
  nodes,
  onTypeChange,
  locked,
}: {
  nodes: ArchNode[];
  onTypeChange: (nodeId: number, type: ArticleType) => void;
  locked: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const cornerstones = nodes.filter((n) => n.level === "cornerstone").sort((a, b) => a.sortOrder - b.sortOrder);

  const pillarsOf = (csId: number) =>
    nodes.filter((n) => n.level === "pillar" && n.parentCornerstoneId === csId).sort((a, b) => a.sortOrder - b.sortOrder);

  const clustersOf = (pillarId: number) =>
    nodes.filter((n) => n.level === "cluster" && n.parentPillarId === pillarId).sort((a, b) => a.sortOrder - b.sortOrder);

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const levelColour = {
    cornerstone: "bg-violet-500/10 border-violet-500/30 text-violet-300",
    pillar: "bg-primary/5 border-primary/20 text-primary",
    cluster: "bg-background border-border text-foreground",
  };

  let csIndex = 0;
  let globalPillarIndex = 0;

  return (
    <div className="space-y-3">
      {cornerstones.map((cs) => {
        csIndex++;
        const csNum = csIndex;
        const pillars = pillarsOf(cs.id);
        const csCollapsed = collapsed.has(cs.id);

        return (
          <div key={cs.id} className="rounded-xl border border-violet-500/30 overflow-hidden">
            {/* Cornerstone header */}
            <div
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none ${levelColour.cornerstone}`}
              onClick={() => toggle(cs.id)}
            >
              <button className="text-violet-400 hover:text-violet-300 transition-colors">
                {csCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <Layers className="w-4 h-4 text-violet-600 shrink-0" />
              <span className="font-semibold text-sm">Cornerstone {csNum}</span>
              <Badge variant="outline" className="ml-auto text-xs border-violet-500/40 text-violet-400">
                Cornerstone Guide
              </Badge>
            </div>

            {/* Pillars */}
            {!csCollapsed && (
              <div className="divide-y divide-border">
                {pillars.map((pillar) => {
                  globalPillarIndex++;
                  const pillarNum = globalPillarIndex;
                  const clusters = clustersOf(pillar.id);
                  const pillarCollapsed = collapsed.has(pillar.id);

                  return (
                    <div key={pillar.id} className="ml-6">
                      {/* Pillar row */}
                      <div
                        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none ${levelColour.pillar}`}
                        onClick={() => toggle(pillar.id)}
                      >
                        <button className="text-primary hover:text-primary/70 transition-colors">
                          {pillarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-sm font-medium">Pillar {csNum}.{pillarNum % pillars.length === 0 ? pillars.length : pillarNum % pillars.length}</span>
                        <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
                          {locked ? (
                            <Badge variant="outline" className="text-xs">
                              {ARTICLE_TYPE_LABELS[pillar.articleType as ArticleType] ?? pillar.articleType}
                            </Badge>
                          ) : (
                            <Select
                              value={pillar.articleType}
                              onValueChange={(val) => onTypeChange(pillar.id, val as ArticleType)}
                            >
                              <SelectTrigger className="h-7 text-xs w-44 bg-card">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {VALID_TYPES_BY_LEVEL.pillar.map((type) => (
                                  <SelectItem key={type} value={type} className="text-xs">
                                    {ARTICLE_TYPE_LABELS[type]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>

                      {/* Clusters */}
                      {!pillarCollapsed && (
                        <div className="ml-6 divide-y divide-border/50">
                          {clusters.map((cluster, ci) => (
                            <div
                              key={cluster.id}
                              className={`flex items-center gap-3 px-4 py-2 ${levelColour.cluster}`}
                            >
                              <div className="w-3.5 h-3.5 shrink-0" />
                              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground">Cluster {ci + 1}</span>
                              <Badge variant="outline" className="ml-auto text-xs text-muted-foreground border-border">
                                {ARTICLE_TYPE_LABELS[cluster.articleType as ArticleType] ?? cluster.articleType}
                                <Lock className="w-2.5 h-2.5 ml-1 opacity-50" />
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Architecture() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // Local slider state (optimistic, before saving)
  const [localCornerstones, setLocalCornerstones] = useState(2);
  const [localPillars, setLocalPillars] = useState(2);
  const [guardrailWarnings, setGuardrailWarnings] = useState<string[]>([]);

  // Business query
  const { activeBusiness: businessData } = useActiveBusiness();
  const businessId = businessData?.id;

  // Architecture query
  const {
    data: archData,
    refetch: refetchArch,
    isLoading: archLoading,
  } = trpc.architecture.getOrCreate.useQuery(
    { businessId: businessId! },
    { enabled: !!businessId }
  );

  const arch = archData?.architecture;
  const nodes = (archData?.nodes ?? []) as ArchNode[];

  // Sync sliders with DB values
  useEffect(() => {
    if (arch) {
      setLocalCornerstones(arch.cornerstoneCount);
      setLocalPillars(arch.pillarCount);
    }
  }, [arch?.cornerstoneCount, arch?.pillarCount]);

  // Live guardrail preview (client-side, no network call)
  const liveGuardrail = useMemo(() => {
    if (!arch?.packSize) return null;
    return validateArchitecture(arch.packSize as PackSize, localCornerstones, localPillars);
  }, [arch?.packSize, localCornerstones, localPillars]);

  // Always show what the user has the sliders set to (raw values), not the guardrail-corrected values
  const liveBreakdown = useMemo(
    () => calcBreakdown(localCornerstones, localPillars),
    [localCornerstones, localPillars]
  );

  // Is the current slider config over the pack limit?
  const isOverLimit = arch?.packSize != null && liveBreakdown.total > arch.packSize;

  // Mutations
  const setPackSize = trpc.architecture.setPackSize.useMutation({
    onSuccess: () => refetchArch(),
  });

  const updateArch = trpc.architecture.update.useMutation({
    onSuccess: (data) => {
      setGuardrailWarnings(data.guardrailWarnings);
      refetchArch();
    },
  });

  const setArticleType = trpc.architecture.setArticleType.useMutation({
    onSuccess: () => refetchArch(),
  });

  const confirmArch = trpc.architecture.confirm.useMutation({
    onSuccess: () => {
      refetchArch();
      navigate("/dashboard");
    },
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
    if (!authLoading && user && !businessId && businessData !== undefined) {
      navigate("/onboarding");
    }
  }, [authLoading, user, businessId, businessData]);

  if (authLoading || archLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    );
  }

  const locked = arch?.confirmed ?? false;
  const currentStage = businessData?.currentStage ?? 2;

  return (
    <DashboardLayout>
    <div style={{ background:"#faf9f5", minHeight:"100%" }}>
      <StageStepper currentStage={currentStage} />
      {/* Page header */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e5e7eb", padding:"16px 24px" }}>
        <div style={{ maxWidth:900, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <h1 style={{ fontSize:18, fontWeight:700, color:"#1a1a2e", margin:0 }}>Stage 2 — Blog Architecture</h1>
            <p style={{ fontSize:13, color:"#6b7280", marginTop:4, marginBottom:0 }}>
              Define the structure of your content batch before keyword research begins.
            </p>
          </div>
          {locked && (
            <span style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:99, fontSize:12, fontWeight:600, background:"#dcfce7", color:"#166534" }}>
              <CheckCircle style={{ width:13, height:13 }} /> Architecture Confirmed
            </span>
          )}
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"32px 24px", display:"flex", flexDirection:"column", gap:24 }}>
        {/* ── Step 1: Pack Selection ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-base">1. Select Your Pack</CardTitle>
              <HelpLink slug="how-many-articles" label="How to choose the right number of articles" />
            </div>
            <CardDescription>Choose how many articles you want in this batch. This is locked once selected.</CardDescription>
          </CardHeader>
          <CardContent>
            {arch?.packSize ? (
              <div className="flex items-center gap-3">
                <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 text-sm px-3 py-1">
                  {arch.packSize}-Article Pack
                </Badge>
                {locked && <Lock className="w-4 h-4 text-muted-foreground" />}
                {!locked && (
                  <span className="text-xs text-muted-foreground">
                    Pack is locked once architecture is confirmed.
                  </span>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 max-w-md">
                {([20, 50] as PackSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() =>
                      businessId &&
                      setPackSize.mutate({ businessId, packSize: size })
                    }
                    disabled={setPackSize.isPending}
                    className="rounded-xl border-2 border-border hover:border-violet-400 hover:bg-violet-500/10 p-6 text-center transition-all group"
                  >
                    <div className="text-3xl font-bold text-foreground group-hover:text-violet-400">
                      {size}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Articles</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      {size === 20 ? "Citation Starter" : "Citation Authority"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Step 2: Architecture Sliders ──────────────────────────────────── */}
        {arch?.packSize && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
              <CardTitle className="text-base">2. Configure Architecture</CardTitle>
              <HelpLink slug="cornerstone-pillar-cluster" label="What are Cornerstone, Pillar, and Cluster articles?" />
            </div>
              <CardDescription>
                Adjust the number of cornerstones and pillars. Clusters per pillar are always 3.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Guardrail warnings */}
              {(guardrailWarnings.length > 0 || (liveGuardrail && !liveGuardrail.valid)) && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    {(liveGuardrail?.warnings ?? guardrailWarnings).map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Article count summary */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Cornerstones", value: liveBreakdown.cornerstones, colour: "text-violet-400", over: false },
                  { label: "Pillars", value: liveBreakdown.totalPillars, colour: "text-primary", over: false },
                  { label: "Clusters", value: liveBreakdown.totalClusters, colour: "text-muted-foreground", over: false },
                  { label: "Total Articles", value: liveBreakdown.total, colour: isOverLimit ? "text-red-500 font-bold" : "text-foreground font-bold", over: isOverLimit },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-lg bg-background border p-3 text-center transition-colors ${
                      item.over ? "border-red-400 bg-red-50" : "border-border"
                    }`}
                  >
                    <div className={`text-2xl flex items-center justify-center gap-1 ${item.colour}`}>
                      {item.value}
                      {item.over && <AlertTriangle className="w-4 h-4 text-red-500" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                    {item.over && arch?.packSize && (
                      <div className="text-xs text-red-500 mt-0.5 font-medium">Limit: {arch.packSize}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Over-limit warning */}
              {isOverLimit && arch?.packSize && liveGuardrail && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <div>
                    <p className="font-semibold">
                      {liveBreakdown.total} articles exceeds your {arch.packSize}-article pack by {liveBreakdown.total - arch.packSize}.
                    </p>
                    <p className="mt-0.5">
                      Suggested fix: reduce to{" "}
                      <strong>{liveGuardrail.correctedCornerstones} cornerstone{liveGuardrail.correctedCornerstones > 1 ? "s" : ""}</strong>{" "}
                      × <strong>{liveGuardrail.correctedPillarsPerCornerstone} pillar{liveGuardrail.correctedPillarsPerCornerstone > 1 ? "s" : ""} per cornerstone</strong>{" "}
                      = {calcBreakdown(liveGuardrail.correctedCornerstones, liveGuardrail.correctedPillarsPerCornerstone).total} articles.
                    </p>
                  </div>
                </div>
              )}

              {/* Cornerstones slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-foreground">Cornerstones</span>
                  <span className="text-violet-400 font-semibold">{localCornerstones}</span>
                </div>
                <Slider
                  min={1}
                  max={4}
                  step={1}
                  value={[localCornerstones]}
                  onValueChange={([v]) => setLocalCornerstones(v)}
                  disabled={locked}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span><span>2</span><span>3</span><span>4</span>
                </div>
              </div>

              {/* Pillars slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-foreground">Pillars per Cornerstone</span>
                  <span className="text-primary font-semibold">{localPillars}</span>
                </div>
                <Slider
                  min={1}
                  max={4}
                  step={1}
                  value={[localPillars]}
                  onValueChange={([v]) => setLocalPillars(v)}
                  disabled={locked}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span><span>2</span><span>3</span><span>4</span>
                </div>
              </div>

              {/* Clusters note */}
              <p className="text-xs text-muted-foreground">
                Clusters per pillar are always exactly 3 — this is a fixed rule of the Blog Batcher architecture system.
              </p>

              {!locked && (
                <Button
                  onClick={() =>
                    businessId &&
                    updateArch.mutate({
                      businessId,
                      cornerstones: localCornerstones,
                      pillarsPerCornerstone: localPillars,
                    })
                  }
                  disabled={updateArch.isPending || isOverLimit}
                  variant="outline"
                  size="sm"
                >
                  {updateArch.isPending ? "Saving…" : isOverLimit ? "Over pack limit — adjust sliders" : "Apply Changes"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Step 3: Visual Tree Map ───────────────────────────────────────── */}
        {nodes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Architecture Map</CardTitle>
              <CardDescription>
                Select the article type for each Pillar. Cornerstone types are fixed. Cluster types are auto-assigned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TreeMap
                nodes={nodes}
                locked={locked}
                onTypeChange={(nodeId, type) =>
                  businessId &&
                  setArticleType.mutate({ businessId, nodeId, articleType: type })
                }
              />
            </CardContent>
          </Card>
        )}

        {/* ── Confirm Button ────────────────────────────────────────────────── */}
        {nodes.length > 0 && !locked && (
          <div className="flex justify-end">
            <Button
              size="lg"
              className="bg-violet-600 hover:bg-violet-700 text-white px-8"
              onClick={() => businessId && confirmArch.mutate({ businessId })}
              disabled={
                confirmArch.isPending ||
                !arch?.packSize ||
                (liveGuardrail !== null && !liveGuardrail.valid)
              }
            >
              {confirmArch.isPending
                ? "Confirming…"
                : "Confirm Architecture & Continue to Keyword Research →"}
            </Button>
          </div>
        )}

        {locked && (
          <div className="flex justify-end">
            <Button
              size="lg"
              className="bg-violet-600 hover:bg-violet-700 text-white px-8"
              onClick={() => navigate("/keywords")}
            >
              Continue to Keyword Research →
            </Button>
          </div>
        )}
      </div>
    </div>
    </DashboardLayout>
  );
}
