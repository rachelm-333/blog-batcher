/**
 * Dashboard — matches BlogBatcher mockup exactly
 * Light cream theme, serif italic heading, KPI cards, batch grid, activity feed
 */
import { useActiveBusiness } from "@/contexts/BusinessContext";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import {
  CheckCircle2, AlertTriangle, RefreshCw, XCircle, Clock,
  RotateCcw, ArrowRight, Plus, FileText, BarChart2, Calendar,
  Zap, Building2, Lock
} from "lucide-react";

/* ── Stage definitions ── */
const STAGES = [
  { id: 1, label: "Business profile",   desc: "Website scan, brand voice, services", path: "/onboarding?edit=1" },
  { id: 2, label: "Blog architecture",  desc: "Pack size, content hierarchy",         path: "/architecture" },
  { id: 3, label: "Keyword research",   desc: "Primary keywords, PAA questions",      path: "/keywords" },
  { id: 4, label: "Article generation", desc: "AI-written, SEO-optimised articles",   path: "/generate" },
  { id: 5, label: "Review & edit",      desc: "Score and polish each draft",          path: "/review" },
  { id: 6, label: "Publish & schedule", desc: "Push live or queue to your CMS",       path: "/publish" },
];

const ACTION_LABELS: Record<string, string> = {
  scheduled_publish_attempted: "Publish attempted",
  scheduled_publish_succeeded: "Published successfully",
  scheduled_publish_failed:    "Publish failed",
  retry_attempted:             "Retry attempted",
  retry_succeeded:             "Retry succeeded",
  retry_failed:                "Retry failed",
  schedule_cancelled:          "Schedule cancelled",
  schedule_rescheduled:        "Rescheduled",
};
const ACTION_ICONS: Record<string, React.ElementType> = {
  scheduled_publish_attempted: Clock,
  scheduled_publish_succeeded: CheckCircle2,
  scheduled_publish_failed:    AlertTriangle,
  retry_attempted:             RefreshCw,
  retry_succeeded:             CheckCircle2,
  retry_failed:                XCircle,
  schedule_cancelled:          XCircle,
  schedule_rescheduled:        RotateCcw,
};
const ACTION_COLORS: Record<string, string> = {
  scheduled_publish_attempted: "#6e5afe",
  scheduled_publish_succeeded: "#22c55e",
  scheduled_publish_failed:    "#f59e0b",
  retry_attempted:             "#6e5afe",
  retry_succeeded:             "#22c55e",
  retry_failed:                "#ef4444",
  schedule_cancelled:          "#9ca3af",
  schedule_rescheduled:        "#8b5cf6",
};

