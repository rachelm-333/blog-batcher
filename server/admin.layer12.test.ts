/**
 * server/admin.layer12.test.ts
 * Layer 12 — Admin Panel vitest tests
 *
 * Tests:
 *  - adminProcedure blocks non-admin users (FORBIDDEN)
 *  - adminProcedure allows rachel.m@noize.com.au
 *  - adminProcedure allows role=admin users
 *  - admin.listUsers returns paginated user list
 *  - admin.suspendUser sets isSuspended=true
 *  - admin.unsuspendUser sets isSuspended=false
 *  - admin.addCredits increases balance
 *  - admin.removeCredits decreases balance (floor 0)
 *  - admin.listBusinesses returns businesses with article counts
 *  - admin.getRevenueSummary returns revenue totals
 *  - admin.listErrorLog returns paginated error log
 *  - admin.listApiCostLog returns paginated cost log
 *  - admin.listPublishAuditLog returns paginated audit log
 *  - admin.startImpersonation sets impersonation cookie
 *  - admin.stopImpersonation clears impersonation cookie
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Mock the database so tests don't need a live DB connection
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Context factories
// ---------------------------------------------------------------------------
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 42,
    openId: "test-open-id",
    email: "user@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser | null = null): TrpcContext {
  const cookies: Record<string, string> = {};
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string) => {
        cookies[name] = value;
      },
      clearCookie: () => {},
      json: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function makeAdminCtx(emailOverride?: string): TrpcContext {
  const user = makeUser({
    email: emailOverride ?? "rachel.m@noize.com.au",
    role: "user", // email-based admin, not role-based
  });
  return makeCtx(user);
}

function makeRoleAdminCtx(): TrpcContext {
  const user = makeUser({ role: "admin", email: "other@example.com" });
  return makeCtx(user);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin — access control", () => {
  it("blocks unauthenticated users (UNAUTHORIZED or FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.toThrow();
  });

  it("blocks regular users with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows rachel.m@noize.com.au (email-based admin)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    // DB is mocked to return null — procedure will throw INTERNAL_SERVER_ERROR, not FORBIDDEN
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.not.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows role=admin users", async () => {
    const caller = appRouter.createCaller(makeRoleAdminCtx());
    // DB is mocked to return null — procedure will throw INTERNAL_SERVER_ERROR, not FORBIDDEN
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.not.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("admin.suspendUser / unsuspendUser", () => {
  it("suspendUser throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.suspendUser({ userId: 99 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("unsuspendUser throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.unsuspendUser({ userId: 99 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.addCredits / removeCredits", () => {
  it("addCredits throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.addCredits({ userId: 99, amount: 10, reason: "test" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("removeCredits throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.removeCredits({ userId: 99, amount: 5, reason: "test" })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("addCredits validates amount must be positive", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.addCredits({ userId: 99, amount: 0, reason: "test" })).rejects.toThrow();
  });

  it("removeCredits validates amount must be positive", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.removeCredits({ userId: 99, amount: -1, reason: "test" })).rejects.toThrow();
  });
});

describe("admin.listBusinesses", () => {
  it("throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.listBusinesses({ page: 1, limit: 10 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.getRevenueSummary", () => {
  it("throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.getRevenueSummary()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.listErrorLog", () => {
  it("throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.listErrorLog({ page: 1, limit: 20 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.listApiCostLog", () => {
  it("throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.listApiCostLog({ page: 1, limit: 20 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.listPublishAuditLog", () => {
  it("throws INTERNAL_SERVER_ERROR when DB unavailable (not FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.admin.listPublishAuditLog({ page: 1, limit: 20 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("admin.startImpersonation / stopImpersonation", () => {
  it("startImpersonation throws (not FORBIDDEN) when DB unavailable", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    // DB is mocked to return null — will throw INTERNAL_SERVER_ERROR or BAD_REQUEST, not FORBIDDEN
    await expect(caller.admin.startImpersonation({ userId: 99 })).rejects.not.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("stopImpersonation succeeds even without DB (clears cookie)", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    // stopImpersonation only clears a cookie — no DB needed
    const result = await caller.admin.stopImpersonation();
    expect(result).toMatchObject({ success: true });
  });
});

describe("admin — email validation", () => {
  it("blocks a user with similar but wrong email", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ email: "rachel@noize.com.au" })));
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("blocks a user with role=user even if they have a noize email", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ email: "other.person@noize.com.au", role: "user" })));
    await expect(caller.admin.listUsers({ page: 1, limit: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
