/**
 * Stage 3 — Keyword Research
 * Matches the BlogBatcher mockup: light cream theme, horizontal stage stepper,
 * serif italic heading, table with Level/Title/Keyword/MSV/Competition/Status/Actions
 */
import { useActiveBusiness } from "@/contexts/BusinessContext";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw, ArrowRight, Sparkles, BarChart2,
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ─────────────────────────────────────────────── */
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

/* ─── Helpers ────────────────────────────────────────────── */
function deriveNodeLabel(rows: KwRow[], row: KwRow): string {
  if (row.nodeLevel === "cornerstone") {
    const cs = rows.filter(r => r.nodeLevel === "cornerstone").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    return `Cornerstone ${cs.findIndex(r => r.articleNodeId === row.articleNodeId) + 1}`;
  }
  if (row.nodeLevel === "pillar") {
    const ps = rows.filter(r => r.nodeLevel === "pillar").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    const pNum = ps.findIndex(r => r.articleNodeId === row.articleNodeId) + 1;
    // Standalone pillar (no parent cornerstone)
    if (!row.nodeParentCornerstoneId) return `Pillar ${pNum}`;
    const cs = rows.filter(r => r.nodeLevel === "cornerstone").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    const cIdx = cs.findIndex(r => r.articleNodeId === row.nodeParentCornerstoneId);
    const psUnderC = rows.filter(r => r.nodeLevel === "pillar" && r.nodeParentCornerstoneId === row.nodeParentCornerstoneId).sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    return `Pillar ${cIdx + 1}.${psUnderC.findIndex(r => r.articleNodeId === row.articleNodeId) + 1}`;
  }
  // Cluster
  const allClusters = rows.filter(r => r.nodeLevel === "cluster").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
  const clNum = allClusters.findIndex(r => r.articleNodeId === row.articleNodeId) + 1;
  // Fully standalone cluster (no cornerstone, no pillar)
  if (!row.nodeParentCornerstoneId && !row.nodeParentPillarId) return `Post ${clNum}`;
  // Standalone cluster under a standalone pillar
  if (!row.nodeParentCornerstoneId) {
    const ps = rows.filter(r => r.nodeLevel === "pillar").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    const pIdx = ps.findIndex(r => r.articleNodeId === row.nodeParentPillarId);
    const cl = rows.filter(r => r.nodeLevel === "cluster" && r.nodeParentPillarId === row.nodeParentPillarId).sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
    return `Cluster ${pIdx + 1}.${cl.findIndex(r => r.articleNodeId === row.articleNodeId) + 1}`;
  }
  // Full hierarchy cluster
  const cs = rows.filter(r => r.nodeLevel === "cornerstone").sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
  const cIdx = cs.findIndex(r => r.articleNodeId === row.nodeParentCornerstoneId);
  const ps = rows.filter(r => r.nodeLevel === "pillar" && r.nodeParentCornerstoneId === row.nodeParentCornerstoneId).sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
  const pIdx = ps.findIndex(r => r.articleNodeId === row.nodeParentPillarId);
  const cl = rows.filter(r => r.nodeLevel === "cluster" && r.nodeParentPillarId === row.nodeParentPillarId).sort((a,b) => a.nodeSortOrder - b.nodeSortOrder);
  return `Cluster ${cIdx + 1}.${pIdx + 1}.${cl.findIndex(r => r.articleNodeId === row.articleNodeId) + 1}`;
}

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
  // null means either 'low' from DataForSEO or Claude-assigned (no data) — show Low
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:"#16a34a", fontWeight:600 }}>
      <BarChart2 style={{ width:13, height:13 }} /> Low
    </span>
  );
}

function StatusBadge({ approved }: { approved: boolean }) {
  if (approved) return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:"#dcfce7", color:"#166534" }}>
      <CheckCircle2 style={{ width:11, height:11 }} /> Approved
    </span>
  );
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:600, background:"#f3f4f6", color:"#6b7280" }}>
      Pending
    </span>
  );
}

/* ─── Swap Modal ─────────────────────────────────────────── */
type SavedSelection = { id: number; keyword: string; msv: number | null; competitionLevel: string | null; cpc: number | null; seedKeyword: string | null; assignedNodeId: number | null; assignedLabel: string | null; isAssigned: boolean; };

