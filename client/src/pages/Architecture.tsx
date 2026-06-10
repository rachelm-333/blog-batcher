import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { useAuth } from "@/_core/hooks/useAuth";
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
  ARTICLE_LEVEL_INFO,
  ARTICLE_TYPE_LABELS,
  ARTICLE_TYPES,
  DEFAULT_CLUSTERS_PER_PILLAR,
  MAX_CLUSTERS_PER_PILLAR,
  MAX_CORNERSTONES,
  MAX_PILLARS_PER_CORNERSTONE,
  MIN_CLUSTERS_PER_PILLAR,
  MIN_CORNERSTONES,
  MIN_PILLARS_PER_CORNERSTONE,
  VALID_TYPES_BY_LEVEL,
  calcBreakdown,
  enforceDependencies,
  type ArticleType,
} from "@shared/architectureRules";
import { useActiveBusiness } from "@/contexts/BusinessContext";
import {
  AlertTriangle,
  CheckCircle,
  Edit2,
  Layers,
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

// ─── Article type selector (pillar only) ─────────────────────────────────────

function ArticleTypeSelect({
  nodeId,
  level,
  value,
  locked,
  onTypeChange,
}: {
  nodeId: number;
  level: "cornerstone" | "pillar" | "cluster";
  value: string;
  locked: boolean;
  onTypeChange: (nodeId: number, type: ArticleType) => void;
}) {
  const validTypes = VALID_TYPES_BY_LEVEL[level];
  if (level === "cornerstone") {
    return (
      <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
        Cornerstone Guide (fixed)
      </span>
    );
  }
  if (level === "cluster") {
    return (
      <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
        {ARTICLE_TYPE_LABELS[value as ArticleType] ?? "Specialist Post"}
      </span>
    );
  }
  // Pillar — selectable
  return (
    <Select
      value={value}
      onValueChange={(v) => onTypeChange(nodeId, v as ArticleType)}
      disabled={locked}
    >
      <SelectTrigger style={{ height: 28, fontSize: 11, width: 160, border: "1px solid #e5e7eb" }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {validTypes.map((t) => (
          <SelectItem key={t} value={t} style={{ fontSize: 12 }}>
            {ARTICLE_TYPE_LABELS[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Tree Map ─────────────────────────────────────────────────────────────────

function TreeMap({
  nodes,
  onTypeChange,
  locked,
}: {
  nodes: ArchNode[];
  onTypeChange: (nodeId: number, type: ArticleType) => void;
  locked: boolean;
}) {
  const cornerstones = nodes
    .filter((n) => n.level === "cornerstone")
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const pillarsOf = (csId: number) =>
    nodes
      .filter((n) => n.level === "pillar" && n.parentCornerstoneId === csId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const clustersOf = (pillarId: number) =>
    nodes
      .filter((n) => n.level === "cluster" && n.parentPillarId === pillarId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {cornerstones.map((cs, csIdx) => {
        const pillars = pillarsOf(cs.id);
        return (
          <div key={cs.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Cornerstone — full width */}
            <div
              style={{
                background: "linear-gradient(135deg, #ede9ff 0%, #f5f3ff 100%)",
                border: "1.5px solid #c4b5fd",
                borderRadius: 10,
                padding: "12px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    background: "#7c3aed",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Cornerstone {csIdx + 1}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#4c1d95" }}>
                  Cornerstone Guide
                </span>
              </div>
              <span style={{ fontSize: 11, color: "#7c3aed", opacity: 0.7 }}>
                2,800–3,200 words
              </span>
            </div>

            {/* Pillars row */}
            {pillars.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${pillars.length}, 1fr)`,
                  gap: 10,
                  paddingLeft: 20,
                }}
              >
                {pillars.map((pillar, pIdx) => {
                  const clusters = clustersOf(pillar.id);
                  return (
                    <div key={pillar.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Pillar card */}
                      <div
                        style={{
                          background: "#f0f9ff",
                          border: "1.5px solid #bae6fd",
                          borderRadius: 8,
                          padding: "10px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span
                            style={{
                              background: "#0284c7",
                              color: "#fff",
                              fontSize: 9,
                              fontWeight: 700,
                              padding: "2px 7px",
                              borderRadius: 99,
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              flexShrink: 0,
                            }}
                          >
                            Pillar {csIdx + 1}.{pIdx + 1}
                          </span>
                          <span style={{ fontSize: 10, color: "#0369a1", opacity: 0.7 }}>
                            1,500–2,000 w
                          </span>
                        </div>
                        <ArticleTypeSelect
                          nodeId={pillar.id}
                          level="pillar"
                          value={pillar.articleType}
                          locked={locked}
                          onTypeChange={onTypeChange}
                        />
                      </div>

                      {/* Clusters under this pillar */}
                      {clusters.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 12 }}>
                          {clusters.map((cluster, clIdx) => (
                            <div
                              key={cluster.id}
                              style={{
                                background: "#f9fafb",
                                border: "1px solid #e5e7eb",
                                borderRadius: 6,
                                padding: "8px 12px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  background: "#6b7280",
                                  color: "#fff",
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 99,
                                  letterSpacing: "0.05em",
                                  textTransform: "uppercase",
                                  flexShrink: 0,
                                }}
                              >
                                Cluster {csIdx + 1}.{pIdx + 1}.{clIdx + 1}
                              </span>
                              <span style={{ fontSize: 10, color: "#9ca3af" }}>
                                800–1,200 w · Specialist Post
                              </span>
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

// ─── Slider row (no tick labels) ──────────────────────────────────────────────

function SliderRow({
  label,
  subtitle,
  value,
  min,
  max,
  colour,
  disabled,
  onChange,
}: {
  label: string;
  subtitle: string;
  value: number;
  min: number;
  max: number;
  colour: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-sm font-medium text-foreground">{label}</span>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <span className={`text-lg font-bold tabular-nums ${colour}`}>{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        disabled={disabled}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground/60">
        <span>{min}</span>
        <span>{max}</span>
      </div>
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
  const [localClusters, setLocalClusters] = useState(DEFAULT_CLUSTERS_PER_PILLAR);
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

  // Auto-init default architecture if none exists
  const initDefault = trpc.architecture.initDefault.useMutation({
    onSuccess: () => refetchArch(),
  });

  useEffect(() => {
    if (!archLoading && businessId && archData && !archData.architecture) {
      initDefault.mutate({ businessId });
    }
  }, [archLoading, businessId, archData?.architecture]);

  // Sync sliders with DB values when arch loads
  useEffect(() => {
    if (arch) {
      setLocalCornerstones(arch.cornerstoneCount);
      setLocalPillars(arch.pillarCount);
      setLocalClusters(arch.clustersPerPillar ?? DEFAULT_CLUSTERS_PER_PILLAR);
    }
  }, [arch?.cornerstoneCount, arch?.pillarCount, arch?.clustersPerPillar]);

  // Enforce dependencies as user drags sliders
  const handleCornerstonesChange = (v: number) => {
    setLocalCornerstones(v);
    if (v === 0) { setLocalPillars(0); setLocalClusters(0); }
  };
  const handlePillarsChange = (v: number) => {
    setLocalPillars(v);
    if (v === 0) setLocalClusters(0);
  };
  const handleClustersChange = (v: number) => {
    setLocalClusters(v);
  };

  // Live breakdown (raw slider values, no guardrail correction)
  const liveBreakdown = useMemo(
    () => calcBreakdown(localCornerstones, localPillars, localClusters),
    [localCornerstones, localPillars, localClusters]
  );

  // Dependency warnings for live display
  const depWarnings = useMemo(() => {
    const result = enforceDependencies(localCornerstones, localPillars, localClusters);
    return result.warnings;
  }, [localCornerstones, localPillars, localClusters]);

  // Mutations
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

  const unlockArch = trpc.architecture.unlock.useMutation({
    onSuccess: () => refetchArch(),
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
    if (!authLoading && user && !businessId && businessData !== undefined) {
      navigate("/onboarding");
    }
  }, [authLoading, user, businessId, businessData]);

  if (authLoading || archLoading || initDefault.isPending) {
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
    <div style={{ background: "#faf9f5", minHeight: "100%" }}>
      <StageStepper currentStage={currentStage} />
      {/* Page header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", margin: 0 }}>
            Stage 2 — Blog Architecture
          </h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4, marginBottom: 0 }}>
            Define the structure of your content batch. Drag the sliders to set the number of cornerstones, pillars, and clusters.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Configure Architecture ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-base">Configure Your Content Architecture</CardTitle>
                  <HelpLink slug="cornerstone-pillar-cluster" label="What are Cornerstone, Pillar, and Cluster articles?" />
                </div>
                <CardDescription style={{ marginTop: 4 }}>
                  Use the sliders to set how many cornerstones, pillars per cornerstone, and clusters per pillar you want.
                  The total article count updates live as you drag.
                </CardDescription>
              </div>
              {locked && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#dcfce7", color: "#166534" }}>
                    <CheckCircle style={{ width: 12, height: 12 }} /> Confirmed
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => businessId && unlockArch.mutate({ businessId })}
                    disabled={unlockArch.isPending}
                    style={{ fontSize: 12, height: 30 }}
                  >
                    <Edit2 style={{ width: 12, height: 12, marginRight: 4 }} />
                    {unlockArch.isPending ? "Unlocking…" : "Edit"}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Guardrail / dependency warnings */}
            {(guardrailWarnings.length > 0 || depWarnings.length > 0) && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {[...depWarnings, ...guardrailWarnings].map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Article count summary — live updating */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Cornerstones", value: liveBreakdown.cornerstones, colour: "text-violet-600" },
                { label: "Pillars", value: liveBreakdown.totalPillars, colour: "text-sky-600" },
                { label: "Clusters", value: liveBreakdown.totalClusters, colour: "text-gray-500" },
                { label: "Total Articles", value: liveBreakdown.total, colour: "text-foreground font-bold" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg bg-background border border-border p-3 text-center"
                >
                  <div className={`text-2xl flex items-center justify-center gap-1 ${item.colour}`}>
                    {item.value}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Sliders */}
            <SliderRow
              label="Cornerstones"
              subtitle="Authoritative guide posts — 2,800–3,200 words. The trunk of your content tree."
              value={localCornerstones}
              min={MIN_CORNERSTONES}
              max={MAX_CORNERSTONES}
              colour="text-violet-600"
              disabled={locked}
              onChange={handleCornerstonesChange}
            />

            <SliderRow
              label="Pillar Posts per Cornerstone"
              subtitle="In-depth topic posts — 1,500–2,000 words. Branches off each cornerstone."
              value={localPillars}
              min={MIN_PILLARS_PER_CORNERSTONE}
              max={MAX_PILLARS_PER_CORNERSTONE}
              colour="text-sky-600"
              disabled={locked || localCornerstones === 0}
              onChange={handlePillarsChange}
            />

            <SliderRow
              label="Cluster Articles per Pillar"
              subtitle="Specific, focused posts — 800–1,200 words. Leaves of the tree, one precise question each."
              value={localClusters}
              min={MIN_CLUSTERS_PER_PILLAR}
              max={MAX_CLUSTERS_PER_PILLAR}
              colour="text-gray-500"
              disabled={locked || localPillars === 0}
              onChange={handleClustersChange}
            />

            {/* Architecture summary sentence */}
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
              {localCornerstones === 0 ? (
                "No articles configured yet — drag the sliders above to build your architecture."
              ) : (
                <>
                  <strong>{localCornerstones}</strong> cornerstone{localCornerstones !== 1 ? "s" : ""}
                  {localPillars > 0 && <> × <strong>{localPillars}</strong> pillar{localPillars !== 1 ? "s" : ""} per cornerstone</>}
                  {localClusters > 0 && <> × <strong>{localClusters}</strong> cluster{localClusters !== 1 ? "s" : ""} per pillar</>}
                  {" = "}<strong>{liveBreakdown.total} articles total</strong>
                </>
              )}
            </p>

            {!locked && (
              <Button
                onClick={() =>
                  businessId &&
                  updateArch.mutate({
                    businessId,
                    cornerstones: localCornerstones,
                    pillarsPerCornerstone: localPillars,
                    clustersPerPillar: localClusters,
                  })
                }
                disabled={updateArch.isPending || localCornerstones === 0}
                variant="outline"
                size="sm"
              >
                {updateArch.isPending ? "Saving…" : "Apply Changes"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ── Visual Tree Map ───────────────────────────────────────────────── */}
        {nodes.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Architecture Map</CardTitle>
              </div>
              <CardDescription>
                Your content tree. Cornerstones span the full width; pillars sit side-by-side below each cornerstone; clusters stack under each pillar.
                Select the article type for each Pillar — cornerstone and cluster types are fixed.
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
              disabled={confirmArch.isPending}
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
