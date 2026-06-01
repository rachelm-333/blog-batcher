/**
 * server/auth.test.ts
 * Vitest unit tests for Blog Batcher Layer 2 Auth procedures.
 * Tests run against the live database — each test cleans up after itself.
 */
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { users, credits } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { COOKIE_NAME } from "../shared/const";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_EMAIL = `test-auth-${Date.now()}@blogbatcher-test.invalid`;
const TEST_NAME = "Test User";
const TEST_PASSWORD = "TestPass123!";

type CookieCall = { name: string; options: Record<string, unknown> };

function makeCtx(): { ctx: TrpcContext; cookies: CookieCall[]; clearedCookies: CookieCall[] } {
  const cookies: CookieCall[] = [];
  const clearedCookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, _val: string, options: Record<string, unknown>) => {
        cookies.push({ name, options });
      },
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as unknown as TrpcContext["res"],
  };
  return { ctx, cookies, clearedCookies };
}

async function cleanupTestUser() {
  const db = await getDb();
  if (!db) return;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (u) {
    await db.delete(credits).where(eq(credits.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("auth.register", () => {
  afterEach(cleanupTestUser);

  it("creates a new user and returns success", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.register({
      name: TEST_NAME,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("verify");
  });

  it("rejects duplicate email registration", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);

    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    await expect(
      caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD })
    ).rejects.toThrow(TRPCError);
  });

  it("creates a credits row for the new user", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    const db = await getDb();
    const [u] = await db!.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
    const [c] = await db!.select().from(credits).where(eq(credits.userId, u.id)).limit(1);
    expect(c).toBeDefined();
    expect(c.balance).toBe(0);
  });
});

describe("auth.verifyEmail", () => {
  afterEach(cleanupTestUser);

  it("verifies email with valid token", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    const db = await getDb();
    const [u] = await db!
      .select({ token: users.emailVerificationToken })
      .from(users)
      .where(eq(users.email, TEST_EMAIL))
      .limit(1);

    expect(u.token).toBeTruthy();

    const result = await caller.auth.verifyEmail({ token: u.token! });
    expect(result.success).toBe(true);

    const [verified] = await db!
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, TEST_EMAIL))
      .limit(1);
    expect(verified.emailVerified).toBe(true);
  });

  it("rejects invalid token", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.verifyEmail({ token: "invalid-token-xyz" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("auth.login", () => {
  beforeEach(async () => {
    // Register and verify user
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    const db = await getDb();
    await db!.update(users).set({ emailVerified: true }).where(eq(users.email, TEST_EMAIL));
  });
  afterEach(cleanupTestUser);

  it("sets session cookie on valid credentials", async () => {
    const { ctx, cookies } = makeCtx();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.login({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(result.success).toBe(true);
    expect(result.user.email).toBe(TEST_EMAIL);
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(COOKIE_NAME);
    expect(cookies[0].options).toMatchObject({ httpOnly: true, path: "/" });
  });

  it("rejects wrong password", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.login({ email: TEST_EMAIL, password: "WrongPassword!" })
    ).rejects.toThrow(TRPCError);
  });

  it("rejects login for unverified email", async () => {
    // Create a second unverified user
    const unverifiedEmail = `unverified-${Date.now()}@blogbatcher-test.invalid`;
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: "Unverified", email: unverifiedEmail, password: TEST_PASSWORD });

    await expect(
      caller.auth.login({ email: unverifiedEmail, password: TEST_PASSWORD })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Cleanup
    const db = await getDb();
    const [u] = await db!.select({ id: users.id }).from(users).where(eq(users.email, unverifiedEmail)).limit(1);
    if (u) {
      await db!.delete(credits).where(eq(credits.userId, u.id));
      await db!.delete(users).where(eq(users.id, u.id));
    }
  });
});

describe("auth.logout", () => {
  it("clears the session cookie", async () => {
    const { ctx, clearedCookies } = makeCtx();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result.success).toBe(true);
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0].name).toBe(COOKIE_NAME);
    expect(clearedCookies[0].options).toMatchObject({ maxAge: -1 });
  });
});

describe("auth.forgotPassword", () => {
  afterEach(cleanupTestUser);

  it("returns success even for unknown email (no enumeration)", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.forgotPassword({ email: "nobody@example.com" });
    expect(result.success).toBe(true);
  });

  it("sets reset token for known verified user", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    const db = await getDb();
    await db!.update(users).set({ emailVerified: true }).where(eq(users.email, TEST_EMAIL));

    await caller.auth.forgotPassword({ email: TEST_EMAIL });

    const [u] = await db!
      .select({ token: users.passwordResetToken })
      .from(users)
      .where(eq(users.email, TEST_EMAIL))
      .limit(1);
    expect(u.token).toBeTruthy();
  });
});

describe("auth.resetPassword", () => {
  afterEach(cleanupTestUser);

  it("updates password with valid token", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.register({ name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD });

    const db = await getDb();
    await db!.update(users).set({ emailVerified: true }).where(eq(users.email, TEST_EMAIL));
    await caller.auth.forgotPassword({ email: TEST_EMAIL });

    const [u] = await db!
      .select({ token: users.passwordResetToken })
      .from(users)
      .where(eq(users.email, TEST_EMAIL))
      .limit(1);

    const result = await caller.auth.resetPassword({ token: u.token!, password: "NewPass456!" });
    expect(result.success).toBe(true);

    // Should now be able to log in with new password
    const { ctx: ctx2, cookies } = makeCtx();
    const caller2 = appRouter.createCaller(ctx2);
    const loginResult = await caller2.auth.login({ email: TEST_EMAIL, password: "NewPass456!" });
    expect(loginResult.success).toBe(true);
    expect(cookies).toHaveLength(1);
  });

  it("rejects invalid reset token", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.resetPassword({ token: "bad-token", password: "NewPass456!" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("auth.resendVerification", () => {
  afterEach(cleanupTestUser);

  it("returns success silently for unknown email", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.resendVerification({ email: "nobody@example.com" });
    expect(result.success).toBe(true);
  });
});

describe("Resend email secret", () => {
  it("RESEND_API_KEY is configured in the environment", () => {
    expect(process.env.RESEND_API_KEY).toBeTruthy();
    expect(process.env.RESEND_API_KEY!.length).toBeGreaterThan(10);
  });
});
