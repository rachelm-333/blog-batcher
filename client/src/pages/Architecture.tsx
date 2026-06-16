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

// ─── Live Architecture Map ────────────────────────────────────────────────────
// Purely client-side, driven by slider values. Re-renders on every slider change.
// Pillar article-type dropdowns read from saved DB nodes (by position) when available,
// and fall back to "how_to". Mutations still call setArticleType on the saved nodes.

function LiveArchMap({
  cornerstones,
  pillars,
  clusters,
  savedNodes,
  onTypeChange,
  locked,
}: {
  cornerstones: number;
  pillars: number;
  clusters: number;
  savedNodes: ArchNode[];
  onTypeChange: (nodeId: number, type: ArticleType) => void;
  locked: boolean;
}) {
  // Helper: find the saved DB node for a pillar by cornerstone+pillar index (1-based)
  const savedPillarNode = (csIdx: number, pIdx: number): ArchNode | undefined => {
    if (cornerstones === 0) {
      // In pillar-only mode, savedNodes pillars have parentCornerstoneId = null
      const savedPillars = savedNodes
        .filter((n) => n.level === "pillar")
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return savedPillars[pIdx];
    }
    const savedCornerstones = savedNodes
      .filter((n) => n.level === "cornerstone")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const cs = savedCornerstones[csIdx];
    if (!cs) return undefined;
    const savedPillars = savedNodes
      .filter((n) => n.level === "pillar" && n.parentCornerstoneId === cs.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return savedPillars[pIdx];
  };

  // Render a single pillar column with its cluster children
  const renderPillarColumn = (csIdx: number, pIdx: number) => {
    const label = cornerstones === 0 ? `${pIdx + 1}` : `${csIdx + 1}.${pIdx + 1}`;
    const saved = savedPillarNode(csIdx, pIdx);
    const pillarType: ArticleType = (saved?.articleType as ArticleType) ?? "how_to";

    return (
      <div key={`p-${csIdx}-${pIdx}`} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 140 }}>
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
              Pillar {label}
            </span>
            <span style={{ fontSize: 10, color: "#0369a1", opacity: 0.7 }}>1,500–2,200 w</span>
          </div>
          {saved ? (
            <ArticleTypeSelect
              nodeId={saved.id}
              level="pillar"
              value={pillarType}
              locked={locked}
              onTypeChange={onTypeChange}
            />
          ) : (
            <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
              {ARTICLE_TYPE_LABELS[pillarType]}
            </span>
          )}
        </div>

        {/* Cluster boxes under this pillar */}
        {clusters > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 12 }}>
            {Array.from({ length: clusters }, (_, clIdx) => (
              <div
                key={clIdx}
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
                  Cluster {label}.{clIdx + 1}
                </span>
                <span style={{ fontSize: 10, color: "#9ca3af" }}>800–1,200 w · Specialist Post</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Pillar-only mode (cornerstones = 0) ──────────────────────────────────────
  if (cornerstones === 0) {
    return (
      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            minWidth: "max-content",
            paddingBottom: 4,
          }}
        >
          {Array.from({ length: pillars }, (_, pIdx) => renderPillarColumn(0, pIdx))}
        </div>
      </div>
    );
  }

  // ── Standard hierarchy mode (cornerstones > 0) ───────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, overflowX: "auto" }}>
      {Array.from({ length: cornerstones }, (_, csIdx) => (
        <div key={csIdx} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: "max-content" }}>
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
              <span style={{ fontSize: 13, fontWeight: 600, color: "#4c1d95" }}>Cornerstone Guide</span>
            </div>
            <span style={{ fontSize: 11, color: "#7c3aed", opacity: 0.7 }}>2,800–3,200 words</span>
          </div>

          {/* Pillars row */}
          {pillars > 0 && (
            <div
              style={{
                display: "flex",
                gap: 10,
                paddingLeft: 20,
              }}
            >
              {Array.from({ length: pillars }, (_, pIdx) => renderPillarColumn(csIdx, pIdx))}
            </div>
          )}
        </div>
      ))}
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
      <div>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
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
      <div className="flex justify-between text-xs text-muted-foreground/50 px-0.5">
        {Array.from({ length: max - min + 1 }, (_, i) => (
          <span key={i}>{min + i}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Architecture() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  // Local slider state (optimistic, before saving)
  // Defaults: 1 cornerstone, 1 pillar, 3 clusters
  const [localCornerstones, setLocalCornerstones] = useState(1);
  const [localPillars, setLocalPillars] = useState(MIN_PILLARS_PER_CORNERSTONE);
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

  // Slider handlers — strict hierarchy, no standalone modes
  const handleCornerstonesChange = (v: number) => setLocalCornerstones(v);
  const handlePillarsChange = (v: number) => setLocalPillars(v);
  const handleClustersChange = (v: number) => setLocalClusters(v);

  // Live breakdown (raw slider values, no guardrail correction)
  const liveBreakdown = useMemo(
    () => calcBreakdown(localCornerstones, localPillars, localClusters),
    [localCornerstones, localPillars, localClusters]
  );

  // No dependency warnings needed — strict hierarchy enforced by slider min values
  const depWarnings: string[] = [];

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

      {/* Two-column layout: sliders (centre) + SEO explainer (right sidebar) */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 28, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

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
              label={localCornerstones === 0 ? "Standalone Pillar Posts" : "Pillar Posts (per cornerstone post)"}
              subtitle="In-depth topic posts — 1,500–2,200 words. Each pillar links back to its cornerstone."
              value={localPillars}
              min={MIN_PILLARS_PER_CORNERSTONE}
              max={MAX_PILLARS_PER_CORNERSTONE}
              colour="text-sky-600"
              disabled={locked}
              onChange={handlePillarsChange}
            />

            <SliderRow
              label="Cluster Articles (per pillar post)"
              subtitle="Specific, focused posts — 800–1,200 words. Each cluster links back to its pillar and cornerstone."
              value={localClusters}
              min={MIN_CLUSTERS_PER_PILLAR}
              max={MAX_CLUSTERS_PER_PILLAR}
              colour="text-gray-500"
              disabled={locked}
              onChange={handleClustersChange}
            />

            {/* Architecture summary sentence */}
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
              {localCornerstones === 0 && localClusters === 0 ? (
                <>
                  <strong>{localPillars}</strong> standalone pillar post{localPillars !== 1 ? "s" : ""}
                  {" = "}<strong>{liveBreakdown.total} article{liveBreakdown.total !== 1 ? "s" : ""} total</strong>
                </>
              ) : localCornerstones === 0 ? (
                <>
                  <strong>{localPillars}</strong> pillar post{localPillars !== 1 ? "s" : ""}
                  {" × "}<strong>{localClusters}</strong> cluster{localClusters !== 1 ? "s" : ""} each
                  {" = "}<strong>{liveBreakdown.total} articles total</strong>
                </>
              ) : (
                <>
                  <strong>{localCornerstones}</strong> cornerstone{localCornerstones !== 1 ? "s" : ""}
                  {" × "}<strong>{localPillars}</strong> pillar{localPillars !== 1 ? "s" : ""} per cornerstone
                  {" × "}<strong>{localClusters}</strong> cluster{localClusters !== 1 ? "s" : ""} per pillar
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
                disabled={updateArch.isPending || liveBreakdown.total === 0}
                variant="outline"
                size="sm"
              >
                {updateArch.isPending ? "Saving…" : "Apply Changes"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ── Visual Tree Map ───────────────────────────────────────────────── */}
        {liveBreakdown.total > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Architecture Map</CardTitle>
              </div>
              <CardDescription>
                Your content structure — updates as you adjust the sliders above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveArchMap
                cornerstones={localCornerstones}
                pillars={localPillars}
                clusters={localClusters}
                savedNodes={nodes}
                locked={locked}
                onTypeChange={(nodeId: number, type: ArticleType) =>
                  businessId &&
                  setArticleType.mutate({ businessId, nodeId, articleType: type })
                }
              />
            </CardContent>
          </Card>
        )}

        {/* ── Confirm Button ────────────────────────────────────────────────── */}
        {liveBreakdown.total > 0 && !locked && (
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
        </div>{/* end left column */}

        {/* ── Right-hand SEO explainer column ─────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Layers style={{ width: 16, height: 16, color: "#fff" }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>Why Architecture Matters</span>
            </div>
            <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.6, margin: "0 0 14px" }}>
              Blog Batcher builds your content as a <strong>structured hierarchy</strong> — not just a list of posts.
              This is the proven SEO strategy that helps search engines see your site as an <strong>authority in your niche</strong>.
            </p>

            {/* Visual hierarchy diagram */}
            <div style={{ background: "#faf9f5", borderRadius: 8, padding: "14px 12px", marginBottom: 14 }}>
              {/* Cornerstone */}
              <div style={{ background: "#7c3aed", color: "#fff", borderRadius: 6, padding: "8px 12px", textAlign: "center", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                🏛 Cornerstone Article
                <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>Long-form authority post (2,800–3,200 words)</div>
              </div>
              {/* Arrow down */}
              <div style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>↑ Pillar posts link to this</div>
              {/* Pillars */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                {["Pillar Post A", "Pillar Post B"].map((label) => (
                  <div key={label} style={{ background: "#dbeafe", borderRadius: 5, padding: "6px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#1e40af" }}>
                    📄 {label}
                    <div style={{ fontSize: 10, fontWeight: 400, color: "#3b82f6", marginTop: 1 }}>1,500–2,200 words</div>
                  </div>
                ))}
              </div>
              {/* Arrow down */}
              <div style={{ textAlign: "center", fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>↑ Cluster posts link to these</div>
              {/* Clusters */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {["Cluster 1", "Cluster 2", "Cluster 3"].map((label) => (
                  <div key={label} style={{ background: "#f3f4f6", borderRadius: 4, padding: "5px 6px", textAlign: "center", fontSize: 10, fontWeight: 500, color: "#6b7280" }}>
                    📝 {label}
                    <div style={{ fontSize: 9, marginTop: 1 }}>800–1,200 words</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 8px" }}>
                <strong style={{ color: "#7c3aed" }}>Cornerstone</strong> — your big, authoritative guide on a broad topic.
                All other posts point back to it with anchor text links.
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong style={{ color: "#1e40af" }}>Pillar Posts</strong> — in-depth articles on specific sub-topics.
                They link to the cornerstone and are supported by cluster posts.
              </p>
              <p style={{ margin: 0 }}>
                <strong style={{ color: "#6b7280" }}>Cluster Posts</strong> — short, focused articles targeting one precise keyword.
                They link up to their pillar and cornerstone, signalling topical depth.
              </p>
            </div>
          </div>

          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 16px" }}>
            <p style={{ fontSize: 12, color: "#166534", lineHeight: 1.6, margin: 0 }}>
              <strong>This is ideal for SEO.</strong> When smaller, specific posts reference your larger posts with anchor text links,
              search engines understand the depth of your content and are more likely to rank your site as an authority in your niche.
              Blog Batcher SEO-optimises every article in this structure for you automatically.
            </p>
          </div>

          {/* ── Tips Panel ────────────────────────────────────────────── */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>Why architecture matters</span>
            </div>

            {/* Highlighted tip: Standalone post setup */}
            <div style={{ background: "#faf5ff", border: "1.5px solid #c4b5fd", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", background: "#ede9ff", padding: "2px 8px", borderRadius: 99 }}>
                  ✦ "Standalone post" setup
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#4c1d95", lineHeight: 1.65, margin: "0 0 8px" }}>
                Set <strong>Cornerstones to 0</strong>, <strong>Pillars to 1</strong>, <strong>Clusters to 0</strong>.
              </p>
              <p style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.65, margin: "0 0 8px" }}>
                This generates a single focused article — ideal for comparative posts like
                &ldquo;The 10 Best X in Y&rdquo; or &ldquo;X vs Y: Which Is Right for You?&rdquo;
              </p>
              <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.65, margin: 0, fontStyle: "italic" }}>
                We recommend this for your first post on a new topic.
              </p>
            </div>

            {/* General tips */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🏛</span>
                <p style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.65, margin: 0 }}>
                  <strong>Cornerstone posts are your authority hubs</strong> — build these first before adding pillars and clusters.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🔗</span>
                <p style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.65, margin: 0 }}>
                  Each cluster article <strong>links back to its pillar and cornerstone</strong>, building your internal link structure automatically.
                </p>
              </div>
            </div>
          </div>
        </div>{/* end right column */}

      </div>
    </div>

    </DashboardLayout>
  );
}