function SwapModal({ open, onClose, businessId, kwRow, onSwapped, isConflict, savedSelections, pendingSwapKw, onClearPendingSwapKw }: {
  open: boolean; onClose: () => void; businessId: number; kwRow: KwRow | null; onSwapped: () => void; isConflict?: boolean;
  savedSelections?: SavedSelection[];
  pendingSwapKw?: string | null;
  onClearPendingSwapKw?: () => void;
}) {
  const [manualKw, setManualKw] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Drag state
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset position when modal opens
  useEffect(() => {
    if (open) { setPos(null); setSelected(null); setManualKw(""); }
  }, [open]);

  // When a pendingSwapKw is passed in (from the selection panel), pre-select it
  useEffect(() => {
    if (pendingSwapKw) {
      setSelected(pendingSwapKw);
      setManualKw("");
      onClearPendingSwapKw?.();
    }
  }, [pendingSwapKw, onClearPendingSwapKw]);

  const suggestions = trpc.keywords.getSuggestions.useQuery(
    { businessId, keyword: kwRow?.primaryKeyword ?? "" },
    { enabled: open && !!kwRow }
  );
  const swapMutation = trpc.keywords.swap.useMutation({
    onSuccess: () => { toast.success("Keyword swapped"); onSwapped(); onClose(); },
    onError: (err) => toast.error(err.message),
  });
  const handleSwap = () => {
    if (!kwRow) return;
    const kw = selected ?? manualKw.trim();
    if (!kw) { toast.error("Please select or enter a keyword"); return; }
    swapMutation.mutate({ businessId, keywordId: kwRow.id, newKeyword: kw });
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only drag on the header bar itself, not on buttons inside it
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  if (!open) return null;

  // Compute panel style: centred by default, dragged position when moved
  const panelStyle: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, transform: "none", zIndex: 9999 }
    : { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 9999 };

  return (
    <>
      {/* Backdrop — clicking it closes the modal */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9998 }}
        onClick={onClose}
      />
      {/* Draggable panel */}
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
          userSelect: dragging.current ? "none" : "auto",
        }}
      >
        {/* Draggable header */}
        <div
          onMouseDown={onMouseDown}
          style={{
            padding: "16px 20px 14px",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
            cursor: "grab",
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>Swap Keyword</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                Replace <strong style={{ color: "#1a1a2e" }}>{kwRow?.primaryKeyword}</strong> with a different keyword.
              </p>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#9ca3af", lineHeight: 1, fontSize: 18 }}
              title="Close"
            >
              ✕
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#9ca3af", display: "flex", alignItems: "center", gap: 4 }}>
            <span>⠿</span> Drag this panel to reposition it
          </p>
          {isConflict && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, padding:"8px 12px", background:"#fffbeb", border:"1px solid #fde68a", borderRadius:8, fontSize:12, color:"#92400e" }}>
              <AlertTriangle style={{ width:13, height:13, color:"#d97706", flexShrink:0 }} />
              <span><strong>Cannibalization conflict</strong> — this keyword overlaps with another article. Swap it to resolve.</span>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 24px", display:"flex", flexDirection:"column", gap:16 }}>
          {/* Saved selections from Step 8 — shown first as primary option */}
          {(savedSelections?.filter(s => s.keyword !== kwRow?.primaryKeyword) ?? []).length > 0 && (
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", marginBottom:4 }}>Your saved keywords</p>
              <p style={{ fontSize:11, color:"#9ca3af", margin:"0 0 8px" }}>From your Step 8 selections — real MSV data included</p>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {savedSelections!.filter(s => s.keyword !== kwRow?.primaryKeyword).map(s => (
                  <button key={s.id} onClick={() => { setSelected(s.keyword); setManualKw(""); }}
                    style={{ textAlign:"left", padding:"9px 14px", borderRadius:8, border: selected === s.keyword ? "1.5px solid #6e5afe" : "1px solid #e5e7eb", background: selected === s.keyword ? "#ede9ff" : s.isAssigned ? "#f9fafb" : "#fff", cursor:"pointer", transition:"all 160ms", opacity: s.isAssigned ? 0.6 : 1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", flex:1 }}>{s.keyword}</span>
                      {s.isAssigned && <span style={{ fontSize:10, color:"#9ca3af", background:"#f3f4f6", padding:"1px 5px", borderRadius:3 }}>Used: {s.assignedLabel}</span>}
                    </div>
                    <span style={{ fontSize:11, color:"#9ca3af" }}>
                      {s.msv !== null ? `${s.msv.toLocaleString()} MSV` : "MSV n/a"}
                      {s.competitionLevel ? ` · ${s.competitionLevel} comp` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {suggestions.isLoading && (
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#9ca3af" }}>
              <Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Fetching DataForSEO suggestions…
            </div>
          )}
          {!suggestions.isLoading && (suggestions.data?.length ?? 0) > 0 && (
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", marginBottom:8 }}>DataForSEO Suggestions</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {suggestions.data?.map(s => (
                  <button key={s.keyword} onClick={() => { setSelected(s.keyword); setManualKw(""); }}
                    style={{ textAlign:"left", padding:"10px 14px", borderRadius:8, border: selected === s.keyword ? "1.5px solid #6e5afe" : "1px solid #e5e7eb", background: selected === s.keyword ? "#ede9ff" : "#fff", cursor:"pointer", transition:"all 160ms" }}>
                    <span style={{ fontSize:13, fontWeight:600, color:"#1a1a2e" }}>{s.keyword}</span>
                    <span style={{ fontSize:12, color:"#9ca3af", marginLeft:8 }}>
                      {s.msv !== null ? `${s.msv.toLocaleString()} MSV` : "MSV n/a"}
                      {s.competition ? ` · ${s.competition} comp` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!suggestions.isLoading && (suggestions.data?.length ?? 0) === 0 && (
            <p style={{ fontSize:12, color:"#9ca3af", margin:0 }}>No suggestions found — enter a keyword manually below.</p>
          )}
          <div>
            <p style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", marginBottom:6 }}>Or enter manually</p>
            <Input placeholder="Type a custom keyword…" value={manualKw}
              onChange={e => { setManualKw(e.target.value); setSelected(null); }} />
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{ padding:"14px 24px", borderTop:"1px solid #e5e7eb", flexShrink:0, display:"flex", gap:8, justifyContent:"flex-end", background:"#fff" }}>
          {selected && (
            <span style={{ fontSize:12, color:"#6b7280", alignSelf:"center", marginRight:"auto" }}>
              Selected: <strong style={{ color:"#1a1a2e" }}>{selected}</strong>
            </span>
          )}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSwap} disabled={swapMutation.isPending}>
            {swapMutation.isPending ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Swapping…</> : "Confirm Swap"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Main component ─────────────────────────────────────── */
export default function Keywords() {
  const { user, loading: userLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [subStage, setSubStage] = useState<SubStage>("assign");
  const [swapTarget, setSwapTarget] = useState<KwRow | null>(null);

  const { activeBusiness: business, isLoading: bizLoading } = useActiveBusiness();
  const businessId = business?.id ?? 0;
  const currentStage = (business?.currentStage as number | undefined) ?? 1;

  const utils = trpc.useUtils();
  const { data: kwData, isLoading: kwLoading, refetch: refetchKw } = trpc.keywords.getAll.useQuery(
    { businessId },
    { enabled: !!businessId }
  );
  const { data: archData } = trpc.architecture.getOrCreate.useQuery(
    { businessId },
    { enabled: !!businessId, staleTime: 0 }
  );
  const { data: savedSelections, isLoading: savedSelectionsLoading } = trpc.keywords.getSavedSelections.useQuery(
    { businessId },
    { enabled: !!businessId }
  );
  const [showSelectionPanel, setShowSelectionPanel] = useState(false);
  const [pendingSwapKw, setPendingSwapKw] = useState<string | null>(null);
  // The saved keyword the user picks as the cornerstone subject (primary keyword).
  const [primarySelectionId, setPrimarySelectionId] = useState<number | null>(null);

  // Reset local state when the active business changes (belt-and-suspenders guard;
  // the primary protection is the key={selectedBizId} in App.tsx which remounts
  // this component entirely on business switch).
  useEffect(() => {
    setSubStage("assign");
    setSwapTarget(null);
    setShowSelectionPanel(false);
    setPendingSwapKw(null);
    setPrimarySelectionId(null);
  }, [businessId]);

  // Default the primary keyword to the user's first saved selection once loaded.
  useEffect(() => {
    if (primarySelectionId == null && savedSelections && savedSelections.length > 0) {
      setPrimarySelectionId(savedSelections[0].id);
    }
  }, [savedSelections, primarySelectionId]);

  // Article count comes directly from the DB article_nodes for this batch.
  // Architecture.confirm is the single source of truth — it always regenerates
  // nodes before locking, so this count is always correct.
  const nodeCount = archData?.nodes?.length ?? 0;

  // Auto-advance sub-stage based on data
  useMemo(() => {
    if (!kwData?.length) return;
    const allKwApproved = kwData.every(k => k.keywordApproved);
    const allPaaApproved = kwData.every(k => k.paaApproved);
    if (allPaaApproved) { setSubStage("complete"); return; }
    if (allKwApproved) { setSubStage("paa-review"); return; }
    if (kwData.some(k => k.primaryKeyword)) setSubStage("keyword-review");
  }, [kwData]);

  const assignMutation = trpc.keywords.assignAll.useMutation({
    onSuccess: async (data) => {
      toast.success(`${data.assigned} keywords assigned`);
      await utils.keywords.getAll.invalidate({ businessId });
      setSubStage("keyword-review");
    },
    onError: (err) => toast.error(err.message, { description: "Check your DataForSEO credentials in Settings.", duration: 8000 }),
  });
  const approveOne = trpc.keywords.approveOne.useMutation({
    onSuccess: async () => { await refetchKw(); },
    onError: (err) => toast.error(err.message),
  });
  const approveAll = trpc.keywords.approveAll.useMutation({
    onSuccess: async (data) => {
      toast.success(`Keywords approved`);
      await refetchKw();
      setSubStage("paa-review");
    },
    onError: (err) => toast.error(err.message, { description: "Resolve cannibalization conflicts first.", duration: 8000 }),
  });
  const fetchPAA = trpc.keywords.fetchPAA.useMutation({
    onSuccess: async (data) => { toast.success(`PAA fetched for ${data.fetched} keywords`); await refetchKw(); },
    onError: (err) => toast.error(err.message, { description: "Check your DataForSEO integration.", duration: 8000 }),
  });
  const retryPAA = trpc.keywords.retryPAA.useMutation({
    onSuccess: async (data) => {
      if (data.questionsFound > 0) {
        toast.success(`Found ${data.questionsFound} PAA question${data.questionsFound > 1 ? 's' : ''}`);
      } else {
        toast.info("No PAA questions found for this keyword — you can skip it.");
      }
      await refetchKw();
    },
    onError: (err) => toast.error(err.message),
  });
  const skipPAA = trpc.keywords.approvePAA.useMutation({
    onSuccess: async (data) => {
      toast.success("Skipped — article will proceed without a PAA subheading.");
      await refetchKw();
      if (data.stageAdvanced) { setSubStage("complete"); }
    },
    onError: (err) => toast.error(err.message),
  });
  const approvePAA = trpc.keywords.approvePAA.useMutation({
    onSuccess: async (data) => {
      await refetchKw();
      if (data.stageAdvanced) { toast.success("All PAA approved! Moving to Article Generation."); setSubStage("complete"); }
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Client-side cannibalization detection ──────────────────────────────────
  // Re-derive conflicts live from the current kwData so highlighting is always
  // accurate without waiting for a server approveAll round-trip.
  // Uses Jaccard similarity >= 0.75 to match the server-side threshold.
  const computeConflicts = useCallback((rows: KwRow[] | undefined) => {
    if (!rows || rows.length === 0) return new Set<number>();
    const normalise = (kw: string) => kw.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const STOP = new Set(["a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","how","what","when","where","why","who","which","that","this","these","those","your","our","my","their","its","all","any","some","no","not","vs","get","make","use","using","used"]);
    const tokenArr = (kw: string) => normalise(kw).split(" ").filter(t => t.length > 1 && !STOP.has(t));
    const jaccard = (a: string[], b: string[]) => {
      if (a.length === 0 || b.length === 0) return 0;
      const setA = new Set(a); const setB = new Set(b);
      let inter = 0;
      a.forEach(t => { if (setB.has(t)) inter++; });
      const union = setA.size + setB.size - inter;
      return union === 0 ? 0 : inter / union;
    };
    const conflictIds = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!; const b = rows[j]!;
        const nA = normalise(a.primaryKeyword); const nB = normalise(b.primaryKeyword);
        if (nA === nB) { conflictIds.add(a.articleNodeId); conflictIds.add(b.articleNodeId); continue; }
        const tA = tokenArr(a.primaryKeyword); const tB = tokenArr(b.primaryKeyword);
        if (jaccard(tA, tB) >= 0.75) { conflictIds.add(a.articleNodeId); conflictIds.add(b.articleNodeId); }
      }
    }
    return conflictIds;
  }, []);
  const liveConflictNodeIds = useMemo(() => computeConflicts(kwData), [kwData, computeConflicts]);
  const cannibalizationConflicts = useMemo(() => kwData?.filter(k => liveConflictNodeIds.has(k.articleNodeId)) ?? [], [kwData, liveConflictNodeIds]);
  const allKwApproved = useMemo(() => (kwData?.length ?? 0) > 0 && kwData!.every(k => k.keywordApproved), [kwData]);
  const allPaaFetched = useMemo(() => (kwData?.length ?? 0) > 0 && kwData!.every(k => { const q = k.paaQuestions as string[]|null; return q && q.length > 0; }), [kwData]);
  const allPaaApproved = useMemo(() => (kwData?.length ?? 0) > 0 && kwData!.every(k => k.paaApproved), [kwData]);
  const approvedCount = useMemo(() => kwData?.filter(k => k.keywordApproved).length ?? 0, [kwData]);
  const paaApprovedCount = useMemo(() => kwData?.filter(k => k.paaApproved).length ?? 0, [kwData]);
  const totalCount = nodeCount;

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

  /* ── Assign sub-stage ── */
  const renderAssign = () => (
    <div style={{ maxWidth:600 }}>
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"#ede9ff", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Sparkles style={{ width:18, height:18, color:"#6e5afe" }} />
          </div>
          <h2 style={{ fontSize:16, fontWeight:700, color:"#1a1a2e", margin:0 }}>Auto-Assign Keywords</h2>
        </div>
        <p style={{ fontSize:13, color:"#6b7280", lineHeight:1.6, marginBottom:20 }}>
          Blog Batcher will assign one primary keyword to every article slot using real DataForSEO data from your keyword seeds (Stage 1 → Step 8). If you haven’t set keyword seeds yet, go back and complete that step first for best results. You can swap any keyword after assignment.
        </p>
        <div style={{ background:"#faf9f5", border:"1px solid #e5e7eb", borderRadius:8, padding:"14px 16px", marginBottom:20, fontSize:13, color:"#6b7280", display:"flex", flexDirection:"column", gap:4 }}>
          <div><span style={{ fontWeight:600, color:"#1a1a2e" }}>Business:</span> {business.name}</div>
          <div><span style={{ fontWeight:600, color:"#1a1a2e" }}>Location:</span> {(business.location as string | undefined) ?? "—"}</div>
          <div><span style={{ fontWeight:600, color:"#1a1a2e" }}>Industry:</span> {(business.industry as string | undefined) ?? "—"}</div>
        </div>

        {/* Cornerstone primary-keyword picker */}
        {(savedSelections?.length ?? 0) > 0 && (
          <div style={{ marginBottom:20 }}>
            <label style={{ display:"block", fontSize:13, fontWeight:600, color:"#1a1a2e", marginBottom:6 }}>
              Cornerstone keyword (your primary subject)
            </label>
            <p style={{ fontSize:12, color:"#6b7280", margin:"0 0 8px", lineHeight:1.5 }}>
              This becomes the broad subject of your cornerstone article. Your other saved keywords fill the
              3 pillars (segments) and clusters (specific topics) beneath it.
            </p>
            <Select
              value={primarySelectionId != null ? String(primarySelectionId) : undefined}
              onValueChange={(v) => setPrimarySelectionId(Number(v))}
            >
              <SelectTrigger style={{ fontSize:13 }}>
                <SelectValue placeholder="Choose your cornerstone keyword…" />
              </SelectTrigger>
              <SelectContent>
                {(savedSelections ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.keyword}{s.msv != null ? ` · ${s.msv.toLocaleString()} MSV` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <button
          className="btn-primary"
          onClick={() => assignMutation.mutate({ businessId, primarySelectionId })}
          disabled={assignMutation.isPending}
        >
          {assignMutation.isPending ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Assigning…</> : <><Sparkles style={{ width:14, height:14 }} /> Assign Keywords</>}
        </button>
      </div>
    </div>
  );

  /* ── Selected Keywords Panel ── */
  const renderSelectionPanel = () => {
    const unassigned = (savedSelections ?? []).filter(s => !s.isAssigned);
    const assigned = (savedSelections ?? []).filter(s => s.isAssigned);
    return (
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", borderBottom:"1px solid #e5e7eb", background:"#faf9f5" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <BarChart2 style={{ width:16, height:16, color:"#6e5afe" }} />
            <h3 style={{ fontSize:14, fontWeight:700, color:"#1a1a2e", margin:0 }}>Your Selected Keywords</h3>
            <span style={{ fontSize:11, background:"#ede9ff", color:"#6e5afe", padding:"2px 8px", borderRadius:20, fontWeight:600 }}>
              {(savedSelections ?? []).length} total
            </span>
          </div>
          <span style={{ fontSize:12, color:"#9ca3af" }}>
            <span style={{ color:"#22c55e", fontWeight:600 }}>{assigned.length}</span> assigned · <span style={{ color:"#f59e0b", fontWeight:600 }}>{unassigned.length}</span> unassigned
          </span>
        </div>
        {savedSelectionsLoading ? (
          <div style={{ padding:24, textAlign:"center" }}><Loader2 style={{ width:18, height:18, color:"#6e5afe" }} className="animate-spin" /></div>
        ) : (savedSelections ?? []).length === 0 ? (
          <div style={{ padding:"20px 24px", fontSize:13, color:"#9ca3af" }}>
            No keywords saved from Step 8 yet. Go back to Keyword Research (Stage 1 → Step 8) to select and save keywords.
          </div>
        ) : (
          <div style={{ padding:"12px 20px", display:"flex", flexDirection:"column", gap:4, maxHeight:320, overflowY:"auto" }}>
            {unassigned.length > 0 && (
              <>
                <p style={{ fontSize:11, fontWeight:600, color:"#f59e0b", textTransform:"uppercase", letterSpacing:"0.06em", margin:"4px 0 6px" }}>Unassigned — click to swap onto an article</p>
                {unassigned.map(s => (
                  <div key={s.id}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8, border:"1px solid #fde68a", background:"#fffbeb", cursor:"pointer" }}
                    onClick={() => {
                      // Pre-fill swap modal with this keyword
                      setSwapTarget(null); // clear first
                      setPendingSwapKw(s.keyword);
                    }}
                    title="Click to use this keyword in a swap"
                  >
                    <span style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", flex:1 }}>{s.keyword}</span>
                    <span style={{ fontSize:11, color:"#9ca3af", whiteSpace:"nowrap" }}>
                      {s.msv !== null ? `${s.msv.toLocaleString()} MSV` : "MSV n/a"}
                      {s.competitionLevel ? ` · ${s.competitionLevel} comp` : ""}
                    </span>
                    <span style={{ fontSize:11, color:"#f59e0b", fontWeight:600, background:"#fef3c7", padding:"2px 6px", borderRadius:4 }}>Unassigned</span>
                  </div>
                ))}
              </>
            )}
            {assigned.length > 0 && (
              <>
                <p style={{ fontSize:11, fontWeight:600, color:"#22c55e", textTransform:"uppercase", letterSpacing:"0.06em", margin:"8px 0 6px" }}>Assigned</p>
                {assigned.map(s => (
                  <div key={s.id}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:8, border:"1px solid #d1fae5", background:"#f0fdf4" }}
                  >
                    <span style={{ fontSize:13, fontWeight:600, color:"#1a1a2e", flex:1 }}>{s.keyword}</span>
                    <span style={{ fontSize:11, color:"#9ca3af", whiteSpace:"nowrap" }}>
                      {s.msv !== null ? `${s.msv.toLocaleString()} MSV` : "MSV n/a"}
                      {s.competitionLevel ? ` · ${s.competitionLevel} comp` : ""}
                    </span>
                    <span style={{ fontSize:11, color:"#15803d", fontWeight:600, background:"#dcfce7", padding:"2px 6px", borderRadius:4 }}>
                      {s.assignedLabel ?? "Assigned"}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ── Keyword Review sub-stage ── */
  const renderKeywordReview = () => (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Architecture is the single source of truth — no mismatch banner needed */}
      {/* Cannibalization warning */}
      {cannibalizationConflicts.length > 0 && (
        <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"12px 16px", display:"flex", gap:10 }}>
          <AlertTriangle style={{ width:16, height:16, color:"#d97706", flexShrink:0, marginTop:2 }} />
          <div>
            <p style={{ fontSize:13, fontWeight:600, color:"#92400e", margin:"0 0 4px" }}>Keyword cannibalization detected</p>
            <p style={{ fontSize:12, color:"#78350f", margin:0 }}>
              {cannibalizationConflicts.length} keyword{cannibalizationConflicts.length > 1 ? "s" : ""} may compete with each other. Swap one to resolve.
            </p>
          </div>
        </div>
      )}

      {/* Tip banner */}
      <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"10px 16px", display:"flex", gap:10, alignItems:"flex-start" }}>
        <span style={{ fontSize:14, flexShrink:0 }}>💡</span>
        <p style={{ fontSize:12, color:"#78350f", margin:0, lineHeight:1.6 }}>
          Aim for a mix of competition levels. A few <strong>high-volume cornerstones</strong> plus easy-win clusters ranks faster than chasing only the big terms.
        </p>
      </div>

      {/* Table */}
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", borderBottom:"1px solid #e5e7eb" }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:"#1a1a2e", margin:0 }}>Proposed articles</h3>
          <span style={{ fontSize:12, color:"#9ca3af" }}>{approvedCount} / {totalCount} approved</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:"#faf9f5" }}>
                {["Level", "Article title", "Keyword", "MSV", "Competition", "Status", ""].map(h => (
                  <th key={h} style={{ textAlign:"left", padding:"10px 16px", fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kwLoading ? (
                <tr><td colSpan={7} style={{ textAlign:"center", padding:32 }}>
                  <Loader2 style={{ width:20, height:20, color:"#6e5afe" }} className="animate-spin" />
                </td></tr>
              ) : kwData?.map(kw => {
                const isConflict = liveConflictNodeIds.has(kw.articleNodeId);
                return (
                <tr key={kw.id} style={{ borderBottom:"1px solid #f3f4f6", background: isConflict ? "#fffbeb" : "transparent" }}>
                  <td style={{ padding:"12px 16px" }}><LevelBadge level={kw.nodeLevel} /></td>
                  <td style={{ padding:"12px 16px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      {isConflict && <AlertTriangle style={{ width:13, height:13, color:"#d97706", flexShrink:0 }} />}
                      <span style={{ fontSize:13, fontWeight:500, color:"#1a1a2e" }}>
                        {kwData ? deriveNodeLabel(kwData, kw) : "—"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding:"12px 16px" }}>
                    <span style={{ fontSize:12, fontFamily:"monospace", color:"#6b7280", background:"#f3f4f6", padding:"2px 6px", borderRadius:4 }}>{kw.primaryKeyword}</span>
                  </td>
                  <td style={{ padding:"12px 16px", fontSize:13, fontWeight:600, color: kw.monthlySearchVolume && kw.monthlySearchVolume >= 1000 ? "#16a34a" : "#6b7280" }}>
                    {kw.monthlySearchVolume !== null ? kw.monthlySearchVolume.toLocaleString() : "—"}
                  </td>
                  <td style={{ padding:"12px 16px" }}><CompBadge comp={kw.competitionLevel} /></td>
                  <td style={{ padding:"12px 16px" }}><StatusBadge approved={kw.keywordApproved} /></td>
                  <td style={{ padding:"12px 16px" }}>
                    <div style={{ display:"flex", gap:6 }}>
                      <button className="btn-ghost" style={{ padding:"5px 12px", fontSize:12 }} onClick={() => setSwapTarget(kw)}>Swap</button>
                      {!kw.keywordApproved && (
                        <button className="btn-primary" style={{ padding:"5px 12px", fontSize:12 }}
                          onClick={() => approveOne.mutate({ businessId, keywordId: kw.id })}
                          disabled={approveOne.isPending}>
                          Approve
                        </button>
                      )}
                      {kw.keywordApproved && (
                        <button className="btn-ghost" style={{ padding:"5px 12px", fontSize:12 }}
                          onClick={() => approveOne.mutate({ businessId, keywordId: kw.id })}>
                          Undo
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );})
            }
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom actions */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button className="btn-ghost" onClick={() => setLocation("/architecture")}>← Back to architecture</button>
          <button
            className="btn-ghost"
            style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"#6b7280" }}
            onClick={() => {
              if (window.confirm("Re-assign all keywords? This will replace the current keywords, anchoring the cornerstone to your chosen primary keyword.")) {
                assignMutation.mutate({ businessId, primarySelectionId });
              }
            }}
            disabled={assignMutation.isPending}
            title="Re-run keyword assignment with updated business context"
          >
            {assignMutation.isPending
              ? <><Loader2 style={{ width:12, height:12 }} className="animate-spin" /> Re-assigning…</>
              : <><RefreshCw style={{ width:12, height:12 }} /> Re-assign keywords</>}
          </button>
        </div>
        {allKwApproved && (
          <button className="btn-primary" onClick={() => {
            setSubStage("paa-review");
            if (!allPaaFetched) fetchPAA.mutate({ businessId });
          }}>
            Generate {totalCount} articles <ArrowRight style={{ width:14, height:14 }} />
          </button>
        )}
        {!allKwApproved && (
          <button className="btn-primary" onClick={() => approveAll.mutate({ businessId })} disabled={approveAll.isPending || cannibalizationConflicts.length > 0}>
            {approveAll.isPending ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Approving…</> : "Approve all"}
          </button>
        )}
      </div>
    </div>
  );

  /* ── PAA Review sub-stage ── */
  const renderPAAReview = () => (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {fetchPAA.isPending && (
        <div style={{ background:"#ede9ff", border:"1px solid #c4b5fd", borderRadius:10, padding:"12px 16px", display:"flex", gap:10, alignItems:"center", fontSize:13, color:"#6e5afe" }}>
          <Loader2 style={{ width:14, height:14 }} className="animate-spin" />
          Fetching People Also Ask questions from DataForSEO…
        </div>
      )}
      <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden" }}>
        <div style={{ padding:"14px 20px", borderBottom:"1px solid #e5e7eb" }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:"#1a1a2e", margin:0 }}>People Also Ask</h3>
          <p style={{ fontSize:12, color:"#9ca3af", margin:"4px 0 0" }}>Select one PAA question per article to use as an H2 subheading</p>
        </div>
        <div style={{ padding:20, display:"flex", flexDirection:"column", gap:16 }}>
          {kwData?.map(kw => {
            const questions = (kw.paaQuestions as string[] | null) ?? [];
            // Determine if questions are AI-generated (heuristic: no DataForSEO data = AI fallback)
            // We tag them as AI-generated when the keyword has no MSV data (Claude-assigned) OR
            // we just show a neutral badge — the source is logged server-side
            const firstQ = questions[0] ?? null;
            // Auto-select the first question if none is selected yet and questions exist
            const currentValue = kw.approvedPaaQuestion ?? "";
            const displayValue = currentValue || (firstQ ?? "");
            return (
              <div key={kw.id} style={{ background:"#faf9f5", border:"1px solid #e5e7eb", borderRadius:10, padding:16 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" }}>
                  <LevelBadge level={kw.nodeLevel} />
                  <span style={{ fontSize:13, fontWeight:600, color:"#1a1a2e" }}>{kw.primaryKeyword}</span>
                  {questions.length > 0 && !kw.paaApproved && firstQ && (
                    <span style={{ fontSize:10, background:"#fef3c7", color:"#92400e", padding:"2px 7px", borderRadius:20, fontWeight:600, marginLeft:"auto" }}>
                      Top suggestion pre-selected
                    </span>
                  )}
                  {kw.paaApproved && <CheckCircle2 style={{ width:14, height:14, color:"#22c55e", marginLeft:"auto" }} />}
                </div>
                {questions.length === 0 ? (
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <p style={{ fontSize:12, color:"#9ca3af", margin:0, flex:1 }}>Generating PAA questions — click Retry to fetch from DataForSEO or generate with AI.</p>
                    <button
                      onClick={() => retryPAA.mutate({ businessId, keywordId: kw.id })}
                      disabled={retryPAA.isPending && retryPAA.variables?.keywordId === kw.id}
                      style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #c4b5fd", background:"#ede9ff", color:"#6e5afe", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                    >
                      {retryPAA.isPending && retryPAA.variables?.keywordId === kw.id
                        ? <><Loader2 style={{ width:11, height:11 }} className="animate-spin" /> Generating…</>
                        : <><RefreshCw style={{ width:11, height:11 }} /> Retry / Generate</>}
                    </button>
                    <button
                      onClick={() => skipPAA.mutate({ businessId, keywordId: kw.id, approvedQuestion: "__skip__" })}
                      disabled={skipPAA.isPending && skipPAA.variables?.keywordId === kw.id}
                      style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 12px", borderRadius:6, border:"1px solid #e5e7eb", background:"#fff", color:"#6b7280", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
                    >
                      {skipPAA.isPending && skipPAA.variables?.keywordId === kw.id
                        ? <><Loader2 style={{ width:11, height:11 }} className="animate-spin" /> Skipping…</>
                        : "Skip"}
                    </button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <Select
                      value={displayValue}
                      onValueChange={q => approvePAA.mutate({ businessId, keywordId: kw.id, approvedQuestion: q })}
                    >
                      <SelectTrigger style={{ fontSize:13 }}>
                        <SelectValue placeholder="Choose a PAA question…" />
                      </SelectTrigger>
                      <SelectContent>
                        {questions.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {/* Auto-approve the first question if nothing is selected yet */}
                    {!kw.paaApproved && firstQ && displayValue === firstQ && (
                      <button
                        onClick={() => approvePAA.mutate({ businessId, keywordId: kw.id, approvedQuestion: firstQ })}
                        style={{ alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:5, padding:"4px 12px", borderRadius:6, border:"1px solid #bbf7d0", background:"#f0fdf4", color:"#166534", fontSize:12, fontWeight:600, cursor:"pointer" }}
                      >
                        <CheckCircle2 style={{ width:11, height:11 }} /> Lock in top suggestion
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* Sticky bottom bar — always visible in PAA review */}
      <div style={{ position:"sticky", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #e5e7eb", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:10, borderRadius:"0 0 12px 12px" }}>
        <span style={{ fontSize:13, color:"#6b7280", fontWeight:500 }}>
          {paaApprovedCount} of {totalCount} PAA questions selected
        </span>
        {!allPaaFetched ? (
          <button
            disabled
            style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"8px 20px", borderRadius:8, background:"#e5e7eb", color:"#9ca3af", fontSize:13, fontWeight:600, cursor:"not-allowed", border:"none" }}
          >
            Generate PAA questions first
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={approvePAA.isPending || skipPAA.isPending}
            onClick={async () => {
              // Wait for any in-flight approvePAA / skipPAA mutations to settle
              // before navigating so the DB reflects the latest selection.
              if (approvePAA.isPending || skipPAA.isPending) {
                await new Promise<void>(resolve => {
                  const check = setInterval(() => {
                    if (!approvePAA.isPending && !skipPAA.isPending) {
                      clearInterval(check);
                      resolve();
                    }
                  }, 50);
                });
              }
              setLocation("/content-plan");
            }}
            style={{ display:"inline-flex", alignItems:"center", gap:6, opacity: (approvePAA.isPending || skipPAA.isPending) ? 0.7 : 1 }}
          >
            {(approvePAA.isPending || skipPAA.isPending)
              ? <><Loader2 style={{ width:13, height:13 }} className="animate-spin" /> Saving…</>
              : <>Save &amp; continue to content plan <ArrowRight style={{ width:14, height:14 }} /></>}
          </button>
        )}
      </div>
    </div>
  );

  /* ── Complete sub-stage ── */
  const renderComplete = () => (
    <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:48, textAlign:"center" }}>
      <CheckCircle2 style={{ width:48, height:48, color:"#22c55e", margin:"0 auto 16px" }} />
      <h2 style={{ fontSize:20, fontWeight:700, color:"#1a1a2e", marginBottom:8 }}>Stage 3 Complete</h2>
      <p style={{ fontSize:13, color:"#6b7280", maxWidth:360, margin:"0 auto 24px" }}>
        All keywords and PAA questions are approved. Your articles are ready for generation.
      </p>
      <button className="btn-primary" onClick={() => setLocation("/content-plan")}>
        Plan your content <ArrowRight style={{ width:14, height:14 }} />
      </button>
    </div>
  );

  return (
    <DashboardLayout>
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
        {/* Stage stepper */}
        <StageStepper currentStage={currentStage} />

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 32px", background:"#faf9f5" }}>
          {/* Page header */}
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", color:"#9ca3af", marginBottom:6 }}>
                Stage 3 · Keyword Research
              </div>
              <h1 style={{ fontSize:32, fontWeight:800, color:"#1a1a2e", lineHeight:1.15, margin:0 }}>
                Lock the keywords <em style={{ fontFamily:"Lora, Georgia, serif", fontStyle:"italic", fontWeight:600 }}>worth</em> ranking for.
              </h1>
              <p style={{ fontSize:14, color:"#6b7280", marginTop:8 }}>
                {approvedCount} of {totalCount} approved. Swap any that don't fit — then generate the batch.
              </p>
            </div>
            {subStage === "keyword-review" && allKwApproved && (
              <button className="btn-primary" style={{ flexShrink:0, marginTop:4 }}
                onClick={() => { setSubStage("paa-review"); if (!allPaaFetched) fetchPAA.mutate({ businessId }); }}>
                Generate {totalCount} articles
              </button>
            )}
            {subStage === "keyword-review" && !allKwApproved && (
              <div style={{ display:"flex", gap:8, flexShrink:0, marginTop:4 }}>
                <button className="btn-ghost">Filter</button>
                <button className="btn-primary"
                  onClick={() => approveAll.mutate({ businessId })}
                  disabled={approveAll.isPending || cannibalizationConflicts.length > 0}>
                  {approveAll.isPending ? "Approving…" : `Generate ${totalCount} articles`}
                </button>
              </div>
            )}
          </div>

          {/* Sub-stage content */}
          {subStage === "assign" && renderAssign()}
          {subStage === "keyword-review" && (
            <>
              {/* Selection panel — always visible when there are saved selections */}
              {(savedSelections !== undefined) && renderSelectionPanel()}
              {renderKeywordReview()}
            </>
          )}
          {subStage === "paa-review" && renderPAAReview()}
          {subStage === "complete" && renderComplete()}
        </div>
      </div>

      {/* Swap modal */}
      <SwapModal
        open={!!swapTarget}
        onClose={() => setSwapTarget(null)}
        businessId={businessId}
        kwRow={swapTarget}
        isConflict={swapTarget ? liveConflictNodeIds.has(swapTarget.articleNodeId) : false}
        onSwapped={async () => { await refetchKw(); await utils.keywords.getSavedSelections.invalidate({ businessId }); }}
        savedSelections={savedSelections}
        pendingSwapKw={pendingSwapKw}
        onClearPendingSwapKw={() => setPendingSwapKw(null)}
      />
    </DashboardLayout>
  );
}