function fmtTime(ts: Date | number | string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts: Date | number | string) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { activeBusiness, businesses, setSelectedBizId, isLoading: bizLoading } = useActiveBusiness();
  const selectedBusinessId = activeBusiness?.id ?? null;

  const { data: summary, isLoading: summaryLoading } = trpc.dashboard.getSummary.useQuery(
    { businessId: selectedBusinessId! },
    { enabled: !!selectedBusinessId }
  );
  const { data: activity, isLoading: activityLoading } = trpc.dashboard.getRecentActivity.useQuery(
    { businessId: selectedBusinessId!, limit: 10 },
    { enabled: !!selectedBusinessId }
  );

  const dbStage = summary?.business?.currentStage ?? 1;
  const statusCounts = summary?.statusCounts;
  const bizName = summary?.business?.name ?? "Your business";

  // Derive effective stage from actual data so the dashboard is always accurate
  // even if the DB stage number lags behind what the user has actually done.
  const approvedCount = (statusCounts?.approved ?? 0) + (statusCounts?.scheduled ?? 0) + (statusCounts?.published ?? 0);
  const publishedCount = (statusCounts?.published ?? 0) + (statusCounts?.scheduled ?? 0);
  const generatedCount = (statusCounts?.generated ?? 0) + (statusCounts?.pending_approval ?? 0) + approvedCount;

  // Effective stage: take the max of the DB stage and what the data implies
  const dataImpliedStage = (() => {
    if (publishedCount > 0) return 6;
    if (approvedCount > 0) return 5;
    if (generatedCount > 0) return 4;
    return dbStage;
  })();
  const currentStage = Math.max(dbStage, dataImpliedStage);

  /* ── Quick action CTA ── */
  const ctaPath = STAGES[Math.min(currentStage - 1, 5)].path;
  const ctaLabel = currentStage >= 6 ? "View Publish & Schedule" : `Resume Stage ${currentStage}`;

  /* ── Stage card status ── */
  function stageStatus(id: number) {
    if (id < currentStage) return "complete";
    if (id === currentStage) return "active";
    return "locked";
  }

  /* ── Stage card icon colour ── */
  function stageIconStyle(id: number) {
    const s = stageStatus(id);
    if (s === "complete") return { background: "#D9F542" };
    if (s === "active")   return { background: "#6e5afe" };
    return { background: "#f3f4f6" };
  }

  /* ── Stage card icon ── */
  const STAGE_ICONS = [Building2, BarChart2, FileText, Zap, FileText, Calendar];

  /* ── Activity grouped by day ── */
  const grouped: { day: string; items: typeof activity }[] = [];
  if (activity) {
    for (const item of activity) {
      const day = fmtDate(item.createdAt);
      const last = grouped[grouped.length - 1];
      if (!last || last.day !== day) grouped.push({ day, items: [item] });
      else last.items!.push(item);
    }
  }

  /* ── No businesses ── */
  if (!bizLoading && (!businesses || businesses.length === 0)) {
    return (
      <DashboardLayout>
        <div style={{ padding: "40px 32px" }}>
          <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "#ede9ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <Building2 style={{ width: 28, height: 28, color: "#6e5afe" }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e", marginBottom: 8 }}>
              No businesses yet
            </h2>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
              Create your first business to start building your blog batch.
            </p>
            <button className="btn-primary" onClick={() => setLocation("/onboarding")}>
              <Plus style={{ width: 16, height: 16 }} /> Add your first business
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af" }}>
                AUTHORITY PACK · {bizName.toUpperCase()}
              </div>
              {businesses && businesses.length > 1 && (
                <select
                  value={selectedBusinessId ?? ""}
                  onChange={e => setSelectedBizId(Number(e.target.value))}
                  style={{ fontSize: 11, color: "#6e5afe", border: "1px solid #c4b5fd", borderRadius: 6, padding: "2px 6px", background: "#ede9ff", cursor: "pointer", fontWeight: 600 }}
                >
                  {businesses.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setLocation("/onboarding?new=1")}
                style={{ fontSize: 11, color: "#6e5afe", border: "1px solid #c4b5fd", borderRadius: 6, padding: "2px 8px", background: "#ede9ff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}
              >
                <Plus style={{ width: 10, height: 10 }} /> Add business
              </button>
            </div>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.15, margin: 0 }}>
              Your whole blog, in{" "}
              <em style={{ fontFamily: "'Lora', serif", fontStyle: "italic", fontWeight: 600 }}>one</em>
              {" "}batch.
            </h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 8 }}>
              {summaryLoading
                ? "Loading your progress…"
                : `You're on stage ${currentStage} of 6. ${currentStage < 6 ? "Keep going — almost there." : "All stages complete!"}`
              }
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => setLocation(ctaPath)}
            style={{ flexShrink: 0, marginTop: 8 }}
          >
            {ctaLabel} <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* ── KPI cards ── */}
        <div className="kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
          {[
            {
              label: "Keywords approved",
              value: summaryLoading ? "—" : `${summary?.statusCounts?.approved ?? 0}`,
              denom: null,
              sub: "approved keywords",
            },
            {
              label: "Articles written",
              value: summaryLoading ? "—" : `${(summary?.statusCounts?.draft ?? 0) + (summary?.statusCounts?.published ?? 0) + (summary?.statusCounts?.scheduled ?? 0)}`,
              denom: null,
              sub: currentStage < 4 ? "Unlocks at stage 4" : "total articles",
            },
            {
              label: "Avg SEO score",
              value: "—",
              denom: null,
              sub: "Scored after generation",
            },
            {
              label: "Published",
              value: summaryLoading ? "—" : `${summary?.statusCounts?.published ?? 0}`,
              denom: null,
              sub: (summary?.statusCounts?.published ?? 0) === 0 ? "Nothing live yet" : "articles live",
            },
          ].map(card => (
            <div key={card.label} className="kpi-card">
              <div className="kpi-label">{card.label}</div>
              <div className="kpi-value">
                {card.value}
                {card.denom !== null && (
                  <span style={{ fontSize: 16, fontWeight: 500, color: "#9ca3af" }}>/{card.denom}</span>
                )}
              </div>
              <div className="kpi-sub">{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Two-column layout: Batch grid + Activity ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>

          {/* ── The batch ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e" }}>The batch</h2>
              <span style={{ fontSize: 11, color: "#9ca3af", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                6 stages · click to open
              </span>
            </div>
            <div className="stagegrid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {STAGES.map(stage => {
                const status = stageStatus(stage.id);
                const Icon = STAGE_ICONS[stage.id - 1];
                return (
                  <button
                    key={stage.id}
                    className={`stage-card ${status === "active" ? "active" : ""} ${status === "locked" ? "locked" : ""}`}
                    onClick={() => status !== "locked" && setLocation(stage.path)}
                    style={{ textAlign: "left", width: "100%", border: "none", padding: 18 }}
                  >
                    {/* Icon + badge row */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                      <div className={`stage-icon ${status}`} style={stageIconStyle(stage.id)}>
                        <Icon style={{
                          width: 18, height: 18,
                          color: status === "complete" ? "#1a1a2e" : status === "active" ? "#fff" : "#9ca3af"
                        }} />
                      </div>
                      {status === "complete" && (
                        <span className="badge badge-complete" style={{ fontSize: 10 }}>✓ Complete</span>
                      )}
                      {status === "active" && (
                        <span className="badge badge-inprogress" style={{ fontSize: 10 }}>In progress</span>
                      )}
                      {status === "locked" && (
                        <span className="badge badge-locked" style={{ fontSize: 10 }}>
                          <Lock style={{ width: 9, height: 9 }} /> Locked
                        </span>
                      )}
                    </div>
                    {/* Stage label */}
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 }}>
                      Stage {stage.id}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: status === "locked" ? "#9ca3af" : "#1a1a2e", marginBottom: 4 }}>
                      {stage.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>{stage.desc}</div>
                    {/* Progress bar for active stage */}
                    {status === "active" && (
                      <div style={{ marginTop: 10, height: 3, background: "#e5e7eb", borderRadius: 99 }}>
                        <div style={{
                          height: 3, borderRadius: 99, background: "#6e5afe",
                          width: `${Math.min(100, ((currentStage - 1) / 6) * 100 + 10)}%`
                        }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Right column: Activity + Tips ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Activity feed */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 20px" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 14 }}>What clicked</h3>
              {activityLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 10 }} />)}
                </div>
              ) : grouped.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "16px 0" }}>
                  No activity yet — start your first stage!
                </p>
              ) : (
                grouped.map(group => (
                  <div key={group.day}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, marginTop: 4 }}>
                      {group.day}
                    </div>
                    {group.items?.map(item => {
                      const Icon = ACTION_ICONS[item.action] ?? Clock;
                      const color = ACTION_COLORS[item.action] ?? "#9ca3af";
                      return (
                        <div key={item.id} className="activity-item">
                          <span className="activity-time">{fmtTime(item.createdAt)}</span>
                          <Icon style={{ width: 14, height: 14, color, flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 13, color: "#374151" }}>
                            {ACTION_LABELS[item.action] ?? item.action}
                            {item.articleTitle && (
                              <em style={{ color: "#6b7280" }}> — {item.articleTitle}</em>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Before you publish tips */}
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 18px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 10 }}>Before you publish</h3>
              <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.6, margin: "0 0 8px" }}>
                <strong>Cornerstone first.</strong> Your cornerstone article must go live before its pillars and clusters — we'll order the queue for you.
              </p>
              <p style={{ fontSize: 12, color: "#78350f", lineHeight: 1.6, margin: 0 }}>
                Over-editing keyword placement can lower ranking potential. We recommend publishing strong drafts as-is.
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
