/**
 * client/src/components/NotificationBell.tsx
 *
 * Layer 9 — In-app notification bell for the dashboard header.
 *
 * Shows unread notification count badge.
 * On click, opens a dropdown with recent notifications.
 * Clicking a notification marks it as read.
 * "Mark all read" button clears the badge.
 */

import { useState } from "react";
import { Bell, CheckCheck, AlertCircle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Notification type icon
// ---------------------------------------------------------------------------
function NotifIcon({ type }: { type: string }) {
  switch (type) {
    case "publish_success":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "publish_failed":
      return <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "retry_failed":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "schedule_cancelled":
      return <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "schedule_rescheduled":
      return <RefreshCw className="h-4 w-4 text-primary shrink-0" />;
    default:
      return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.scheduler.getNotifications.useQuery(
    { limit: 20 },
    {
      refetchInterval: open ? 10_000 : 30_000, // poll more frequently when open
    }
  );

  const markRead = trpc.scheduler.markNotificationRead.useMutation({
    onSuccess: () => {
      utils.scheduler.getNotifications.invalidate();
    },
  });

  const markAllRead = trpc.scheduler.markAllRead.useMutation({
    onSuccess: () => {
      utils.scheduler.getNotifications.invalidate();
      toast.success("All notifications marked as read");
    },
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4.5 w-4.5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-80 p-0"
        style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification list */}
        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <Bell className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-xs text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            <div>
              {notifications.map((notif, i) => (
                <div key={notif.id}>
                  <button
                    className={`w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors ${!notif.read ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                    onClick={() => {
                      if (!notif.read) {
                        markRead.mutate({ notificationId: notif.id });
                      }
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <NotifIcon type={notif.type} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-medium leading-tight ${!notif.read ? "text-foreground" : "text-muted-foreground"}`}>
                            {notif.title}
                          </p>
                          {!notif.read && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                          {notif.message}
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {new Date(notif.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </button>
                  {i < notifications.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
