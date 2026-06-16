/**
 * Stage 4 — Article Generation
 * Matches BlogBatcher mockup: cream theme, stage stepper, serif italic heading,
 * KPI cards, batch table with level/title/keyword/status, progress indicators
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useActiveBusiness } from "@/contexts/BusinessContext";
import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { Loader2, Zap, CheckCircle2, Clock, AlertTriangle, BarChart2, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";

// Word count minimums per level (must match server)
const WORD_COUNT_MIN: Record<string, number> = {
  cornerstone: 2000,
  pillar: 1500,
  cluster: 800,
};

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

/* ─── Status badge ───────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; icon: React.ReactNode; label: string }> = {
    pending_generation: { bg:"#f3f4f6",  color:"#6b7280", icon:<Clock style={{ width:11, height:11 }} />,         label:"Queued" },
    generating:         { bg:"#ede9ff",  color:"#6e5afe", icon:<Loader2 style={{ width:11, height:11 }} className="animate-spin" />, label:"Generating…" },
    generated:          { bg:"#dbeafe",  color:"#1e40af", icon:<CheckCircle2 style={{ width:11, height:11 }} />,  label:"Draft ready" },
    pending_approval:   { bg:"#fef9c3",  color:"#854d0e", icon:<AlertTriangle style={{ width:11, height:11 }} />, label:"Needs review" },
    approved:           { bg:"#dbeafe",  color:"#1e40af", icon:<CheckCircle2 style={{ width:11, height:11 }} />,  label:"Approved" },
    scheduled:          { bg:"#ede9ff",  color:"#6e5afe", icon:<Clock style={{ width:11, height:11 }} />,         label:"Scheduled" },
    published:          { bg:"#dcfce7",  color:"#166534", icon:<CheckCircle2 style={{ width:11, height:11 }} />,  label:"Published" },
    failed:             { bg:"#fee2e2",  color:"#991b1b", icon:<AlertTriangle style={{ width:11, height:11 }} />, label:"Failed" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:600, background:s.bg, color:s.color }}>
      {s.icon} {s.label}
    </span>
  );
}

/* ─── SEO Score ring ─────────────────────────────────────── */
function ScoreRing({ score }: { score: number | null }) {
  if (!score) return <span style={{ color:"#9ca3af", fontSize:13 }}>—</span>;
  const color = score >= 80 ? "#22c55e" : score >= 65 ? "#6e5afe" : "#f59e0b";
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
      <div style={{ width:28, height:28, borderRadius:"50%", border:`2.5px solid ${color}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color }}>
        {score}
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────── */
export default function ArticleGeneration() {
  const { user, loading: userLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [generating, setGenerating] = useState(false);
  const [regenAllRunning, setRegenAllRunning] = useState(false);

  const { activeBusiness: business, isLoading: bizLoading } = useActiveBusiness();
  const businessId = business?.id ?? 0;
  const currentStage = (business?.currentStage as number | undefined) ?? 1;

  const { data: articles, isLoading: articlesLoading } = trpc.articles.getAll.useQuery(
    { businessId },
    { enabled: !!businessId, staleTime: 0, refetchInterval: generating ? 3000 : false }
  );

  // Fetch node count independently so we always know the total before articles are created
  const { data: nodeCountData } = trpc.architecture.getOrCreate.useQuery(
    { businessId },
    { enabled: !!businessId, staleTime: 0 }
  );

  const regenerateSingleMutation = trpc.articles.regenerate.useMutation({
    onSuccess: () => {
      toast.success("Regenerating article… this may take a minute.");
      setGenerating(true);
    },
    onError: (err) => toast.error(err.message),
  });

  const utils = trpc.useUtils();
  const markReadyMutation = trpc.articles.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Article moved to review — click Review to open it.");
      void utils.articles.getAll.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const regenUnderTargetMutation = trpc.articles.regenerateUnderTarget.useMutation({
    onSuccess: (data) => {
      if (data.queued === 0) {
        toast.success("All articles are already at or above their word count target.");
      } else {
        toast.success(`Regenerating ${data.queued} article${data.queued === 1 ? "" : "s"} below target…`);
        setRegenAllRunning(true);
        setGenerating(true);
      }
    },
    onError: (err) => { toast.error(err.message); },
  });

  const generateMutation = trpc.articles.startGeneration.useMutation({
    onSuccess: (data) => {
      toast.success(`Generating ${data.totalArticles} articles…`);
      setGenerating(true);
    },
    onError: (err) => { toast.error(err.message); setGenerating(false); },
  });

  // Stop polling once all articles are done
  useEffect(() => {
    if (!articles?.length) return;
    const allDone = articles.every(a => a.status !== "pending_generation" && a.status !== "generating");
    if (allDone) setGenerating(false);
  }, [articles]);

  // nodeTotal: how many article nodes exist for this batch (source of truth for expected count)
  const nodeTotal = nodeCountData?.nodes?.length ?? 0;
  // hasArticles: true only when actual article DB rows exist (not just nodes)
  const hasArticles = (articles?.length ?? 0) > 0;
  // totalCount: use actual article count when articles exist, else fall back to nodeTotal
  const totalCount = hasArticles ? articles!.length : nodeTotal;
  const writtenCount = articles?.filter(a => ["generated","pending_approval","approved","published","scheduled","failed"].includes(a.status)).length ?? 0;
  const failedCount = articles?.filter(a => a.status === "failed").length ?? 0;
  const scoredCount = articles?.filter(a => a.internalScore !== null).length ?? 0;
  const avgScore = scoredCount > 0
    ? Math.round(articles!.filter(a => a.internalScore !== null).reduce((s, a) => s + (a.internalScore ?? 0), 0) / scoredCount)
    : null;

  // allWritten: all articles are in a terminal state (no longer generating/pending)
  const allWritten = hasArticles && writtenCount === totalCount && !generating;
  // showGenerateButton: show when stage is 4+ and generation hasn't completed
  const showGenerateButton = currentStage >= 4 && !allWritten;

  // Count articles under their word count target
  const underTargetCount = articles?.filter(a => {
    if (a.status === "generating" || a.status === "approved") return false;
    const min = WORD_COUNT_MIN[a.level ?? "cluster"] ?? 800;
    return (a.wordCount ?? 0) < min && a.wordCount !== null && a.wordCount !== undefined;
  }).length ?? 0;

  // Stop regenAll polling once all are done
  useEffect(() => {
    if (!regenAllRunning) return;
    if (!articles?.length) return;
    const anyGenerating = articles.some(a => a.status === "generating" || a.status === "pending_generation");
    if (!anyGenerating) setRegenAllRunning(false);
  }, [articles, regenAllRunning]);

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
                Stage 4 · Article Generation
              </div>
              <h1 style={{ fontSize:32, fontWeight:800, color:"#1a1a2e", lineHeight:1.15, margin:0 }}>
                Your drafts, written <em style={{ fontFamily:"Lora, Georgia, serif", fontStyle:"italic", fontWeight:600 }}>while</em> you grab a coffee.
              </h1>
              <p style={{ fontSize:14, color:"#6b7280", marginTop:8 }}>
                Each approved keyword becomes a full, SEO-scored draft. One click starts the batch.
              </p>
            </div>
            <div style={{ display:"flex", gap:10, flexShrink:0, marginTop:4 }}>
              {showGenerateButton && (
                <button
                  className="btn-primary"
                  onClick={() => { if (!generating && !hasArticles) generateMutation.mutate({ businessId }); }}
                  disabled={generating || generateMutation.isPending || hasArticles}
                  style={{ opacity: (generating || hasArticles) ? 0.7 : 1 }}
                >
                  {generating
                    ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Generating articles…</>
                    : generateMutation.isPending
                    ? <><Loader2 style={{ width:14, height:14 }} className="animate-spin" /> Starting…</>
                    : <><Zap style={{ width:14, height:14 }} /> Generate {nodeTotal || totalCount || 5} articles</>}
                </button>
              )}
              {hasArticles && underTargetCount > 0 && !generating && (
                <button
                  className="btn-ghost"
                  style={{ border:"1.5px solid #6e5afe", color:"#6e5afe", padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6, cursor:"pointer", background:"#fff" }}
                  onClick={() => regenUnderTargetMutation.mutate({ businessId })}
                  disabled={regenUnderTargetMutation.isPending}
                >
                  {regenUnderTargetMutation.isPending
                    ? <><Loader2 style={{ width:13, height:13 }} className="animate-spin" /> Queuing…</>
                    : <><RefreshCw style={{ width:13, height:13 }} /> Regenerate {underTargetCount} under target</>}
                </button>
              )}
            </div>
          </div>

          {/* KPI cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:16, marginBottom:24 }}>
            {[
              { label:"Articles written", value:`${writtenCount}`, denom:`/${nodeTotal || totalCount || "?"}`, sub: writtenCount === 0 ? "Unlocks at stage 4" : "total articles", highlight: writtenCount > 0 },
              { label:"Scored", value:`${scoredCount}`, denom:`/${nodeTotal || totalCount || "?"}`, sub: scoredCount === 0 ? "Scored after generation" : "articles scored", highlight: false },
              { label:"Avg SEO score", value: avgScore ? `${avgScore}` : "—", denom: null, sub: avgScore ? `${scoredCount} articles scored` : "Waiting on first score", highlight: false },
            ].map(card => (
              <div key={card.label} className="kpi-card" style={{ background: card.highlight ? "#ede9ff" : "#fff" }}>
                <div className="kpi-label">{card.label}</div>
                <div className="kpi-value">
                  {card.value}
                  {card.denom && <span style={{ fontSize:16, fontWeight:500, color:"#9ca3af" }}>{card.denom}</span>}
                </div>
                <div className="kpi-sub">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Batch table */}
          <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", borderBottom:"1px solid #e5e7eb" }}>
              <h3 style={{ fontSize:14, fontWeight:700, color:"#1a1a2e", margin:0 }}>The batch</h3>
              <span style={{ fontSize:12, color:"#9ca3af" }}>{writtenCount} / {totalCount} written</span>
            </div>

            {/* Failed articles warning banner */}
            {!generating && failedCount > 0 && (
              <div style={{ padding:"12px 20px", borderBottom:"1px solid #fecaca", background:"#fff1f2", display:"flex", alignItems:"center", gap:10 }}>
                <AlertTriangle style={{ width:15, height:15, color:"#dc2626", flexShrink:0 }} />
                <span style={{ fontSize:13, color:"#991b1b", fontWeight:500 }}>
                  {failedCount} article{failedCount > 1 ? "s" : ""} failed to generate. Use the Retry button to regenerate {failedCount > 1 ? "them" : "it"}, or proceed to review the {writtenCount - failedCount} successful articles.
                </span>
              </div>
            )}

            {/* Generating progress bar */}
            {generating && (
              <div style={{ padding:"12px 20px", borderBottom:"1px solid #f3f4f6", background:"#ede9ff" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <Loader2 style={{ width:14, height:14, color:"#6e5afe" }} className="animate-spin" />
                  <span style={{ fontSize:13, fontWeight:600, color:"#6e5afe" }}>Generating articles…</span>
                  <span style={{ fontSize:12, color:"#9ca3af", marginLeft:"auto" }}>{writtenCount} / {totalCount}</span>
                </div>
                <div style={{ height:4, background:"#e5e7eb", borderRadius:99, overflow:"hidden" }}>
                  <div style={{ height:4, background:"#6e5afe", borderRadius:99, width:`${totalCount > 0 ? (writtenCount / totalCount) * 100 : 0}%`, transition:"width 600ms ease" }} />
                </div>
              </div>
            )}

            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#faf9f5" }}>
                    {["Level", "Article title", "Keyword", "Words", "Checkpoints", "Status", ""].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"10px 16px", fontSize:11, fontWeight:600, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {articlesLoading ? (
                    <tr><td colSpan={6} style={{ textAlign:"center", padding:32 }}>
                      <Loader2 style={{ width:20, height:20, color:"#6e5afe" }} className="animate-spin" />
                    </td></tr>
                  ) : !hasArticles ? (
                    <tr><td colSpan={6} style={{ textAlign:"center", padding:48, color:"#9ca3af", fontSize:13 }}>
                      No articles yet — approve keywords in Stage 3, then click Generate.
                    </td></tr>
                  ) : articles?.map(article => (
                    <tr key={article.id} style={{ borderBottom:"1px solid #f3f4f6" }}>
                      <td style={{ padding:"12px 16px" }}><LevelBadge level={article.level ?? "cluster"} /></td>
                      <td style={{ padding:"12px 16px", fontSize:13, fontWeight:500, color:"#1a1a2e", maxWidth:280 }}>
                        {article.title ?? <span style={{ color:"#9ca3af" }}>Generating…</span>}
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        <span style={{ fontSize:12, fontFamily:"monospace", color:"#6b7280", background:"#f3f4f6", padding:"2px 6px", borderRadius:4 }}>
                          {article.focusKeyword ?? "—"}
                        </span>
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        {article.wordCount != null ? (
                          <span style={{
                            fontSize:12, fontWeight:600,
                            color: (() => {
                              const min = WORD_COUNT_MIN[article.level ?? "cluster"] ?? 800;
                              return (article.wordCount ?? 0) < min ? "#b45309" : "#166534";
                            })(),
                          }}>
                            {article.wordCount.toLocaleString()}
                          </span>
                        ) : <span style={{ color:"#9ca3af", fontSize:12 }}>—</span>}
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        {article.internalScore != null ? (
                          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                            {/* Checkpoint 1 — SEO Structure */}
                            {(() => {
                              const pts = Math.round((article.internalScore / 100) * 16);
                              const color = pts >= 15 ? "#22c55e" : pts >= 13 ? "#3b82f6" : "#f59e0b";
                              const bg = pts >= 15 ? "#dcfce7" : pts >= 13 ? "#dbeafe" : "#fef9c3";
                              return (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:99, fontSize:10, fontWeight:600, background:bg, color, whiteSpace:"nowrap" }}>
                                  ✓1 {pts}/16
                                </span>
                              );
                            })()}
                            {/* Checkpoint 2 — Writing Quality (label only, no score number) */}
                            {(article as any).pass2Score != null ? (() => {
                              const s = (article as any).pass2Score as number;
                              const isExcellent = s >= 75;
                              const color = isExcellent ? "#22c55e" : "#f59e0b";
                              const bg = isExcellent ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)";
                              return (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:99, fontSize:10, fontWeight:600, background:bg, color, whiteSpace:"nowrap" }}>
                                  {isExcellent ? "Excellent — ready to publish" : "Improving quality..."}
                                </span>
                              );
                            })() : (
                              <span style={{ fontSize:10, color:"#9ca3af" }}>—</span>
                            )}
                          </div>
                        ) : <span style={{ color:"#9ca3af", fontSize:13 }}>—</span>}
                      </td>
                      <td style={{ padding:"12px 16px" }}><StatusBadge status={article.status} /></td>
                      <td style={{ padding:"12px 16px" }}>
                        {["generated","pending_approval","approved","published","scheduled"].includes(article.status) && (
                          <button className="btn-ghost" style={{ padding:"5px 12px", fontSize:12 }}
                            onClick={() => setLocation(`/review?articleId=${article.id}`)}>
                            Review
                          </button>
                        )}
                        {article.status === "failed" && (
                          <div style={{ display:"flex", gap:4 }}>
                            {article.hasContent ? (
                              <button
                                className="btn-ghost"
                                style={{ padding:"5px 10px", fontSize:11, color:"#166534", borderColor:"#86efac", display:"flex", alignItems:"center", gap:3, whiteSpace:"nowrap" }}
                                disabled={markReadyMutation.isPending}
                                onClick={() => markReadyMutation.mutate({ articleId: article.id, status: "pending_approval" })}
                              >
                                {markReadyMutation.isPending
                                  ? <><Loader2 style={{ width:10, height:10 }} className="animate-spin" /> Saving…</>
                                  : <><CheckCircle2 style={{ width:10, height:10 }} /> Keep &amp; review</>}
                              </button>
                            ) : null}
                            <button
                              className="btn-ghost"
                              style={{ padding:"5px 10px", fontSize:11, color:"#dc2626", borderColor:"#fca5a5", display:"flex", alignItems:"center", gap:3 }}
                              disabled={regenerateSingleMutation.isPending}
                              onClick={() => regenerateSingleMutation.mutate({ articleId: article.id })}
                            >
                              {regenerateSingleMutation.isPending
                                ? <><Loader2 style={{ width:10, height:10 }} className="animate-spin" /> Retrying…</>
                                : <><RefreshCw style={{ width:10, height:10 }} /> Retry</>}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Completion banner */}
          {allWritten && failedCount === 0 && (
            <div style={{ marginTop:24, padding:"20px 24px", background:"#f0fdf4", border:"1.5px solid #86efac", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <CheckCircle2 style={{ width:22, height:22, color:"#16a34a", flexShrink:0 }} />
                <div>
                  <p style={{ fontSize:15, fontWeight:700, color:"#14532d", margin:0 }}>All {writtenCount} articles written — ready to review</p>
                  <p style={{ fontSize:13, color:"#166534", margin:"2px 0 0" }}>Check scores, make edits, and schedule your posts.</p>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={() => setLocation("/review")}
                style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6 }}
              >
                Review articles <ArrowRight style={{ width:14, height:14 }} />
              </button>
            </div>
          )}
          {allWritten && failedCount > 0 && (
            <div style={{ marginTop:24, padding:"20px 24px", background:"#fffbeb", border:"1.5px solid #fcd34d", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <AlertTriangle style={{ width:22, height:22, color:"#b45309", flexShrink:0 }} />
                <div>
                  <p style={{ fontSize:15, fontWeight:700, color:"#78350f", margin:0 }}>{writtenCount - failedCount} of {writtenCount} articles written — {failedCount} failed</p>
                  <p style={{ fontSize:13, color:"#92400e", margin:"2px 0 0" }}>You can retry failed articles or proceed to review the successful ones.</p>
                </div>
              </div>
              <button
                className="btn-primary"
                onClick={() => setLocation("/review")}
                style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6 }}
              >
                Review articles <ArrowRight style={{ width:14, height:14 }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
