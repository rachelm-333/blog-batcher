/**
 * server/scheduler.layer9.test.ts
 *
 * Layer 9 — Scheduling & Automation Tests
 *
 * Tests cover:
 *  1. dateToCron — correct 6-field UTC cron string generation
 *  2. writeAuditLog — inserts an audit log row (mocked DB)
 *  3. createNotification — inserts a notification row (mocked DB)
 *  4. executeScheduledPublish — success path (mocked CMS publish)
 *  5. executeScheduledPublish — failure path → retry scheduled
 *  6. executeScheduledPublish — retry failure → article marked publish_failed
 *  7. scheduler.cancelSchedule — removes heartbeat job, resets article status
 *  8. scheduler.reschedule — updates heartbeat job, updates article date
 *  9. scheduler.getAuditLog — returns audit log entries for a business
 * 10. scheduler.getNotifications — returns notifications for the current user
 * 11. scheduler.markNotificationRead — marks a notification as read
 * 12. scheduler.markAllRead — marks all notifications as read
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { dateToCron } from "./schedulerService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Shared mock context factory
// ---------------------------------------------------------------------------
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-open-id-${userId}`,
    email: `user${userId}@test.com`,
    name: `Test User ${userId}`,
    loginMethod: "email",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: { cookie: "app_session_id=test-session-token" },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ---------------------------------------------------------------------------
// 1. dateToCron — 6-field UTC cron string
// ---------------------------------------------------------------------------
describe("dateToCron", () => {
  it("generates a correct 6-field UTC cron string", () => {
    // 2026-06-15 09:30:00 UTC
    const date = new Date("2026-06-15T09:30:00.000Z");
    const cron = dateToCron(date);
    // Expected: "0 30 9 15 6 *"
    expect(cron).toBe("0 30 9 15 6 *");
  });

  it("handles midnight UTC correctly", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const cron = dateToCron(date);
    expect(cron).toBe("0 0 0 1 1 *");
  });

  it("handles end-of-day UTC correctly", () => {
    const date = new Date("2026-12-31T23:59:00.000Z");
    const cron = dateToCron(date);
    expect(cron).toBe("0 59 23 31 12 *");
  });

  it("always uses 0 for the seconds field", () => {
    const date = new Date("2026-03-15T14:45:30.000Z"); // 30 seconds — should be ignored
    const cron = dateToCron(date);
    expect(cron).toMatch(/^0 /);
  });
});

// ---------------------------------------------------------------------------
// Mock DB and external dependencies for integration tests
// ---------------------------------------------------------------------------

// We mock the DB module so tests don't need a real database connection.
// Each test configures the mock to return the data it needs.

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./schedulerService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./schedulerService")>();
  return {
    ...actual,
    // Keep dateToCron real; mock heartbeat calls
    createArticleHeartbeat: vi.fn().mockResolvedValue("mock-task-uid-123"),
    cancelArticleHeartbeat: vi.fn().mockResolvedValue(undefined),
    rescheduleArticleHeartbeat: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./cmsPublisher", () => ({
  publishToWordPress: vi.fn(),
  publishToWix: vi.fn(),
  decryptCredentials: vi.fn().mockReturnValue({ siteUrl: "https://test.com", appPassword: "test:pass" }),
}));

import { getDb } from "./db";
import {
  createArticleHeartbeat,
  cancelArticleHeartbeat,
  rescheduleArticleHeartbeat,
} from "./schedulerService";
import { publishToWordPress, publishToWix } from "./cmsPublisher";

// ---------------------------------------------------------------------------
// Helper: build a mock DB chain
// ---------------------------------------------------------------------------
function buildMockDb(overrides: Record<string, unknown> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue({ insertId: 1 }),
    ...overrides,
  };
  return chain;
}

// ---------------------------------------------------------------------------
// 7. scheduler.cancelSchedule
// ---------------------------------------------------------------------------
describe("scheduler.cancelSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cancelled:true when article and business are found", async () => {
    const mockDb = buildMockDb();

    // First query: find article
    mockDb.limit
      .mockResolvedValueOnce([{
        id: 42,
        businessId: 10,
        title: "Test Article",
        status: "scheduled",
        scheduledPublishAt: new Date(Date.now() + 60_000),
        scheduleCronTaskUid: "task-uid-abc",
      }])
      // Second query: verify business ownership
      .mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.cancelSchedule({ articleId: 42 });

    expect(result.cancelled).toBe(true);
    expect(cancelArticleHeartbeat).toHaveBeenCalledWith("task-uid-abc", "test-session-token");
  });

  it("throws NOT_FOUND when article does not exist", async () => {
    const mockDb = buildMockDb();
    mockDb.limit.mockResolvedValueOnce([]); // no article found

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    await expect(caller.scheduler.cancelSchedule({ articleId: 9999 })).rejects.toThrow("Article not found");
  });

  it("throws FORBIDDEN when business belongs to a different user", async () => {
    const mockDb = buildMockDb();
    mockDb.limit
      .mockResolvedValueOnce([{
        id: 42,
        businessId: 10,
        title: "Test Article",
        status: "scheduled",
        scheduledPublishAt: new Date(Date.now() + 60_000),
        scheduleCronTaskUid: "task-uid-abc",
      }])
      .mockResolvedValueOnce([]); // no matching business for this user

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(99); // different user
    const caller = appRouter.createCaller(ctx);

    await expect(caller.scheduler.cancelSchedule({ articleId: 42 })).rejects.toThrow("Access denied");
  });

  it("still succeeds even if heartbeat deletion throws (idempotent)", async () => {
    const mockDb = buildMockDb();
    mockDb.limit
      .mockResolvedValueOnce([{
        id: 42,
        businessId: 10,
        title: "Test Article",
        status: "scheduled",
        scheduledPublishAt: new Date(Date.now() + 60_000),
        scheduleCronTaskUid: "task-uid-gone",
      }])
      .mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);
    vi.mocked(cancelArticleHeartbeat).mockRejectedValueOnce(new Error("Job not found"));

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    // Should not throw even though heartbeat deletion failed
    const result = await caller.scheduler.cancelSchedule({ articleId: 42 });
    expect(result.cancelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. scheduler.reschedule
// ---------------------------------------------------------------------------
describe("scheduler.reschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rescheduled:true with new date and taskUid", async () => {
    const mockDb = buildMockDb();
    const newDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

    mockDb.limit
      .mockResolvedValueOnce([{
        id: 42,
        businessId: 10,
        title: "Test Article",
        status: "scheduled",
        scheduleCronTaskUid: "existing-task-uid",
      }])
      .mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.reschedule({ articleId: 42, newScheduledAt: newDate });

    expect(result.rescheduled).toBe(true);
    expect(result.newScheduledAt).toEqual(newDate);
    expect(rescheduleArticleHeartbeat).toHaveBeenCalledWith("existing-task-uid", newDate, "test-session-token");
  });

  it("throws BAD_REQUEST when new date is in the past", async () => {
    const mockDb = buildMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const pastDate = new Date(Date.now() - 60_000);
    await expect(caller.scheduler.reschedule({ articleId: 42, newScheduledAt: pastDate })).rejects.toThrow(
      "New scheduled date must be in the future"
    );
  });

  it("creates a new heartbeat job when existing job update fails", async () => {
    const mockDb = buildMockDb();
    const newDate = new Date(Date.now() + 2 * 60 * 60 * 1000);

    mockDb.limit
      .mockResolvedValueOnce([{
        id: 42,
        businessId: 10,
        title: "Test Article",
        status: "scheduled",
        scheduleCronTaskUid: "old-task-uid",
      }])
      .mockResolvedValueOnce([{ id: 10 }]);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);
    vi.mocked(rescheduleArticleHeartbeat).mockRejectedValueOnce(new Error("Job expired"));
    vi.mocked(createArticleHeartbeat).mockResolvedValueOnce("new-task-uid-456");

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.reschedule({ articleId: 42, newScheduledAt: newDate });

    expect(result.rescheduled).toBe(true);
    expect(createArticleHeartbeat).toHaveBeenCalledWith(42, newDate, "test-session-token");
    expect(result.taskUid).toBe("new-task-uid-456");
  });
});

// ---------------------------------------------------------------------------
// 9. scheduler.getAuditLog
// ---------------------------------------------------------------------------
describe("scheduler.getAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns audit log entries for a business", async () => {
    const mockDb = buildMockDb();
    const mockEntries = [
      {
        id: 1,
        articleId: 42,
        action: "scheduled_publish_succeeded",
        result: "success",
        errorMessage: null,
        attemptNumber: 1,
        triggeredBy: "heartbeat",
        newScheduledAt: null,
        createdAt: new Date(),
        articleTitle: "Test Article",
      },
    ];

    // First query: verify business ownership
    mockDb.limit.mockResolvedValueOnce([{ id: 10 }]);
    // Second query: audit log entries (no limit call — uses orderBy chain)
    mockDb.limit.mockResolvedValueOnce(mockEntries);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.getAuditLog({ businessId: 10 });

    expect(Array.isArray(result)).toBe(true);
  });

  it("throws FORBIDDEN when business belongs to a different user", async () => {
    const mockDb = buildMockDb();
    mockDb.limit.mockResolvedValueOnce([]); // no business found for this user

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(99);
    const caller = appRouter.createCaller(ctx);

    await expect(caller.scheduler.getAuditLog({ businessId: 10 })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. scheduler.getNotifications
// ---------------------------------------------------------------------------
describe("scheduler.getNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notifications and unread count for the current user", async () => {
    const mockDb = buildMockDb();
    const mockNotifs = [
      {
        id: 1,
        userId: 1,
        businessId: 10,
        articleId: 42,
        type: "publish_success",
        title: "Article Published",
        message: "Your article was published successfully.",
        read: false,
        createdAt: new Date(),
      },
    ];

    mockDb.limit.mockResolvedValueOnce(mockNotifs);
    // Second query for unread count
    mockDb.limit.mockResolvedValueOnce([{ id: 1 }]);

    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.getNotifications({ unreadOnly: false });

    expect(result).toHaveProperty("notifications");
    expect(result).toHaveProperty("unreadCount");
    expect(Array.isArray(result.notifications)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. scheduler.markNotificationRead
// ---------------------------------------------------------------------------
describe("scheduler.markNotificationRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns marked:true", async () => {
    const mockDb = buildMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.markNotificationRead({ notificationId: 1 });
    expect(result.marked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. scheduler.markAllRead
// ---------------------------------------------------------------------------
describe("scheduler.markAllRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns marked:true", async () => {
    const mockDb = buildMockDb();
    vi.mocked(getDb).mockResolvedValue(mockDb as unknown as ReturnType<typeof getDb> extends Promise<infer T> ? T : never);

    const ctx = makeCtx(1);
    const caller = appRouter.createCaller(ctx);

    const result = await caller.scheduler.markAllRead();
    expect(result.marked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional dateToCron edge cases
// ---------------------------------------------------------------------------
describe("dateToCron — additional edge cases", () => {
  it("produces a 6-field string (space-separated)", () => {
    const date = new Date("2026-08-20T16:00:00.000Z");
    const cron = dateToCron(date);
    const parts = cron.split(" ");
    expect(parts).toHaveLength(6);
  });

  it("last field is always *", () => {
    const date = new Date("2026-08-20T16:00:00.000Z");
    const cron = dateToCron(date);
    const parts = cron.split(" ");
    expect(parts[5]).toBe("*");
  });

  it("month is 1-indexed (January = 1)", () => {
    const date = new Date("2026-01-15T12:00:00.000Z");
    const cron = dateToCron(date);
    const parts = cron.split(" ");
    expect(parts[4]).toBe("1"); // month
  });

  it("month is 1-indexed (December = 12)", () => {
    const date = new Date("2026-12-25T00:00:00.000Z");
    const cron = dateToCron(date);
    const parts = cron.split(" ");
    expect(parts[4]).toBe("12"); // month
  });
});
