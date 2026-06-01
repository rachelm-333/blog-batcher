/**
 * Stage 5 — Publish & Schedule Page
 *
 * Layout (matches mockup exactly):
 *  1. Publishing Method cards (Wix, WordPress, Zapier, Export ZIP)
 *  2. Publish As: Scheduled / Drafts toggle
 *  3. Publishing Cadence selector (Daily / Every 2 Days / Every 3 Days / Once a Week / Twice a Week)
 *  4. Start Date picker
 *  5. Publishing Calendar Preview (month view with article titles on publish dates)
 *  6. "Send All to CMS & Schedule →" button (or "Download Export ZIP" for ZIP method)
 *
 * Gate: all articles must be approved before publish options unlock.
 */

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  Settings,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublishMethod = "wix" | "wordpress" | "zapier" | "export_zip";
type PublishAs = "scheduled" | "drafts";
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
    icon: <span className="text-2xl font-black text-blue-600">W</span>,
  },
  {
    id: "wordpress",
    label: "WordPress",
    description: "REST API + Application Password",
    icon: <span className="text-2xl font-black text-blue-800">WP</span>,
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
    icon: <Download className="h-6 w-6 text-gray-600" />,
  },
];

const CADENCE_OPTIONS: { value: Cadence; label: string; description: string }[] = [
  { value: "every_day", label: "Daily", description: "One article every day" },
  { value: "every_2_days", label: "Every 2 Days", description: "One article every 2 days" },
  { value: "every_3_days", label: "Every 3 Days", description: "One article every 3 days" },
  { value: "once_per_week", label: "Once a Week", description: "One article per week" },
  { value: "twice_per_week", label: "Twice a Week", description: "Two articles per week" },
];

// ---------------------------------------------------------------------------
// Calendar preview helpers
// ---------------------------------------------------------------------------

