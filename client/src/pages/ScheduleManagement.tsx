/**
 * client/src/pages/ScheduleManagement.tsx
 *
 * Layer 9 — Schedule Management Page
 *
 * Displays:
 *  - Full publishing schedule (scheduled, published, failed articles)
 *  - Cancel / reschedule actions per article
 *  - Audit log for automated publish events
 *  - Simulate publish button (for testing)
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Calendar,
  Clock,
  XCircle,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Play,
  ChevronRight,
  FileText,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    scheduled: { variant: "default", label: "Scheduled" },
    published: { variant: "secondary", label: "Published" },
    failed: { variant: "destructive", label: "Failed" },
  };
  const v = variants[status] ?? { variant: "outline", label: status };
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

// ---------------------------------------------------------------------------
// Action badge for audit log
// ---------------------------------------------------------------------------
function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    scheduled_publish_attempted: "bg-blue-100 text-blue-800",
    scheduled_publish_succeeded: "bg-green-100 text-green-800",
    scheduled_publish_failed: "bg-red-100 text-red-800",
    retry_attempted: "bg-yellow-100 text-yellow-800",
    retry_succeeded: "bg-green-100 text-green-800",
    retry_failed: "bg-red-100 text-red-800",
    schedule_cancelled: "bg-gray-100 text-gray-800",
    schedule_rescheduled: "bg-purple-100 text-purple-800",
  };
  const label = action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[action] ?? "bg-gray-100 text-gray-800"}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reschedule dialog
// ---------------------------------------------------------------------------
function RescheduleDialog({
  articleId,
  articleTitle,
  currentDate,
  open,
  onClose,
  businessId,
}: {
  articleId: number;
  articleTitle: string;
  currentDate: Date | null;
  open: boolean;
  onClose: () => void;
  businessId: number;
}) {
  const utils = trpc.useUtils();
  const [newDate, setNewDate] = useState(() => {
    if (currentDate) {
      const d = new Date(currentDate);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    }
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const reschedule = trpc.scheduler.reschedule.useMutation({
    onSuccess: () => {
      toast.success("Article rescheduled successfully");
      utils.scheduler.getSchedule.invalidate({ businessId });
      utils.scheduler.getAuditLog.invalidate({ businessId });
      onClose();
    },
    onError: (err) => {
      toast.error(`Reschedule failed: ${err.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Article</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground line-clamp-2">{articleTitle}</p>
          <div className="space-y-2">
            <Label htmlFor="new-date">New publish date &amp; time</Label>
            <Input
              id="new-date"
              type="datetime-local"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const date = new Date(newDate);
              if (isNaN(date.getTime()) || date <= new Date()) {
                toast.error("Please select a future date");
                return;
              }
              reschedule.mutate({ articleId, newScheduledAt: date });
            }}
            disabled={reschedule.isPending}
          >
            {reschedule.isPending ? "Rescheduling..." : "Confirm Reschedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ScheduleManagement() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();

  const businessQuery = trpc.business.get.useQuery(undefined, { enabled: !!user });
  const businessId = businessQuery.data?.id;

  const scheduleQuery = trpc.scheduler.getSchedule.useQuery(
    { businessId: businessId! },
    { enabled: !!businessId }
  );

  const auditLogQuery = trpc.scheduler.getAuditLog.useQuery(
    { businessId: businessId!, limit: 100 },
    { enabled: !!businessId }
  );

  const [rescheduleTarget, setRescheduleTarget] = useState<{
    articleId: number;
    title: string;
    currentDate: Date | null;
  } | null>(null);

  const cancelSchedule = trpc.scheduler.cancelSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule cancelled. Article returned to Approved.");
      utils.scheduler.getSchedule.invalidate({ businessId });
      utils.scheduler.getAuditLog.invalidate({ businessId });
    },
    onError: (err) => toast.error(`Cancel failed: ${err.message}`),
  });

  const simulatePublish = trpc.scheduler.simulatePublish.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Simulated publish succeeded!");
      } else if (data.retryScheduled) {
        toast.warning(`Simulated publish failed — retry scheduled in 15 minutes. Error: ${data.error}`);
      } else {
        toast.error(`Simulated publish failed permanently. Error: ${data.error}`);
      }
      utils.scheduler.getSchedule.invalidate({ businessId });
      utils.scheduler.getAuditLog.invalidate({ businessId });
    },
    onError: (err) => toast.error(`Simulation failed: ${err.message}`),
  });

  if (authLoading || businessQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground text-sm">Loading schedule...</div>
        </div>
      </DashboardLayout>
    );
  }

  if (!businessId) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
          <h2 className="text-xl font-semibold">No business found</h2>
          <p className="text-muted-foreground text-sm">Complete the onboarding flow to set up your business first.</p>
          <Button onClick={() => setLocation("/dashboard")}>Go to Dashboard</Button>
        </div>
      </DashboardLayout>
    );
  }

  const articles = scheduleQuery.data ?? [];
  const auditLog = auditLogQuery.data ?? [];

  const scheduled = articles.filter(a => a.status === "scheduled");
  const published = articles.filter(a => a.status === "published");
  const failed = articles.filter(a => a.status === "failed");

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6 py-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Publishing Schedule</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage automated publishing, cancel or reschedule articles, and view the audit log.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLocation("/publish")}>
            <ChevronRight className="h-4 w-4 mr-1" />
            Back to Schedule Setup
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-500 shrink-0" />
                <div>
                  <p className="text-2xl font-bold">{scheduled.length}</p>
                  <p className="text-xs text-muted-foreground">Scheduled</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div>
                  <p className="text-2xl font-bold">{published.length}</p>
                  <p className="text-xs text-muted-foreground">Published</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-2xl font-bold">{failed.length}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main tabs */}
        <Tabs defaultValue="schedule">
          <TabsList>
            <TabsTrigger value="schedule">
              Schedule
              {scheduled.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">{scheduled.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="failed">
              Failed
              {failed.length > 0 && (
                <Badge variant="destructive" className="ml-2 text-xs">{failed.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          {/* Scheduled articles */}
          <TabsContent value="schedule" className="mt-4">
            {scheduled.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No articles currently scheduled for automated publishing.</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setLocation("/publish")}>
                    Set up a publishing schedule
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {scheduled.map(article => (
                  <Card key={article.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={article.status} />
                            <Badge variant="outline" className="text-xs capitalize">{article.level ?? "article"}</Badge>
                          </div>
                          <p className="font-medium text-sm truncate">{article.title ?? "Untitled"}</p>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                            {article.scheduledPublishAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(article.scheduledPublishAt).toLocaleString()}
                              </span>
                            )}
                            {article.scheduleCronTaskUid && (
                              <span className="text-green-600 font-medium">Job active</span>
                            )}
                          </div>
                          {article.retryScheduledAt && (
                            <p className="text-xs text-yellow-600 mt-1">
                              Retry scheduled: {new Date(article.retryScheduledAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRescheduleTarget({
                              articleId: article.id,
                              title: article.title ?? "Untitled",
                              currentDate: article.scheduledPublishAt ? new Date(article.scheduledPublishAt) : null,
                            })}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Cancel scheduled publish for "${article.title}"?`)) {
                                cancelSchedule.mutate({ articleId: article.id });
                              }
                            }}
                            disabled={cancelSchedule.isPending}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Simulate publish now (for testing)"
                            onClick={() => {
                              if (confirm(`Simulate publish for "${article.title}"? This will attempt to publish it now.`)) {
                                simulatePublish.mutate({ articleId: article.id, attemptNumber: 1 });
                              }
                            }}
                            disabled={simulatePublish.isPending}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Published articles */}
          <TabsContent value="published" className="mt-4">
            {published.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No articles have been automatically published yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {published.map(article => (
                  <Card key={article.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={article.status} />
                            <Badge variant="outline" className="text-xs capitalize">{article.level ?? "article"}</Badge>
                          </div>
                          <p className="font-medium text-sm truncate">{article.title ?? "Untitled"}</p>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                            {article.publishedAt && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                Published {new Date(article.publishedAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {article.cmsPostUrl && (
                            <a
                              href={article.cmsPostUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline mt-1 inline-block"
                            >
                              View live post
                            </a>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Failed articles */}
          <TabsContent value="failed" className="mt-4">
            {failed.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No failed publish attempts.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {failed.map(article => (
                  <Card key={article.id} className="border-destructive/30">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={article.status} />
                            <Badge variant="outline" className="text-xs capitalize">{article.level ?? "article"}</Badge>
                          </div>
                          <p className="font-medium text-sm truncate">{article.title ?? "Untitled"}</p>
                          {article.errorMessage && (
                            <p className="text-xs text-destructive mt-1 line-clamp-2">{article.errorMessage}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Retries attempted: {article.publishRetryCount ?? 0}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRescheduleTarget({
                              articleId: article.id,
                              title: article.title ?? "Untitled",
                              currentDate: null,
                            })}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Simulate publish now (for testing)"
                            onClick={() => {
                              if (confirm(`Simulate retry publish for "${article.title}"?`)) {
                                simulatePublish.mutate({ articleId: article.id, attemptNumber: 1 });
                              }
                            }}
                            disabled={simulatePublish.isPending}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Audit log */}
          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Automation Audit Log</CardTitle>
                <CardDescription className="text-xs">
                  Every automated publish attempt, success, failure, retry, cancel, and reschedule is recorded here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {auditLog.length === 0 ? (
                  <div className="py-8 text-center">
                    <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No audit log entries yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditLog.map(entry => (
                      <div key={entry.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <ActionBadge action={entry.action} />
                            <span className="text-xs text-muted-foreground">
                              Attempt #{entry.attemptNumber} · {entry.triggeredBy}
                            </span>
                          </div>
                          <p className="text-xs font-medium mt-0.5 truncate">
                            {entry.articleTitle ?? `Article #${entry.articleId}`}
                          </p>
                          {entry.errorMessage && (
                            <p className="text-xs text-destructive mt-0.5 line-clamp-1">{entry.errorMessage}</p>
                          )}
                          {entry.newScheduledAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Rescheduled to: {new Date(entry.newScheduledAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Reschedule dialog */}
      {rescheduleTarget && businessId && (
        <RescheduleDialog
          articleId={rescheduleTarget.articleId}
          articleTitle={rescheduleTarget.title}
          currentDate={rescheduleTarget.currentDate}
          open={!!rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          businessId={businessId}
        />
      )}
    </DashboardLayout>
  );
}
