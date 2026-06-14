/**
 * Stage 3.5 — Content Plan
 * Shows Claude-generated article plans (title, angle, key section) for each
 * approved article node. Users can edit titles and add direction before generation.
 *
 * BUG 1 FIX: When "Start Generating" is clicked, we flush all pending debounced
 * saves synchronously (cancel timers, fire saves immediately), wait for all
 * mutations to settle, then navigate to /generate.
 */
import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useActiveBusiness } from "@/contexts/BusinessContext";
import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { Loader2, ArrowRight, Zap, BarChart2 } from "lucide-react";
import { toast } from "sonner";

/* ─── Level badge ────────────────────────────────────────── */
function LevelBadge({ level }: { level: string }) {
  if (level === "cornerstone") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:"#ede9ff", color:"#6e5afe", whiteSpace:"nowrap" }}>
      ◆ Cornerstone
    </span>
  );
  if (level === "pillar") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:"#dbeafe", color:"#1e40af", whiteSpace:"nowrap" }}>
      ▲ Pillar
    </span>
  );
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:"#f3f4f6", color:"#6b7280", whiteSpace:"nowrap" }}>
      ● Cluster
    </span>
  );
}

function CompBadge({ comp }: { comp: string | null }) {
  if (comp === "high") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:"#dc2626", fontWeight:600 }}>
      <BarChart2 style={{ width:13, height:13 }} /> High
    </span>
  );
  if (comp === "medium") return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:"#d97706", fontWeight:600 }}>
      <BarChart2 style={{ width:13, height:13 }} /> Medium
    </span>
  );
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:"#16a34a", fontWeight:600 }}>
      <BarChart2 style={{ width:13, height:13 }} /> Low
    </span>
  );
}

/* ─── Plan item type ─────────────────────────────────────── */
type PlanItem = {
  nodeId: number;
  keyword: string;
  level: string;
  articleType: string;
  msv: number | null;
  competitionLevel: string | null;
  contentPlanDirection: string | null;
  proposedTitle: string;
  angle: string;
  keySection: string;
};

/* ─── Card ref handle (exposes flush) ────────────────────── */
export type ArticleCardHandle = {
  /** Cancel pending debounce and return the current unsaved values (or null if nothing pending) */
  flushPending: () => { nodeId: number; proposedTitle: string; direction: string } | null;
};

