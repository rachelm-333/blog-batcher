/**
 * Layer 10 — User Dashboard
 *
 * The main screen a returning user sees after login.
 * Panels:
 *  - Multi-business switcher (header dropdown)
 *  - Stage progress indicator (5-stage pipeline)
 *  - Article status summary (stat cards)
 *  - Quick actions (context-aware CTA buttons)
 *  - Credit balance
 *  - Recent activity feed (last 10 automated actions)
 *  - Notifications panel (unread publish events)
 *  - Publishing calendar (mini month view)
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronDown,
  Building2,
  CreditCard,
  Activity,
  Bell,
  CalendarDays,
  FileText,
  Zap,
  AlertTriangle,
  RefreshCw,
  XCircle,
  Clock,
  CheckCheck,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STAGES = [
  { id: 1, label: "Business Profile", description: "Website scan, brand voice, services", path: "/onboarding" },
  { id: 2, label: "Blog Architecture", description: "Pack size, content hierarchy", path: "/architecture" },
  { id: 3, label: "Keyword Research", description: "Primary keywords, PAA questions", path: "/keywords" },
  { id: 4, label: "Article Generation", description: "AI-written, SEO-optimised articles", path: "/generate" },
  { id: 5, label: "Review & Publish", description: "Edit, approve, schedule, export", path: "/review" },
];

const ACTION_LABELS: Record<string, string> = {
  scheduled_publish_attempted: "Publish attempted",
  scheduled_publish_succeeded: "Published successfully",
  scheduled_publish_failed: "Publish failed",
  retry_attempted: "Retry attempted",
  retry_succeeded: "Retry succeeded",
  retry_failed: "Retry failed",
  schedule_cancelled: "Schedule cancelled",
  schedule_rescheduled: "Rescheduled",
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  scheduled_publish_attempted: Clock,
  scheduled_publish_succeeded: CheckCircle2,
  scheduled_publish_failed: AlertTriangle,
  retry_attempted: RefreshCw,
  retry_succeeded: CheckCircle2,
  retry_failed: XCircle,
  schedule_cancelled: XCircle,
  schedule_rescheduled: RotateCcw,
};

const ACTION_COLORS: Record<string, string> = {
  scheduled_publish_attempted: "text-primary",
  scheduled_publish_succeeded: "text-emerald-500",
  scheduled_publish_failed: "text-amber-500",
  retry_attempted: "text-primary",
  retry_succeeded: "text-emerald-500",
  retry_failed: "text-red-500",
  schedule_cancelled: "text-muted-foreground",
  schedule_rescheduled: "text-violet-500",
};

const NOTIF_ICONS: Record<string, React.ElementType> = {
  publish_success: CheckCircle2,
  publish_failed: AlertTriangle,
  retry_failed: XCircle,
  schedule_cancelled: XCircle,
  schedule_rescheduled: RotateCcw,
};

const NOTIF_COLORS: Record<string, string> = {
  publish_success: "text-emerald-500",
  publish_failed: "text-amber-500",
  retry_failed: "text-red-500",
  schedule_cancelled: "text-muted-foreground",
  schedule_rescheduled: "text-violet-500",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1 shadow-sm">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-2 shadow-sm">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-12" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini Publishing Calendar
// ---------------------------------------------------------------------------
function MiniCalendar({ scheduledDates }: { scheduledDates: Date[] }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const { firstDay, daysInMonth } = useMemo(
    () => getMonthDays(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const scheduledSet = useMemo(() => {
    const s = new Set<string>();
    for (const d of scheduledDates) {
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        s.add(d.getDate().toString());
      }
    }
    return s;
  }, [scheduledDates, viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-secondary transition-colors">
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-secondary transition-colors">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
          <div key={d} className="text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const isToday =
            day === today.getDate() &&
            viewMonth === today.getMonth() &&
            viewYear === today.getFullYear();
          const hasArticle = scheduledSet.has(day.toString());
          return (
            <div
              key={day}
              className={`text-xs py-1 rounded-md font-medium transition-colors
                ${isToday ? "bg-primary text-white" : ""}
                ${hasArticle && !isToday ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : ""}
                ${!isToday && !hasArticle ? "text-muted-foreground hover:bg-secondary" : ""}
              `}
            >
              {day}
            </div>
          );
        })}
      </div>
      {scheduledSet.size > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          {scheduledSet.size} article{scheduledSet.size !== 1 ? "s" : ""} scheduled this month
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function DashboardSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-44 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);

  const { data: businesses, isLoading: bizListLoading } = trpc.dashboard.listBusinesses.useQuery(
    undefined,
    { enabled: !!user }
  );

  useEffect(() => {
    if (businesses && businesses.length > 0 && !selectedBusinessId) {
      setSelectedBusinessId(businesses[0]!.id);
    }
  }, [businesses, selectedBusinessId]);

  const { data: summary, isLoading: summaryLoading } = trpc.dashboard.getSummary.useQuery(
    { businessId: selectedBusinessId! },
    { enabled: !!selectedBusinessId }
  );

  const { data: activity, isLoading: activityLoading } = trpc.dashboard.getRecentActivity.useQuery(
    { businessId: selectedBusinessId!, limit: 10 },
    { enabled: !!selectedBusinessId }
  );

  const { data: notifData, isLoading: notifLoading } = trpc.scheduler.getNotifications.useQuery(
    { limit: 10, businessId: selectedBusinessId ?? undefined },
    { enabled: !!user && !!selectedBusinessId, refetchInterval: 30000 }
  );

  const markRead = trpc.scheduler.markNotificationRead.useMutation({
    onSuccess: () => utils.scheduler.getNotifications.invalidate(),
  });
  const markAllRead = trpc.scheduler.markAllRead.useMutation({
    onSuccess: () => utils.scheduler.getNotifications.invalidate(),
  });

  const { data: scheduleData } = trpc.scheduler.getSchedule.useQuery(
    { businessId: selectedBusinessId! },
    { enabled: !!selectedBusinessId }
  );

  const scheduledDates = useMemo(() => {
    if (!scheduleData) return [];
    return scheduleData
      .filter((a: { scheduledPublishAt?: Date | string | null }) => a.scheduledPublishAt != null)
      .map((a: { scheduledPublishAt: Date | string | null }) => new Date(a.scheduledPublishAt!));
  }, [scheduleData]);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && !bizListLoading && user && businesses && businesses.length === 0) {
      navigate("/onboarding");
    }
  }, [user, businesses, authLoading, bizListLoading, navigate]);

  if (authLoading || bizListLoading) {
    return (
      <DashboardLayout>
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  if (!user) return null;

  const selectedBusiness = businesses?.find(b => b.id === selectedBusinessId);
  const currentStage = summary?.business?.currentStage ?? selectedBusiness?.currentStage ?? 1;
  const sc = summary?.statusCounts;
  const bc = summary?.badgeCounts;
  const notifications = notifData?.notifications ?? [];
  const unreadCount = notifData?.unreadCount ?? 0;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header: business switcher + credits */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            {businesses && businesses.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card hover:bg-background transition-colors shadow-sm text-left">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate max-w-[180px]">
                        {selectedBusiness?.name ?? "Select business"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {selectedBusiness?.industry ?? ""}
                        {selectedBusiness?.location ? ` · ${selectedBusiness.location}` : ""}
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {businesses.map(biz => (
                    <DropdownMenuItem
                      key={biz.id}
                      onClick={() => setSelectedBusinessId(biz.id)}
                      className={`flex flex-col items-start gap-0.5 cursor-pointer ${biz.id === selectedBusinessId ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-medium text-foreground">{biz.name}</span>
                      <span className="text-xs text-muted-foreground">
                        Stage {biz.currentStage} · {biz.articleCounts.total} articles
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => navigate("/onboarding?new=1")}
                    className="flex items-center gap-2 cursor-pointer text-primary"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="font-medium">Add New Business</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h1 className="text-xl font-bold text-foreground">
                      {selectedBusiness?.name ?? "Your Dashboard"}
                    </h1>
                    {(selectedBusiness?.industry || selectedBusiness?.location) && (
                      <p className="text-xs text-muted-foreground">
                        {selectedBusiness?.industry}
                        {selectedBusiness?.location ? ` · ${selectedBusiness.location}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-primary border-primary/30 hover:bg-primary/10"
                  onClick={() => navigate("/onboarding?new=1")}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Business
                </Button>
              </div>
            )}
          </div>

          {/* Credit balance */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card shadow-sm">
            <CreditCard className="h-4 w-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground leading-none">Credits remaining</div>
              {summaryLoading ? (
                <Skeleton className="h-5 w-8 mt-0.5" />
              ) : (
                <div className="text-lg font-bold text-foreground leading-tight">
                  {summary?.creditBalance ?? 0}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stage progress */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Your Blog Batcher Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              {STAGES.map((stage) => {
                const isComplete = currentStage > stage.id;
                const isCurrent = currentStage === stage.id;
                const isLocked = currentStage < stage.id;
                return (
                  <div
                    key={stage.id}
                    className={`flex-1 flex flex-col gap-1.5 p-3 rounded-xl border transition-all
                      ${isCurrent ? "border-primary/30 bg-primary/10 shadow-sm" : ""}
                      ${isComplete ? "border-emerald-500/30 bg-emerald-500/5" : ""}
                      ${isLocked ? "border-border bg-background/50 opacity-50" : ""}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      {isComplete ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : isCurrent ? (
                        <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                          {stage.id}
                        </div>
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-foreground truncate">
                        {stage.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug hidden sm:block">
                      {stage.description}
                    </p>
                    {isCurrent && (
                      <Button
                        size="sm"
                        className="h-7 text-xs mt-1"
                        onClick={() => navigate(stage.path)}
                      >
                        Continue
                        <ArrowRight className="ml-1 h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Article status summary */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Article Status
          </h2>
          {summaryLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)}
            </div>
          ) : sc ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <StatCard label="Total" value={sc.total ?? 0} />
              <StatCard label="Auth Ready" value={bc?.authority_ready ?? 0} accent="text-emerald-600" />
              <StatCard label="Strong" value={bc?.strong ?? 0} accent="text-primary" />
              <StatCard label="Needs Review" value={bc?.needs_review ?? 0} accent="text-amber-600" />
              <StatCard label="Approved" value={sc.approved ?? 0} accent="text-violet-600" />
              <StatCard label="Scheduled" value={sc.scheduled ?? 0} accent="text-primary" />
              <StatCard label="Published" value={sc.published ?? 0} accent="text-emerald-600" />
              <StatCard label="Failed" value={sc.failed ?? 0} accent="text-red-500" />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No article data yet — start by completing your business profile.
            </div>
          )}
        </div>

        {/* Quick actions */}
        {summary && (
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate(summary.quickActionRoute)} className="shadow-sm">
              {summary.quickActionLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {(sc?.approved ?? 0) > 0 && (
              <Button variant="outline" onClick={() => navigate("/review")} className="bg-card">
                <FileText className="mr-2 h-4 w-4" />
                Review Articles ({sc!.approved})
              </Button>
            )}
            {(sc?.scheduled ?? 0) > 0 && (
              <Button variant="outline" onClick={() => navigate("/schedule-management")} className="bg-card">
                <CalendarDays className="mr-2 h-4 w-4" />
                View Schedule ({sc!.scheduled})
              </Button>
            )}
            {(sc?.failed ?? 0) > 0 && (
              <Button variant="outline" onClick={() => navigate("/schedule-management")} className="bg-card border-destructive/30 text-destructive hover:bg-destructive/10">
                <AlertTriangle className="mr-2 h-4 w-4" />
                Failed Publishes ({sc!.failed})
              </Button>
            )}
          </div>
        )}

        {/* Bottom row: activity + notifications + calendar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent activity feed */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-4 w-4 rounded-full mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !activity || activity.length === 0 ? (
                <div className="text-center py-6">
                  <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No automated activity yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Activity appears when articles are scheduled and published.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activity.map((item: {
                    id: number;
                    action: string;
                    articleTitle: string | null;
                    errorMessage: string | null;
                    createdAt: Date | string;
                  }) => {
                    const Icon = ACTION_ICONS[item.action] ?? Clock;
                    const color = ACTION_COLORS[item.action] ?? "text-muted-foreground";
                    return (
                      <div key={item.id} className="flex gap-3 items-start">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-snug truncate">
                            {item.articleTitle ?? "Article"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {ACTION_LABELS[item.action] ?? item.action}
                            {" · "}
                            {relativeTime(item.createdAt)}
                          </p>
                          {item.errorMessage && (
                            <p className="text-xs text-red-400 mt-0.5 truncate">{item.errorMessage}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notifications panel */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  Notifications
                  {unreadCount > 0 && (
                    <Badge className="h-5 px-1.5 text-[10px] bg-primary text-white">
                      {unreadCount}
                    </Badge>
                  )}
                </CardTitle>
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="text-xs text-primary hover:text-primary/70 flex items-center gap-1 transition-colors"
                  >
                    <CheckCheck className="h-3 w-3" />
                    Mark all read
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {notifLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-4 w-4 rounded-full mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-6">
                  <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No notifications yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You'll be notified when articles publish or fail.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notifications.map((n: {
                    id: number;
                    type: string;
                    title: string;
                    message: string;
                    read: boolean;
                    createdAt: Date | string;
                  }) => {
                    const Icon = NOTIF_ICONS[n.type] ?? Bell;
                    const color = NOTIF_COLORS[n.type] ?? "text-muted-foreground";
                    return (
                      <div
                        key={n.id}
                        className={`flex gap-3 items-start p-2 rounded-lg transition-colors cursor-pointer
                          ${!n.read ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-background"}
                        `}
                        onClick={() => {
                          if (!n.read) markRead.mutate({ notificationId: n.id });
                        }}
                      >
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${!n.read ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                            {n.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{relativeTime(n.createdAt)}</p>
                        </div>
                        {!n.read && (
                          <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Publishing calendar */}
          <Card className="lg:col-span-1 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                Publishing Calendar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MiniCalendar scheduledDates={scheduledDates} />
              {scheduledDates.length === 0 && (
                <p className="text-xs text-muted-foreground text-center mt-3">
                  No articles scheduled yet.{" "}
                  <button
                    className="text-primary hover:underline"
                    onClick={() => navigate("/publish")}
                  >
                    Set up a schedule
                  </button>
                </p>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </DashboardLayout>
  );
}
