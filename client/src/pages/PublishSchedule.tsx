/**
 * Stage 5 — Publish & Schedule Page
 *
 * Two scheduling modes:
 *  1. Manual Schedule — pick cadence preset + start date, preview calendar, send all to CMS
 *  2. Auto-Schedule   — pick start date + interval in days, system creates Heartbeat jobs automatically
 */

import DashboardLayout from "@/components/DashboardLayout";
import StageStepper from "@/components/StageStepper";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { HelpLink } from "@/components/HelpLink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublishMethod = "wix" | "wordpress" | "zapier" | "export_zip";
type PublishAs = "scheduled" | "drafts";
type ScheduleMode = "manual" | "auto";
type Cadence =
  | "every_day"
  | "every_2_days"
  | "every_3_days"
  | "once_per_week"
  | "twice_per_week";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PUBLISH_METHODS: {
  id: PublishMethod;
  label: string;
  description: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}[] = [
  {
    id: "wix",
    label: "Wix",
    description: "Publish directly to your Wix site via API",
    icon: <span className="text-2xl font-black text-primary">W</span>,
  },
  {
    id: "wordpress",
    label: "WordPress",
    description: "REST API + Application Password",
    icon: <span className="text-2xl font-black text-primary">WP</span>,
  },
  {
    id: "zapier",
    label: "Zapier",
    description: "Send to any platform via Zapier webhook",
    icon: <Zap className="h-6 w-6 text-orange-500" />,
  },
  {
    id: "export_zip",
    label: "Export ZIP",
    description: "HTML + Markdown + meta + schema + schedule CSV",
    icon: <Download className="h-6 w-6 text-muted-foreground" />,
  },
];

const CADENCE_OPTIONS: { value: Cadence; label: string; days: number; recommended?: boolean }[] = [
  { value: "every_day", label: "Daily", days: 1 },
  { value: "every_2_days", label: "Every 2 Days", days: 2 },
  { value: "every_3_days", label: "Every 3 Days", days: 3, recommended: true },
  { value: "once_per_week", label: "Once a Week", days: 7 },
  { value: "twice_per_week", label: "Twice a Week", days: 4 },
];

// Quick-pick intervals for auto-schedule mode
const AUTO_INTERVALS: { days: number; label: string; sublabel: string; recommended?: boolean }[] = [
  { days: 1, label: "Daily", sublabel: "7 posts/week" },
  { days: 2, label: "Every 2 days", sublabel: "3–4 posts/week", recommended: true },
  { days: 3, label: "Every 3 days", sublabel: "2–3 posts/week", recommended: true },
  { days: 4, label: "Every 4 days", sublabel: "~2 posts/week" },
  { days: 5, label: "Every 5 days", sublabel: "~1.5 posts/week" },
  { days: 6, label: "Every 6 days", sublabel: "~1 post/week" },
  { days: 7, label: "Weekly", sublabel: "1 post/week" },
  { days: 10, label: "Every 10 days", sublabel: "3 posts/month" },
  { days: 14, label: "Fortnightly", sublabel: "2 posts/month" },
];

// ---------------------------------------------------------------------------
// Calendar preview helpers
// ---------------------------------------------------------------------------

function getMonthDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PublishSchedule() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();

  const { data: businessData, isLoading: bizLoading } = trpc.business.get.useQuery(undefined, {
    enabled: !!user,
  });
  const business = businessData ?? null;

  const { data: articlesData, isLoading: articlesLoading } = trpc.articles.getAll.useQuery(
    { businessId: business?.id ?? 0 },
    { enabled: !!business?.id }
  );

  const { data: scheduleData, isLoading: scheduleLoading, refetch: refetchSchedule } =
    trpc.schedule.get.useQuery(
      { businessId: business?.id ?? 0 },
      { enabled: !!business?.id }
    );

  // Local state
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("auto");
  const [selectedMethod, setSelectedMethod] = useState<PublishMethod>("export_zip");
  const [publishAs, setPublishAs] = useState<PublishAs>("scheduled");
  const [cadence, setCadence] = useState<Cadence>("every_3_days");
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [autoIntervalDays, setAutoIntervalDays] = useState(3);
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Sync from saved schedule
  useEffect(() => {
    if (scheduleData?.schedule?.cadence) {
      setCadence(scheduleData.schedule.cadence as Cadence);
    }
    if (scheduleData?.schedule?.startDate) {
      setStartDate(new Date(scheduleData.schedule.startDate));
    }
  }, [scheduleData?.schedule?.id]);

  // Mutations
  const saveSchedule = trpc.schedule.save.useMutation({
    onSuccess: () => {
      toast.success("Schedule saved.");
      refetchSchedule();
    },
    onError: (err) => toast.error("Could not save schedule", {
      description: `${err.message}`,
      duration: 8000,
    }),
  });

  const confirmSchedule = trpc.schedule.confirm.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.scheduledCount} articles scheduled!`);
      refetchSchedule();
    },
    onError: (err) => toast.error("Could not confirm schedule", {
      description: `${err.message}`,
      duration: 8000,
    }),
  });

  const publishAll = trpc.articles.publishAll.useMutation({
    onSuccess: (data) => {
      if (data.failed > 0) {
        toast.error(`Published ${data.published}/${data.total} articles. ${data.failed} failed.`, {
          description: "Check the Schedule Management page for details on failed articles.",
          duration: 10000,
        });
      } else {
        toast.success(`All ${data.published} articles published successfully!`);
      }
      refetchSchedule();
    },
    onError: (err) => toast.error("Publish failed", { description: err.message, duration: 8000 }),
  });

  const autoSchedule = trpc.scheduler.autoSchedule.useMutation({
    onSuccess: (data) => {
      if (data.failedCount > 0) {
        toast.error(
          `Scheduled ${data.scheduledCount} articles. ${data.failedCount} failed.`,
          { description: "Check Schedule Management for details.", duration: 10000 }
        );
      } else {
        const first = data.firstPublishAt ? new Date(data.firstPublishAt).toLocaleDateString() : "";
        const last = data.lastPublishAt ? new Date(data.lastPublishAt).toLocaleDateString() : "";
        toast.success(
          `✅ ${data.scheduledCount} articles auto-scheduled!`,
          {
            description: `First: ${first} · Last: ${last}. Articles will publish automatically at 9am UTC.`,
            duration: 8000,
          }
        );
      }
      refetchSchedule();
    },
    onError: (err) => toast.error("Auto-schedule failed", { description: err.message, duration: 8000 }),
  });

  // Derived state
  const articleList = articlesData ?? [];
  const approvedArticles = articleList.filter(
    a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
  );
  const approvedCount = approvedArticles.length;
  const totalCount = articleList.length;
  const allApproved = approvedCount === totalCount && totalCount > 0;

  // Preview dates for manual mode
  const manualPreviewDates = useMemo(() => {
    if (!allApproved || articleList.length === 0) return [];
    const intervalDays =
      cadence === "every_day" ? 1 :
      cadence === "every_2_days" ? 2 :
      cadence === "every_3_days" ? 3 :
      cadence === "once_per_week" ? 7 :
      4;
    return approvedArticles.map((article, index) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + index * intervalDays);
      return {
        date: d,
        title: article.title ?? article.urlSlug ?? `Article ${article.id}`,
        level: article.level,
      };
    });
  }, [allApproved, articleList, cadence, startDate]);

  // Preview dates for auto mode
  const autoPreviewDates = useMemo(() => {
    if (approvedArticles.length === 0) return [];
    return approvedArticles.map((article, index) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + index * autoIntervalDays);
      return {
        date: d,
        title: article.title ?? article.urlSlug ?? `Article ${article.id}`,
        level: article.level,
      };
    });
  }, [approvedArticles, startDate, autoIntervalDays]);

  const previewDates = scheduleMode === "auto" ? autoPreviewDates : manualPreviewDates;

  // Stage guard
  useEffect(() => {
    if (!authLoading && !bizLoading) {
      if (!user) { navigate("/login"); return; }
      if (business && (business.currentStage ?? 0) < 4) navigate("/generate");
    }
  }, [authLoading, bizLoading, user, business, navigate]);

  if (authLoading || bizLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  function handleSaveAndPreview() {
    if (!business?.id) return;
    saveSchedule.mutate({ businessId: business.id, cadence, startDate });
  }

  function handleSendToCMS() {
    if (!business?.id) return;
    if (selectedMethod === "export_zip") {
      window.open(`/api/articles/export-zip?businessId=${business.id}`, "_blank");
      return;
    }
    saveSchedule.mutate(
      { businessId: business.id, cadence, startDate },
      {
        onSuccess: () => {
          confirmSchedule.mutate(
            { businessId: business.id! },
            {
              onSuccess: () => {
                publishAll.mutate({
                  businessId: business.id!,
                  platform: selectedMethod as "wordpress" | "wix" | "zapier",
                });
              },
            }
          );
        },
      }
    );
  }

  function handleAutoSchedule() {
    if (!business?.id) return;
    const futureStart = new Date(startDate);
    if (futureStart <= new Date()) {
      futureStart.setDate(new Date().getDate() + 1);
    }
    autoSchedule.mutate({
      businessId: business.id,
      startDate: futureStart,
      intervalDays: autoIntervalDays,
    });
  }

  const monthDays = getMonthDays(calendarMonth.year, calendarMonth.month);
  const monthName = new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const currentStage = business?.currentStage ?? 6;
  const lastAutoDate = autoPreviewDates[autoPreviewDates.length - 1]?.date;
  const totalAutoWeeks = lastAutoDate
    ? Math.ceil((lastAutoDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7))
    : 0;

  return (
    <DashboardLayout>
    <div style={{ background:"#faf9f5", minHeight:"100%" }}>
      <StageStepper currentStage={currentStage} />
      {/* Header */}
      <div style={{ borderBottom:"1px solid #e5e7eb", background:"#fff", padding:"16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/review")} className="text-xs">
              <ArrowLeft className="h-3 w-3 mr-1" />
              Back to Review
            </Button>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-sm font-bold text-foreground">Stage 5 — Publish &amp; Schedule</h1>
          </div>
          <div className="text-xs text-muted-foreground">
            {approvedCount} / {totalCount} articles approved
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Gate warning */}
        {!allApproved && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400 flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div>
              <div className="font-semibold">All articles must be approved before publishing.</div>
              <div className="text-xs mt-1">
                {totalCount - approvedCount} article{totalCount - approvedCount !== 1 ? "s" : ""} still need approval.{" "}
                <button className="underline text-amber-400" onClick={() => navigate("/review")}>
                  Go to Review →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Publishing Method */}
        <section>
          <div className="flex items-center gap-1.5 mb-1">
            <h2 className="text-base font-bold text-foreground">Publishing Method</h2>
            <HelpLink slug="connecting-your-cms" label="How to connect your CMS" />
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Choose how your articles will be delivered to your website.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PUBLISH_METHODS.filter(m => m.id !== "zapier" && m.id !== "export_zip").map((method) => (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method.id)}
                className={`relative p-4 rounded-xl border text-left transition-all ${
                  selectedMethod === method.id
                    ? "bg-primary/10 border-primary shadow-sm"
                    : "bg-card border-border hover:bg-muted/50"
                }`}
              >
                <div className="mb-2">{method.icon}</div>
                <div className="text-sm font-semibold text-foreground">{method.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{method.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-dashed border-border bg-muted/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-foreground">Website not listed?</span>
              <span className="text-xs text-muted-foreground">Use one of these options to publish manually or connect via automation.</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedMethod("zapier")}
                className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                  selectedMethod === "zapier"
                    ? "bg-orange-500/10 border-orange-400 shadow-sm"
                    : "bg-card border-border hover:bg-muted/50"
                }`}
              >
                <Zap className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">Zapier Webhook</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Send articles to any platform — Shopify, Webflow, Squarespace, Ghost, or any CMS via Zapier automation.
                  </div>
                  <div className="mt-2 text-xs text-orange-500 font-medium">Set up webhook URL in Integrations →</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedMethod("export_zip")}
                className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                  selectedMethod === "export_zip"
                    ? "bg-primary/10 border-primary shadow-sm"
                    : "bg-card border-border hover:bg-muted/50"
                }`}
              >
                <Download className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">Download ZIP</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Download all articles as HTML + Markdown files with meta data, schema JSON-LD, image alt text, and a schedule CSV.
                  </div>
                  <div className="mt-2 text-xs text-primary font-medium">Includes all SEO fields for easy copy-paste</div>
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* ── Schedule Mode Tabs ─────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-1.5 mb-1">
            <h2 className="text-base font-bold text-foreground">Scheduling Mode</h2>
          </div>
          <div className="flex gap-2 mb-5">
            <button
              type="button"
              onClick={() => setScheduleMode("auto")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                scheduleMode === "auto"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-foreground hover:bg-muted/50"
              }`}
            >
              <Sparkles className="h-4 w-4" />
              Auto-Schedule
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                scheduleMode === "auto" ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
              }`}>Recommended</span>
            </button>
            <button
              type="button"
              onClick={() => setScheduleMode("manual")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                scheduleMode === "manual"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-foreground hover:bg-muted/50"
              }`}
            >
              <CalendarIcon className="h-4 w-4" />
              Manual Schedule
            </button>
          </div>

          {/* ── AUTO-SCHEDULE MODE ─────────────────────────────── */}
          {scheduleMode === "auto" && (
            <div className="space-y-6">
              {/* SEO Advisory */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <p className="font-semibold">SEO Publishing Frequency Guide</p>
                  <p>
                    <strong>Optimal for SEO: 2–3 posts per week</strong> (every 2–4 days). Consistent, frequent publishing signals authority and freshness to search engines, helping your content rank faster.
                  </p>
                  <p>
                    <strong>Special dates:</strong> For seasonal content (Christmas, EOFY, etc.), publish 3–6 months in advance to allow Google time to index and rank before the peak period.
                  </p>
                  <p className="text-blue-600 dark:text-blue-400">
                    Avoid publishing more than once per day — it dilutes the SEO value of each post.
                  </p>
                </div>
              </div>

              {/* Interval selector */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Publishing Interval</h3>
                <p className="text-xs text-muted-foreground mb-3">How many days between each article?</p>
                <div className="flex flex-wrap gap-2">
                  {AUTO_INTERVALS.map((opt) => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => setAutoIntervalDays(opt.days)}
                      className={`relative px-3 py-2 rounded-lg border text-left transition-all ${
                        autoIntervalDays === opt.days
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {opt.recommended && (
                        <span className={`absolute -top-1.5 -right-1.5 text-[9px] px-1 py-0.5 rounded-full font-bold ${
                          autoIntervalDays === opt.days
                            ? "bg-white text-primary"
                            : "bg-primary text-primary-foreground"
                        }`}>★</span>
                      )}
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className={`text-[11px] ${autoIntervalDays === opt.days ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {opt.sublabel}
                      </div>
                    </button>
                  ))}
                </div>
                {/* Custom interval input */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Or enter custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={autoIntervalDays}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (v >= 1 && v <= 30) setAutoIntervalDays(v);
                    }}
                    className="w-16 text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>

              {/* Start Date */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">First Article Date</h3>
                <p className="text-xs text-muted-foreground mb-3">When should the first article publish?</p>
                <div className="inline-block">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(d) => d && setStartDate(d)}
                    disabled={{ before: new Date() }}
                    className="rounded-xl border border-border bg-card"
                  />
                </div>
              </div>

              {/* Preview summary */}
              {autoPreviewDates.length > 0 && (
                <div className="p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      {autoPreviewDates.length} articles will be auto-scheduled
                    </span>
                  </div>
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 space-y-0.5">
                    <p>First article: <strong>{autoPreviewDates[0].date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></p>
                    {autoPreviewDates.length > 1 && (
                      <p>Last article: <strong>{autoPreviewDates[autoPreviewDates.length - 1].date.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></p>
                    )}
                    {totalAutoWeeks > 0 && (
                      <p>Total span: <strong>{totalAutoWeeks} week{totalAutoWeeks !== 1 ? "s" : ""}</strong></p>
                    )}
                    <p className="text-emerald-500 mt-1">Articles publish automatically at 9am UTC — no manual action needed.</p>
                  </div>
                </div>
              )}

              {/* Auto-schedule button */}
              <Button
                size="lg"
                disabled={!allApproved || autoSchedule.isPending || autoPreviewDates.length === 0}
                onClick={handleAutoSchedule}
                className="w-full sm:w-auto min-w-[260px]"
              >
                {autoSchedule.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {autoSchedule.isPending
                  ? `Scheduling ${autoPreviewDates.length} articles…`
                  : `Auto-Schedule ${autoPreviewDates.length} Articles →`}
              </Button>
              {!allApproved && (
                <p className="text-xs text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  Approve all articles first before auto-scheduling.
                </p>
              )}
            </div>
          )}

          {/* ── MANUAL SCHEDULE MODE ───────────────────────────── */}
          {scheduleMode === "manual" && (
            <div className="space-y-6">
              {/* SEO Advisory */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/8 border border-blue-500/20">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                  <p className="font-semibold">SEO Publishing Frequency Guide</p>
                  <p>
                    <strong>Optimal for SEO: 2–3 posts per week.</strong> "Every 3 Days" or "Every 2 Days" are the sweet spots for most businesses — frequent enough to signal authority, manageable enough to sustain.
                  </p>
                  <p>
                    <strong>Planning seasonal content?</strong> Publish Christmas, EOFY, or event-based articles 3–6 months in advance so Google has time to index and rank them before the peak period arrives.
                  </p>
                </div>
              </div>

              {/* Publish As */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="text-sm font-semibold text-foreground">Publish As</h3>
                  <HelpLink slug="scheduled-vs-drafts" label="Scheduled vs Drafts" />
                </div>
                <div className="flex gap-3">
                  {(["scheduled", "drafts"] as PublishAs[]).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setPublishAs(opt)}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                        publishAs === opt
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {opt === "scheduled" ? "Scheduled" : "Drafts"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {publishAs === "scheduled"
                    ? "Articles will be published automatically on their scheduled dates."
                    : "Articles will be sent as drafts — you publish them manually from your CMS."}
                </p>
              </div>

              {/* Cadence */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="text-sm font-semibold text-foreground">Publishing Cadence</h3>
                  <HelpLink slug="publishing-cadence" label="How to choose your cadence" />
                </div>
                <p className="text-xs text-muted-foreground mb-3">How frequently should articles be published?</p>
                <div className="flex flex-wrap gap-2">
                  {CADENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setCadence(opt.value)}
                      className={`relative px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                        cadence === opt.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {opt.recommended && (
                        <span className={`absolute -top-1.5 -right-1.5 text-[9px] px-1 py-0.5 rounded-full font-bold ${
                          cadence === opt.value ? "bg-white text-primary" : "bg-primary text-primary-foreground"
                        }`}>★</span>
                      )}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start Date */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Start Date</h3>
                <p className="text-xs text-muted-foreground mb-3">When should the first article be published?</p>
                <div className="inline-block">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(d) => d && setStartDate(d)}
                    disabled={{ before: new Date() }}
                    className="rounded-xl border border-border bg-card"
                  />
                </div>
              </div>

              {/* Save & Preview */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleSaveAndPreview}
                  disabled={saveSchedule.isPending || !business?.id}
                >
                  {saveSchedule.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CalendarIcon className="h-4 w-4 mr-2" />
                  )}
                  Save &amp; Preview Calendar
                </Button>
              </div>

              {/* Send All to CMS */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="text-xs text-muted-foreground">
                  {allApproved
                    ? `${approvedCount} articles ready to ${selectedMethod === "export_zip" ? "export" : "publish"}`
                    : `${totalCount - approvedCount} articles still need approval`}
                </div>
                <Button
                  size="lg"
                  disabled={!allApproved || confirmSchedule.isPending || publishAll.isPending || saveSchedule.isPending}
                  onClick={handleSendToCMS}
                  className="min-w-[220px]"
                >
                  {(confirmSchedule.isPending || publishAll.isPending || saveSchedule.isPending) ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : selectedMethod === "export_zip" ? (
                    <Download className="h-4 w-4 mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {selectedMethod === "export_zip"
                    ? "Download Export ZIP"
                    : "Send All to CMS & Schedule →"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Publishing Calendar Preview — shown for both modes */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Publishing Calendar Preview</h2>
          <p className="text-xs text-muted-foreground mb-4">
            {previewDates.length > 0
              ? `${previewDates.length} articles across ${Math.ceil(
                  (previewDates[previewDates.length - 1].date.getTime() - startDate.getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1} days`
              : "Set a cadence and start date to preview the calendar."}
          </p>

          <div className="flex items-center gap-3 mb-3">
            <button
              className="p-1 rounded hover:bg-muted transition-colors"
              onClick={() => {
                const d = new Date(calendarMonth.year, calendarMonth.month - 1, 1);
                setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center">{monthName}</span>
            <button
              className="p-1 rounded hover:bg-muted transition-colors"
              onClick={() => {
                const d = new Date(calendarMonth.year, calendarMonth.month + 1, 1);
                setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
              }}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day, i) => {
                const articlesOnDay = day ? previewDates.filter((p) => isSameDay(p.date, day)) : [];
                const isToday = day ? isSameDay(day, new Date()) : false;
                return (
                  <div
                    key={i}
                    className={`min-h-[80px] p-1.5 border-b border-r border-border last:border-r-0 ${!day ? "bg-muted/30" : ""}`}
                  >
                    {day && (
                      <>
                        <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                        }`}>
                          {day.getDate()}
                        </div>
                        {articlesOnDay.map((a, j) => (
                          <div
                            key={j}
                            className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate font-medium ${
                              a.level === "cornerstone"
                                ? "bg-violet-500/15 text-violet-400"
                                : a.level === "pillar"
                                ? "bg-primary/15 text-primary"
                                : "bg-secondary text-muted-foreground"
                            }`}
                            title={a.title}
                          >
                            {a.title}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
    </DashboardLayout>
  );
}
