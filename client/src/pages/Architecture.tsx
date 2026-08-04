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
  MIN_CLUSTERS_PER_PILLAR,
  MIN_PILLARS_PER_CORNERSTONE,
  MAX_PILLARS_PER_CORNERSTONE,
  FIXED_CORNERSTONES,
  FIXED_PILLARS_PER_CORNERSTONE,
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
      <span style={{ fontSize: 11, color: "#8E8E84", fontStyle: "italic" }}>
        Cornerstone Guide (fixed)
      </span>
    );
  }
  if (level === "cluster") {
    return (
      <span style={{ fontSize: 11, color: "#8E8E84", fontStyle: "italic" }}>
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
      <SelectTrigger style={{ height: 28, fontSize: 11, width: 160, border: "1px solid rgba(14,14,12,0.08)" }}>
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
  pillars,
  clusters,
  savedNodes,
  onTypeChange,
  locked,
}: {
  pillars: number;
  clusters: number;
  savedNodes: ArchNode[];
  onTypeChange: (nodeId: number, type: ArticleType) => void;
  locked: boolean;
}) {
  // Flat 2-tier: pillars are top-level (no parent cornerstone).
  const savedPillarNode = (pIdx: number): ArchNode | undefined => {
    const savedPillars = savedNodes
      .filter((n) => n.level === "pillar")
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return savedPillars[pIdx];
  };

  // Render a single pillar column with its cluster children
  const renderPillarColumn = (pIdx: number) => {
    const label = `${pIdx + 1}`;
    const saved = savedPillarNode(pIdx);
    const pillarType: ArticleType = (saved?.articleType as ArticleType) ?? "how_to";

    return (
      <div key={`p-${pIdx}`} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 140 }}>
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
                color: "#F4F1E8",
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
            <span style={{ fontSize: 10, color: "#0369a1", opacity: 0.7 }}>1,500–1,800 w</span>
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
            <span style={{ fontSize: 11, color: "#8E8E84", fontStyle: "italic" }}>
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
                  background: "#EFEBDF",
                  border: "1px solid rgba(14,14,12,0.08)",
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
                    background: "#5A5A52",
                    color: "#F4F1E8",
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
                <span style={{ fontSize: 10, color: "#8E8E84" }}>800–1,200 w · Specialist Post</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, overflowX: "auto" }}>
      {/* Flat 2-tier: pillar pages side by side, each over its cluster posts. */}
      {pillars > 0 && (
        <div style={{ display: "flex", gap: 12, minWidth: "max-content" }}>
          {Array.from({ length: pillars }, (_, pIdx) => renderPillarColumn(pIdx))}
        </div>
      )}
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

  // Flat 2-tier shape: NO cornerstone. The user picks the pillar count (1–6) and
  // the clusters-per-pillar count (3–5).
  const localCornerstones = FIXED_CORNERSTONES; // 0
  const [localPillars, setLocalPillars] = useState<number>(FIXED_PILLARS_PER_CORNERSTONE);
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

  // Sync the pillar + clusters sliders with the saved DB values when arch loads.
  // (Cornerstone count is always 0 in flat 2-tier, so it is never read back.)
  useEffect(() => {
    if (arch) {
      setLocalPillars(arch.pillarCount ?? FIXED_PILLARS_PER_CORNERSTONE);
      setLocalClusters(arch.clustersPerPillar ?? DEFAULT_CLUSTERS_PER_PILLAR);
    }
  }, [arch?.pillarCount, arch?.clustersPerPillar]);

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
      navigate("/keywords");
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
      </div>
    );
  }

  const locked = arch?.confirmed ?? false;
  const currentStage = businessData?.currentStage ?? 2;

  return (
    <DashboardLayout>
    <div style={{ background: "#F4F1E8", minHeight: "100%" }}>
      <StageStepper currentStage={currentStage} />
      {/* Page header */}
      <div style={{ background: "#FBFAF4", borderBottom: "1px solid rgba(14,14,12,0.08)", padding: "16px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0E0E0C", margin: 0 }}>
            Stage 2 — Blog Architecture
          </h1>
          <p style={{ fontSize: 13, color: "#5A5A52", marginTop: 4, marginBottom: 0 }}>
            Your content batch is a flat 2-tier hub — <strong>pillar pages</strong> with <strong>cluster posts</strong> under each. Choose how many pillars, and how many clusters sit under each pillar.
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
                  <HelpLink slug="cornerstone-pillar-cluster" label="What are Pillar and Cluster articles?" />
                </div>
                <CardDescription style={{ marginTop: 4 }}>
                  Flat 2-tier hub. Set how many pillar pages, and how many cluster posts
                  sit under each pillar — the total updates live.
                </CardDescription>
              </div>
              {locked && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#EFEBDF", color: "#5A5A52" }}>
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
              <div className="flex items-start gap-2 rounded-lg bg-secondary border border-border px-4 py-3 text-sm text-[#C98A2B]">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  {[...depWarnings, ...guardrailWarnings].map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Article count summary — live updating */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Pillars", value: liveBreakdown.totalPillars, colour: "text-foreground" },
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

            {/* Flat 2-tier notice */}
            <div className="rounded-lg bg-secondary border border-border px-4 py-3 text-sm text-muted-foreground">
              A flat 2-tier hub:{" "}
              <strong className="text-foreground">pillar pages</strong>{" → "}
              clusters under each pillar. Each pillar's clusters
              are forced into different formats (how-to, comparison, listicle, troubleshooting, cost/ROI)
              so they never compete with each other.
            </div>

            {/* Pillar count (1–6) */}
            <SliderRow
              label="Pillar Pages"
              subtitle="Broad topic pages — 1,500–1,800 words. Each anchors a group of cluster posts. Choose 1–6 (even a single pillar over 3–5 clusters is a strong focused hub)."
              value={localPillars}
              min={MIN_PILLARS_PER_CORNERSTONE}
              max={MAX_PILLARS_PER_CORNERSTONE}
              colour="text-foreground"
              disabled={locked}
              onChange={handlePillarsChange}
            />

            {/* Clusters per pillar (3–5) */}
            <SliderRow
              label="Cluster Articles (per pillar post)"
              subtitle="Specific, focused posts — 800–1,200 words. Each cluster links back to its pillar. Choose 3–5 per pillar."
              value={localClusters}
              min={MIN_CLUSTERS_PER_PILLAR}
              max={MAX_CLUSTERS_PER_PILLAR}
              colour="text-gray-500"
              disabled={locked}
              onChange={handleClustersChange}
            />

            {/* Architecture summary sentence */}
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
              <strong>{localPillars}</strong> pillar{localPillars !== 1 ? "s" : ""}
              {" × "}<strong>{localClusters}</strong> cluster{localClusters !== 1 ? "s" : ""} each
              {" + "}<strong>{localPillars}</strong> pillar page{localPillars !== 1 ? "s" : ""}
              {" = "}<strong>{liveBreakdown.total} articles total</strong>
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8"
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8"
              onClick={() => navigate("/keywords")}
            >
              Continue to Keyword Research →
            </Button>
          </div>
        )}
        </div>{/* end left column */}

        {/* ── Right-hand SEO explainer column ─────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 24 }}>
          <div style={{ background: "#FBFAF4", border: "1px solid rgba(14,14,12,0.08)", borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Layers style={{ width: 16, height: 16, color: "#F4F1E8" }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0E0E0C" }}>Why Architecture Matters</span>
            </div>
            <p style={{ fontSize: 13, color: "#2C2C28", lineHeight: 1.6, margin: "0 0 14px" }}>
              Blog Batcher builds your content as a <strong>structured hierarchy</strong> — not just a list of posts.
              This is the proven SEO strategy that helps search engines see your site as an <strong>authority in your niche</strong>.
            </p>

            {/* Visual hierarchy diagram — flat 2-tier */}
            <div style={{ background: "#F4F1E8", borderRadius: 8, padding: "14px 12px", marginBottom: 14 }}>
              {/* Pillars (top tier) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                {["Pillar A", "Pillar B", "Pillar C"].map((label) => (
                  <div key={label} style={{ background: "#EFEBDF", borderRadius: 5, padding: "6px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#2C2C28" }}>
                    📄 {label}
                    <div style={{ fontSize: 10, fontWeight: 400, color: "#5A5A52", marginTop: 1 }}>1,500–1,800 w</div>
                  </div>
                ))}
              </div>
              {/* Arrow */}
              <div style={{ textAlign: "center", fontSize: 11, color: "#8E8E84", marginBottom: 6 }}>↑ Cluster posts link up to their pillar</div>
              {/* Clusters */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {["How-to", "Comparison", "Listicle"].map((label) => (
                  <div key={label} style={{ background: "#EFEBDF", borderRadius: 4, padding: "5px 6px", textAlign: "center", fontSize: 10, fontWeight: 500, color: "#5A5A52" }}>
                    📝 {label}
                    <div style={{ fontSize: 9, marginTop: 1 }}>800–1,200 w</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 12, color: "#2C2C28", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 8px" }}>
                <strong style={{ color: "#2C2C28" }}>Pillar Pages</strong> — broad topic pages, one per theme.
                Each is the hub for a group of cluster posts that link up to it.
              </p>
              <p style={{ margin: 0 }}>
                <strong style={{ color: "#5A5A52" }}>Cluster Posts</strong> — short, focused articles, each a different
                format and search intent, targeting one precise long-tail keyword and linking up to its pillar.
              </p>
            </div>
          </div>

          <div style={{ background: "#EFEBDF", border: "1px solid #D9F542", borderRadius: 10, padding: "14px 16px" }}>
            <p style={{ fontSize: 12, color: "#5A5A52", lineHeight: 1.6, margin: 0 }}>
              <strong>This is ideal for SEO.</strong> When smaller, specific posts reference your larger posts with anchor text links,
              search engines understand the depth of your content and are more likely to rank your site as an authority in your niche.
              Blog Batcher SEO-optimises every article in this structure for you automatically.
            </p>
          </div>

          {/* ── Tips Panel ────────────────────────────────────────────── */}
          <div style={{ background: "#FBFAF4", border: "1px solid rgba(14,14,12,0.08)", borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0E0E0C" }}>Why architecture matters</span>
            </div>

            {/* Highlighted tip: the flat 2-tier hub */}
            <div style={{ background: "#faf5ff", border: "1.5px solid rgba(14,14,12,0.16)", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", background: "#EFEBDF", padding: "2px 8px", borderRadius: 99 }}>
                  ✦ Flat 2-tier hub
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#4c1d95", lineHeight: 1.65, margin: "0 0 8px" }}>
                Every batch is a flat <strong>pillar pages → clusters</strong> structure —
                kept shallow so every post can rank on its own.
              </p>
              <p style={{ fontSize: 12, color: "#5A5A52", lineHeight: 1.65, margin: 0, fontStyle: "italic" }}>
                Choose 1–6 pillars and 3–5 clusters each. More = deeper topical coverage.
              </p>
            </div>

            {/* General tips */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>📄</span>
                <p style={{ fontSize: 12, color: "#2C2C28", lineHeight: 1.65, margin: 0 }}>
                  <strong>Pillar pages are your topic hubs</strong> — each anchors a group of cluster posts on one theme.
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>🔗</span>
                <p style={{ fontSize: 12, color: "#2C2C28", lineHeight: 1.65, margin: 0 }}>
                  Each cluster article <strong>links back to its pillar</strong>, building your internal link structure automatically.
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
