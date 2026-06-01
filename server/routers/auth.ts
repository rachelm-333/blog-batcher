/**
 * server/routers/auth.ts
 * Blog Batcher email+password authentication procedures.
 *
 * Procedures:
 *   auth.register       — create account, send verification email
 *   auth.verifyEmail    — consume token, activate account
 *   auth.login          — email+password → JWT cookie (30-day)
 *   auth.logout         — clear JWT cookie
 *   auth.me             — return current user from session
 *   auth.forgotPassword — send password reset email
 *   auth.resetPassword  — consume token, update password hash
 *   auth.resendVerification — re-send verification email
 */
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { credits, users } from "../../drizzle/schema";
import { sendPasswordResetEmail, sendVerificationEmail } from "../email";
import { getDb } from "../db";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME } from "../../shared/const";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { signSessionToken, verifySessionToken } from "../_core/session";

const BCRYPT_ROUNDS = 12;
const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
const RESET_TOKEN_EXPIRY_HOURS = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function generateToken(): Promise<string> {
  return nanoid(48);
}

function addHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const authRouter = router({
  // ─── Register ────────────────────────────────────────────────────────────
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required").max(120),
        email: z.string().email("Invalid email address").toLowerCase(),
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Check for existing account
      const existing = await db
        .select({ id: users.id, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists.",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      const verificationToken = await generateToken();
      const verificationExpiry = addHours(VERIFICATION_TOKEN_EXPIRY_HOURS);

      // Determine role — Rachel is pre-seeded as admin
      const isRachel = input.email === "rachel.m@noize.com.au";
      const role = isRachel ? "admin" : "user";

      const [inserted] = await db
        .insert(users)
        .values({
          openId: `email:${input.email}`, // synthetic openId for email users
          name: input.name,
          email: input.email,
          loginMethod: "email",
          role,
          tier: "standard",
          onboardingComplete: false,
          emailVerified: false,
          passwordHash,
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
          lastSignedIn: new Date(),
        })
        .$returningId();

      const userId = inserted.id;

      // Create credits row — Rachel gets unlimited (represented as 999999)
      await db.insert(credits).values({
        userId,
        balance: isRachel ? 999999 : 0,
      });

      // Send verification email (non-blocking on error — user can resend)
      try {
        await sendVerificationEmail(input.email, input.name, verificationToken);
      } catch (err) {
        console.error("[Auth] Verification email failed:", err);
        // Do not throw — account is created, user can request resend
      }

      return { success: true, message: "Account created. Please check your email to verify your account." };
    }),

  // ─── Verify Email ─────────────────────────────────────────────────────────
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const now = new Date();
      const [user] = await db
        .select({
          id: users.id,
          emailVerified: users.emailVerified,
          emailVerificationExpiry: users.emailVerificationExpiry,
        })
        .from(users)
        .where(
          and(
            eq(users.emailVerificationToken, input.token),
            gt(users.emailVerificationExpiry, now)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This verification link is invalid or has expired. Please request a new one.",
        });
      }

      if (user.emailVerified) {
        return { success: true, message: "Your email is already verified. You can log in." };
      }

      await db
        .update(users)
        .set({
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiry: null,
        })
        .where(eq(users.id, user.id));

      return { success: true, message: "Email verified successfully. You can now log in." };
    }),

  // ─── Resend Verification ──────────────────────────────────────────────────
  resendVerification: publicProcedure
    .input(z.object({ email: z.string().email().toLowerCase() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db
        .select({ id: users.id, name: users.name, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      // Always return success to prevent email enumeration
      if (!user || user.emailVerified) {
        return { success: true };
      }

      const token = await generateToken();
      const expiry = addHours(VERIFICATION_TOKEN_EXPIRY_HOURS);

      await db
        .update(users)
        .set({ emailVerificationToken: token, emailVerificationExpiry: expiry })
        .where(eq(users.id, user.id));

      try {
        await sendVerificationEmail(input.email, user.name, token);
      } catch (err) {
        console.error("[Auth] Resend verification email failed:", err);
      }

      return { success: true };
    }),

  // ─── Login ────────────────────────────────────────────────────────────────
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email().toLowerCase(),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      // Generic error — don't reveal whether email exists
      const invalidError = new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      });

      if (!user || !user.passwordHash) throw invalidError;

      const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);
      if (!passwordMatch) throw invalidError;

      if (!user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Please verify your email address before logging in. Check your inbox for the verification link.",
        });
      }

      // Update last signed in
      await db
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, user.id));

      // Issue JWT session cookie (30-day)
      const token = await signSessionToken({ userId: user.id, role: user.role });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      });

      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tier: user.tier,
          onboardingComplete: user.onboardingComplete,
        },
      };
    }),

  // ─── Logout ───────────────────────────────────────────────────────────────
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),

  // ─── Me ───────────────────────────────────────────────────────────────────
  me: publicProcedure.query(async ({ ctx }) => {
    // ctx.user is populated by the core context from the JWT cookie
    if (!ctx.user) return null;

    // Refresh user data from DB to get latest role/tier/credits
    const db = await getDb();
    if (!db) return ctx.user;

    const [fresh] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        tier: users.tier,
        onboardingComplete: users.onboardingComplete,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    return fresh ?? null;
  }),

  // ─── Forgot Password ──────────────────────────────────────────────────────
  forgotPassword: publicProcedure
    .input(z.object({ email: z.string().email().toLowerCase() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db
        .select({ id: users.id, name: users.name, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      // Always return success — never reveal whether email exists
      if (!user || !user.emailVerified) {
        return { success: true };
      }

      const token = await generateToken();
      const expiry = addHours(RESET_TOKEN_EXPIRY_HOURS);

      await db
        .update(users)
        .set({ passwordResetToken: token, passwordResetExpiry: expiry })
        .where(eq(users.id, user.id));

      try {
        await sendPasswordResetEmail(input.email, user.name, token);
      } catch (err) {
        console.error("[Auth] Password reset email failed:", err);
      }

      return { success: true };
    }),

  // ─── Reset Password ───────────────────────────────────────────────────────
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const now = new Date();
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.passwordResetToken, input.token),
            gt(users.passwordResetExpiry, now)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This password reset link is invalid or has expired. Please request a new one.",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      await db
        .update(users)
        .set({
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiry: null,
        })
        .where(eq(users.id, user.id));

      return { success: true, message: "Password updated successfully. You can now log in." };
    }),

  // ─── Change Password (authenticated) ─────────────────────────────────────
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [user] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      if (!user?.passwordHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No password set on this account." });
      }

      const match = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!match) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
      }

      const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, ctx.user.id));

      return { success: true };
    }),
});