function getMonthDays(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
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

  // Articles list (to check approval gate)
  const { data: articlesData, isLoading: articlesLoading } = trpc.articles.getAll.useQuery(
    { businessId: business?.id ?? 0 },
    { enabled: !!business?.id }
  );

  // Schedule data
  const { data: scheduleData, isLoading: scheduleLoading, refetch: refetchSchedule } =
    trpc.schedule.get.useQuery(
      { businessId: business?.id ?? 0 },
      { enabled: !!business?.id }
    );

  // Local state
  const [selectedMethod, setSelectedMethod] = useState<PublishMethod>("export_zip");
  const [publishAs, setPublishAs] = useState<PublishAs>("scheduled");
  const [cadence, setCadence] = useState<Cadence>("once_per_week");
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  });
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Sync cadence from saved schedule
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
    onError: (err) => toast.error(err.message),
  });

  const confirmSchedule = trpc.schedule.confirm.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.scheduledCount} articles scheduled!`);
      refetchSchedule();
    },
    onError: (err) => toast.error(err.message),
  });

  const publishAll = trpc.articles.publishAll.useMutation({
    onSuccess: (data) => {
      if (data.failed > 0) {
        toast.error(`Published ${data.published}/${data.total} articles. ${data.failed} failed — check the Review screen for details.`);
      } else {
        toast.success(`All ${data.published} articles published successfully!`);
      }
      refetchSchedule();
    },
    onError: (err) => toast.error(err.message),
  });

  // Derived state
  const articleList = articlesData ?? [];
  const approvedCount = articleList.filter(
    a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
  ).length;
  const totalCount = articleList.length;
  const allApproved = approvedCount === totalCount && totalCount > 0;

  // Calculate preview publish dates
  const previewDates = useMemo(() => {
    if (!allApproved || articleList.length === 0) return [];
    const approvedArticles = articleList.filter(
      a => a.status === "approved" || a.status === "scheduled" || a.status === "published"
    );
    const intervalDays =
      cadence === "every_day" ? 1 :
      cadence === "every_2_days" ? 2 :
      cadence === "every_3_days" ? 3 :
      cadence === "once_per_week" ? 7 :
      4; // twice_per_week

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

  // Stage guard
  useEffect(() => {
    if (!authLoading && !bizLoading) {
      if (!user) {
        navigate("/login");
        return;
      }
      if (business && (business.currentStage ?? 0) < 4) {
        navigate("/generate");
      }
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
    // Save schedule, confirm it (sets scheduledPublishAt on articles), then publish all
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

  const monthDays = getMonthDays(calendarMonth.year, calendarMonth.month);
  const monthName = new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/review")}
              className="text-xs"
            >
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
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700 flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div>
              <div className="font-semibold">All articles must be approved before publishing.</div>
              <div className="text-xs mt-1">
                {totalCount - approvedCount} article{totalCount - approvedCount !== 1 ? "s" : ""} still need approval.{" "}
                <button
                  className="underline text-amber-700"
                  onClick={() => navigate("/review")}
                >
                  Go to Review →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Publishing Method */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Publishing Method</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose how your articles will be delivered to your website.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PUBLISH_METHODS.map((method) => (
              <button
                key={method.id}
                onClick={() => {
                  if (method.comingSoon) {
                    toast.info(`${method.label} integration coming soon.`);
                    return;
                  }
                  setSelectedMethod(method.id);
                }}
                className={`relative p-4 rounded-xl border text-left transition-all ${
                  selectedMethod === method.id
                    ? "bg-primary/10 border-primary shadow-sm"
                    : "bg-card border-border hover:bg-muted/50"
                } ${method.comingSoon ? "opacity-60" : ""}`}
              >
                {method.comingSoon && (
                  <span className="absolute top-2 right-2 text-[10px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                    Soon
                  </span>
                )}
                <div className="mb-2">{method.icon}</div>
                <div className="text-sm font-semibold text-foreground">{method.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{method.description}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Publish As */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Publish As</h2>
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
        </section>

        {/* Publishing Cadence */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Publishing Cadence</h2>
          <p className="text-xs text-muted-foreground mb-4">
            How frequently should articles be published?
          </p>
          <div className="flex flex-wrap gap-2">
            {CADENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCadence(opt.value)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                  cadence === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:bg-muted/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Start Date */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Start Date</h2>
          <p className="text-xs text-muted-foreground mb-3">
            When should the first article be published?
          </p>
          <div className="inline-block">
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={(d) => d && setStartDate(d)}
              disabled={{ before: new Date() }}
              className="rounded-xl border border-border bg-card"
            />
          </div>
        </section>

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

        {/* Publishing Calendar Preview */}
        <section>
          <h2 className="text-base font-bold text-foreground mb-1">Publishing Calendar Preview</h2>
          <p className="text-xs text-muted-foreground mb-4">
            {previewDates.length > 0
              ? `${previewDates.length} articles scheduled across ${Math.ceil(
                  (previewDates[previewDates.length - 1].date.getTime() - startDate.getTime()) /
                    (1000 * 60 * 60 * 24)
                ) + 1} days`
              : "Approve all articles and set a cadence to preview the calendar."}
          </p>

          {/* Month navigation */}
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
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center">
              {monthName}
            </span>
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
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-border">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-semibold text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {monthDays.map((day, i) => {
                const articlesOnDay = day
                  ? previewDates.filter((p) => isSameDay(p.date, day))
                  : [];
                const isToday = day ? isSameDay(day, new Date()) : false;
                return (
                  <div
                    key={i}
                    className={`min-h-[80px] p-1.5 border-b border-r border-border last:border-r-0 ${
                      !day ? "bg-muted/30" : ""
                    }`}
                  >
                    {day && (
                      <>
                        <div
                          className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                            isToday
                              ? "bg-primary text-primary-foreground"
                              : "text-foreground"
                          }`}
                        >
                          {day.getDate()}
                        </div>
                        {articlesOnDay.map((a, j) => (
                          <div
                            key={j}
                            className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate font-medium ${
                              a.level === "cornerstone"
                                ? "bg-purple-100 text-purple-700"
                                : a.level === "pillar"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
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
    </div>
  );
}