/* ─── Article card ───────────────────────────────────────── */
const ArticleCard = forwardRef<ArticleCardHandle, {
  item: PlanItem;
  onSave: (nodeId: number, proposedTitle: string, direction: string) => void;
}>(function ArticleCard({ item, onSave }, ref) {
  const [title, setTitle] = useState(item.proposedTitle);
  const [direction, setDirection] = useState(item.contentPlanDirection ?? "");
  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether there's a pending (unsaved) change
  const pendingTitle = useRef(item.proposedTitle);
  const pendingDir = useRef(item.contentPlanDirection ?? "");
  const hasPending = useRef(false);

  useImperativeHandle(ref, () => ({
    flushPending: () => {
      if (!hasPending.current) return null;
      if (titleDebounce.current) clearTimeout(titleDebounce.current);
      if (dirDebounce.current) clearTimeout(dirDebounce.current);
      hasPending.current = false;
      return { nodeId: item.nodeId, proposedTitle: pendingTitle.current, direction: pendingDir.current };
    },
  }));

  const handleTitleChange = useCallback((val: string) => {
    setTitle(val);
    pendingTitle.current = val;
    hasPending.current = true;
    if (titleDebounce.current) clearTimeout(titleDebounce.current);
    titleDebounce.current = setTimeout(() => {
      hasPending.current = false;
      onSave(item.nodeId, val, pendingDir.current);
    }, 800);
  }, [item.nodeId, onSave]);

  const handleDirectionChange = useCallback((val: string) => {
    setDirection(val);
    pendingDir.current = val;
    hasPending.current = true;
    if (dirDebounce.current) clearTimeout(dirDebounce.current);
    dirDebounce.current = setTimeout(() => {
      hasPending.current = false;
      onSave(item.nodeId, pendingTitle.current, val);
    }, 800);
  }, [item.nodeId, onSave]);

  const handleTitleBlur = useCallback(() => {
    if (titleDebounce.current) clearTimeout(titleDebounce.current);
    hasPending.current = false;
    onSave(item.nodeId, pendingTitle.current, pendingDir.current);
  }, [item.nodeId, onSave]);

  const handleDirectionBlur = useCallback(() => {
    if (dirDebounce.current) clearTimeout(dirDebounce.current);
    hasPending.current = false;
    onSave(item.nodeId, pendingTitle.current, pendingDir.current);
  }, [item.nodeId, onSave]);

  return (
    <div style={{
      background:"#fff",
      border:"1px solid #e5e7eb",
      borderRadius:12,
      padding:24,
      display:"flex",
      flexDirection:"column",
      gap:16,
    }}>
      {/* Top row: badges + keyword chip */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <LevelBadge level={item.level} />
        <span style={{
          fontFamily:"monospace",
          fontSize:12,
          background:"#f3f4f6",
          color:"#374151",
          padding:"3px 10px",
          borderRadius:6,
          fontWeight:600,
        }}>
          {item.keyword}
        </span>
        {item.msv !== null && (
          <span style={{ fontSize:11, color:"#9ca3af", fontWeight:500 }}>
            {item.msv.toLocaleString()} searches/mo
          </span>
        )}
        <CompBadge comp={item.competitionLevel} />
      </div>

      {/* Editable title */}
      <div>
        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:6 }}>
          Article title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={handleTitleBlur}
          style={{
            width:"100%",
            fontSize:15,
            fontWeight:600,
            color:"#1a1a2e",
            border:"1.5px solid #e5e7eb",
            borderRadius:8,
            padding:"10px 14px",
            outline:"none",
            boxSizing:"border-box",
            transition:"border-color 0.15s",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "#6e5afe"; }}
          onBlurCapture={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
        />
      </div>

      {/* Angle (read-only) */}
      {item.angle && (
        <div>
          <span style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.06em" }}>
            What this post covers:
          </span>
          <p style={{ fontSize:13, color:"#6b7280", margin:"4px 0 0", lineHeight:1.55 }}>
            {item.angle}
          </p>
        </div>
      )}

      {/* Key section (read-only) */}
      {item.keySection && (
        <div>
          <span style={{ fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.06em" }}>
            Most valuable section:
          </span>
          <p style={{ fontSize:13, color:"#374151", margin:"4px 0 0", fontWeight:500 }}>
            {item.keySection}
          </p>
        </div>
      )}

      {/* Direction textarea */}
      <div>
        <label style={{ fontSize:11, fontWeight:600, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:6 }}>
          Add direction <span style={{ fontWeight:400, textTransform:"none", fontSize:11 }}>(optional)</span>
        </label>
        <textarea
          rows={2}
          value={direction}
          onChange={(e) => handleDirectionChange(e.target.value)}
          onBlur={handleDirectionBlur}
          placeholder="e.g. Make sure to cover the new WorkSafe guidelines. Focus on construction industry examples."
          style={{
            width:"100%",
            fontSize:13,
            color:"#374151",
            border:"1.5px solid #e5e7eb",
            borderRadius:8,
            padding:"10px 14px",
            outline:"none",
            resize:"vertical",
            boxSizing:"border-box",
            fontFamily:"inherit",
            lineHeight:1.5,
            transition:"border-color 0.15s",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "#6e5afe"; }}
          onBlurCapture={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
        />
      </div>
    </div>
  );
});

/* ─── Skeleton card ──────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div style={{
      background:"#fff",
      border:"1px solid #e5e7eb",
      borderRadius:12,
      padding:24,
      display:"flex",
      flexDirection:"column",
      gap:14,
    }}>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ height:22, width:100, borderRadius:99, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
        <div style={{ height:22, width:140, borderRadius:6, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
      </div>
      <div style={{ height:42, borderRadius:8, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
      <div style={{ height:14, width:"80%", borderRadius:4, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
      <div style={{ height:14, width:"60%", borderRadius:4, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
      <div style={{ height:56, borderRadius:8, background:"#f3f4f6", animation:"pulse 1.5s ease-in-out infinite" }} />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────── */
export default function ContentPlan() {
  const { user, loading: userLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { activeBusiness: business, isLoading: bizLoading } = useActiveBusiness();
  const businessId = business?.id ?? 0;
  const currentStage = (business?.currentStage as number | undefined) ?? 1;

  const [planItems, setPlanItems] = useState<PlanItem[] | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);

  // Refs to each ArticleCard so we can call flushPending on them
  const cardRefs = useRef<Map<number, ArticleCardHandle>>(new Map());

  const generatePlanMutation = trpc.articles.generateContentPlan.useMutation({
    onSuccess: (data) => {
      setPlanItems(data as PlanItem[]);
    },
    onError: (err) => {
      toast.error("Failed to generate content plan: " + err.message);
    },
  });

  const saveItemMutation = trpc.articles.saveContentPlanItem.useMutation({
    onError: (err) => {
      toast.error("Failed to save: " + err.message);
    },
  });

  // Auto-generate plan when businessId is available
  useEffect(() => {
    if (!businessId || planItems !== null || generatePlanMutation.isPending) return;
    generatePlanMutation.mutate({ businessId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const handleSave = useCallback((nodeId: number, proposedTitle: string, direction: string) => {
    saveItemMutation.mutate({ nodeId, proposedTitle, direction });
  }, [saveItemMutation]);

  /**
   * BUG 1 FIX: Flush all pending debounced saves before navigating.
   * 1. Collect all unsaved changes from card refs
   * 2. Fire saveContentPlanItem for each pending card
   * 3. Wait for all saves to complete (Promise.all)
   * 4. Navigate to /generate
   */
  const handleStartGenerating = useCallback(async () => {
    setIsFlushing(true);
    try {
      const flushPromises: Promise<unknown>[] = [];
      for (const [, cardRef] of Array.from(cardRefs.current)) {
        const pending = cardRef.flushPending();
        if (pending) {
          flushPromises.push(
            new Promise<void>((resolve, reject) => {
              saveItemMutation.mutate(
                { nodeId: pending.nodeId, proposedTitle: pending.proposedTitle, direction: pending.direction },
                { onSuccess: () => resolve(), onError: (e) => reject(e) }
              );
            })
          );
        }
      }
      if (flushPromises.length > 0) {
        await Promise.all(flushPromises);
      }
      setLocation("/generate");
    } catch {
      toast.error("Failed to save notes — please try again.");
      setIsFlushing(false);
    }
  }, [saveItemMutation, setLocation]);

  if (userLoading || bizLoading) {
    return (
      <DashboardLayout>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", minHeight:400 }}>
          <Loader2 style={{ width:32, height:32, color:"#6e5afe" }} className="animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (!user || !business) return null;

  const isLoading = generatePlanMutation.isPending || planItems === null;
  const isStartDisabled = isLoading || isFlushing;

  return (
    <DashboardLayout>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
        {/* Stage stepper */}
        <StageStepper currentStage={currentStage} />

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 32px", background:"#faf9f5" }}>
          {/* Page header */}
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:28 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", color:"#9ca3af", marginBottom:6 }}>
                Stage 3 · Content Plan
              </div>
              <h1 style={{ fontSize:28, fontWeight:800, color:"#1a1a2e", lineHeight:1.2, margin:0 }}>
                Your content plan
              </h1>
              <p style={{ fontSize:14, color:"#6b7280", marginTop:8, maxWidth:520 }}>
                Here's what we're going to write. Edit any title or add direction before we start.
              </p>
            </div>
            <div style={{ flexShrink:0, marginTop:4 }}>
              <button
                className="btn-primary"
                onClick={handleStartGenerating}
                disabled={isStartDisabled}
                style={{ display:"flex", alignItems:"center", gap:8 }}
              >
                {isFlushing
                  ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Saving your notes…</>
                  : isLoading
                  ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Planning…</>
                  : <><Zap style={{ width:14, height:14 }} /> Start generating <ArrowRight style={{ width:14, height:14 }} /></>
                }
              </button>
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, padding:"12px 16px", background:"#f5f3ff", borderRadius:10, border:"1px solid #ede9ff" }}>
                <Loader2 style={{ width:16, height:16, color:"#6e5afe" }} className="animate-spin" />
                <span style={{ fontSize:13, color:"#6e5afe", fontWeight:500 }}>Planning your content…</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {[1,2,3].map((i) => <SkeletonCard key={i} />)}
              </div>
            </>
          )}

          {/* Plan cards */}
          {!isLoading && planItems && (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {planItems.map((item) => (
                <ArticleCard
                  key={item.nodeId}
                  ref={(el) => {
                    if (el) cardRefs.current.set(item.nodeId, el);
                    else cardRefs.current.delete(item.nodeId);
                  }}
                  item={item}
                  onSave={handleSave}
                />
              ))}
            </div>
          )}

          {/* Bottom CTA */}
          {!isLoading && planItems && planItems.length > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:28, paddingTop:20, borderTop:"1px solid #e5e7eb" }}>
              <button
                className="btn-ghost"
                onClick={() => setLocation("/keywords")}
                style={{ fontSize:13 }}
              >
                ← Back to keywords
              </button>
              <button
                className="btn-primary"
                onClick={handleStartGenerating}
                disabled={isStartDisabled}
                style={{ display:"flex", alignItems:"center", gap:8 }}
              >
                {isFlushing
                  ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Saving your notes…</>
                  : <><Zap style={{ width:14, height:14 }} /> Start generating {planItems.length} articles <ArrowRight style={{ width:14, height:14 }} /></>
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
