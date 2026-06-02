/**
 * server/routers/admin.ts
 * Layer 12 — Admin Panel procedures.
 *
 * All procedures use adminProcedure which requires:
 *   - ctx.user.role === "admin"  OR
 *   - ctx.user.email === "rachel.m@noize.com.au"
 *
 * Procedures:
 *   admin.listUsers          — all users with stats
 *   admin.suspendUser        — set isSuspended=true
 *   admin.unsuspendUser      — set isSuspended=false
 *   admin.addCredits         — add N credits to user
 *   admin.removeCredits      — subtract N credits (floor 0)
 *   admin.listBusinesses     — all businesses with user info and article counts
 *   admin.getRevenueSummary  — total payments, refunds, credit top-ups from DB
 *   admin.listErrorLog       — paginated app_error_log
 *   admin.listApiCostLog     — paginated api_cost_log, aggregated by user and day
 *   admin.listPublishAuditLog — paginated publish_audit_log (Layer 9 data)
 *   admin.listAdminLog       — paginated admin_log
 *   admin.startImpersonation — set impersonation cookie
 *   admin.stopImpersonation  — clear impersonation cookie
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminLog,
  apiCostLog,
  appErrorLog,
  articles,
  businesses,
  creditTransactions,
  credits,
  publishAuditLog,
  stripePayments,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { COOKIE_NAME } from "../../shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { signSessionToken } from "../_core/session";

const IMPERSONATION_COOKIE = "bb_impersonate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function writeAdminLog(
  adminUserId: number,
  action: typeof adminLog.$inferInsert["action"],
  targetUserId: number | null,
  notes: string
) {
  const db = await getDb();
  if (!db) return;
  await db.insert(adminLog).values({
    adminUserId,
    action,
    targetUserId: targetUserId ?? undefined,
    notes,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const adminRouter = router({
  // ─── User Management ─────────────────────────────────────────────────────

  listUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;

      // Get all users with credit balance
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          tier: users.tier,
          isSuspended: users.isSuspended,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
          lastSignedIn: users.lastSignedIn,
          creditBalance: credits.balance,
        })
        .from(users)
        .leftJoin(credits, eq(credits.userId, users.id))
        .orderBy(desc(users.createdAt))
        .limit(input.limit)
        .offset(offset);

      // Get business and article counts per user
      const userIds = rows.map((r) => r.id);
      if (userIds.length === 0) return { users: [], total: 0 };

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(users);

      // Fetch business counts
      const bizCounts = await db
        .select({
          userId: businesses.userId,
          count: sql<number>`count(*)`,
        })
        .from(businesses)
        .groupBy(businesses.userId);

      // Fetch article counts
      const artCounts = await db
        .select({
          userId: businesses.userId,
          count: sql<number>`count(${articles.id})`,
        })
        .from(articles)
        .innerJoin(businesses, eq(articles.businessId, businesses.id))
        .groupBy(businesses.userId);

      const bizMap = new Map(bizCounts.map((b) => [b.userId, Number(b.count)]));
      const artMap = new Map(artCounts.map((a) => [a.userId, Number(a.count)]));

      const result = rows
        .filter((r) => {
          if (!input.search) return true;
          const q = input.search.toLowerCase();
          return (
            r.name?.toLowerCase().includes(q) ||
            r.email?.toLowerCase().includes(q)
          );
        })
        .map((r) => ({
          ...r,
          creditBalance: r.creditBalance ?? 0,
          businessCount: bizMap.get(r.id) ?? 0,
          articleCount: artMap.get(r.id) ?? 0,
        }));

      return { users: result, total: Number(total) };
    }),

  suspendUser: adminProcedure
    .input(z.object({ userId: z.number().int(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db.update(users).set({ isSuspended: true }).where(eq(users.id, input.userId));
      await writeAdminLog(
        ctx.user.id,
        "suspend_user",
        input.userId,
        input.reason ?? "Suspended by admin"
      );
      return { success: true };
    }),

  unsuspendUser: adminProcedure
    .input(z.object({ userId: z.number().int(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db.update(users).set({ isSuspended: false }).where(eq(users.id, input.userId));
      await writeAdminLog(
        ctx.user.id,
        "unsuspend_user",
        input.userId,
        input.reason ?? "Unsuspended by admin"
      );
      return { success: true };
    }),

  addCredits: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        amount: z.number().int().min(1).max(10000),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Upsert credits row
      const [existing] = await db
        .select({ balance: credits.balance })
        .from(credits)
        .where(eq(credits.userId, input.userId))
        .limit(1);

      if (existing) {
        await db
          .update(credits)
          .set({ balance: existing.balance + input.amount })
          .where(eq(credits.userId, input.userId));
      } else {
        await db.insert(credits).values({ userId: input.userId, balance: input.amount });
      }

      // Write credit transaction
      await db.insert(creditTransactions).values({
        userId: input.userId,
        delta: input.amount,
        balanceAfter: (existing?.balance ?? 0) + input.amount,
        reason: "admin_grant",
      });

      await writeAdminLog(
        ctx.user.id,
        "add_credits",
        input.userId,
        `Added ${input.amount} credits. Reason: ${input.reason ?? "none"}`
      );

      const newBalance = (existing?.balance ?? 0) + input.amount;
      return { success: true, newBalance };
    }),

  removeCredits: adminProcedure
    .input(
      z.object({
        userId: z.number().int(),
        amount: z.number().int().min(1).max(10000),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [existing] = await db
        .select({ balance: credits.balance })
        .from(credits)
        .where(eq(credits.userId, input.userId))
        .limit(1);

      const currentBalance = existing?.balance ?? 0;
      const newBalance = Math.max(0, currentBalance - input.amount);

      if (existing) {
        await db
          .update(credits)
          .set({ balance: newBalance })
          .where(eq(credits.userId, input.userId));
      }

      await db.insert(creditTransactions).values({
        userId: input.userId,
        delta: -input.amount,
        balanceAfter: newBalance,
        reason: "admin_grant",
      });

      await writeAdminLog(
        ctx.user.id,
        "remove_credits",
        input.userId,
        `Removed ${input.amount} credits (floored at 0). Reason: ${input.reason ?? "none"}`
      );

      return { success: true, newBalance };
    }),

  // ─── Business Overview ────────────────────────────────────────────────────

  listBusinesses: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;

      const rows = await db
        .select({
          id: businesses.id,
          name: businesses.name,
          industry: businesses.industry,
          currentStage: businesses.currentStage,
          isTestBusiness: businesses.isTestBusiness,
          createdAt: businesses.createdAt,
          userId: businesses.userId,
          userName: users.name,
          userEmail: users.email,
          articleCount: sql<number>`count(${articles.id})`,
        })
        .from(businesses)
        .leftJoin(users, eq(businesses.userId, users.id))
        .leftJoin(articles, eq(articles.businessId, businesses.id))
        .groupBy(businesses.id, users.name, users.email)
        .orderBy(desc(businesses.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(businesses);

      const filtered = rows.filter((r) => {
        if (!input.search) return true;
        const q = input.search.toLowerCase();
        return (
          r.name?.toLowerCase().includes(q) ||
          r.userEmail?.toLowerCase().includes(q) ||
          r.userName?.toLowerCase().includes(q)
        );
      });

      return { businesses: filtered.map(r => ({ ...r, articleCount: Number(r.articleCount) })), total: Number(total) };
    }),

  // ─── Revenue Dashboard ────────────────────────────────────────────────────

  getRevenueSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [totals] = await db
      .select({
        totalPayments: sql<number>`coalesce(sum(case when ${stripePayments.status} = 'succeeded' then ${stripePayments.amountCents} else 0 end), 0)`,
        totalRefunds: sql<number>`coalesce(sum(case when ${stripePayments.status} = 'refunded' then ${stripePayments.amountCents} else 0 end), 0)`,
        paymentCount: sql<number>`count(case when ${stripePayments.status} = 'succeeded' then 1 end)`,
        refundCount: sql<number>`count(case when ${stripePayments.status} = 'refunded' then 1 end)`,
      })
      .from(stripePayments);

    // Credit top-ups from credit transactions
    const [creditTotals] = await db
      .select({
        totalTopUps: sql<number>`coalesce(sum(case when ${creditTransactions.delta} > 0 and ${creditTransactions.reason} = 'pack_purchase' then ${creditTransactions.delta} else 0 end), 0)`,
        adminGrants: sql<number>`coalesce(sum(case when ${creditTransactions.reason} = 'admin_grant' and ${creditTransactions.delta} > 0 then ${creditTransactions.delta} else 0 end), 0)`,
      })
      .from(creditTransactions);

    // Recent payments
    const recentPayments = await db
      .select({
        id: stripePayments.id,
        userId: stripePayments.userId,
        amountCents: stripePayments.amountCents,
        currency: stripePayments.currency,
        status: stripePayments.status,
        product: stripePayments.product,
        createdAt: stripePayments.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(stripePayments)
      .leftJoin(users, eq(stripePayments.userId, users.id))
      .orderBy(desc(stripePayments.createdAt))
      .limit(50);

    return {
      totalPaymentsUsd: Number(totals.totalPayments) / 100,
      totalRefundsUsd: Number(totals.totalRefunds) / 100,
      paymentCount: Number(totals.paymentCount),
      refundCount: Number(totals.refundCount),
      totalCreditTopUps: Number(creditTotals.totalTopUps),
      adminCreditGrants: Number(creditTotals.adminGrants),
      recentPayments,
    };
  }),

  // ─── Error Log ────────────────────────────────────────────────────────────

  listErrorLog: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        userId: z.number().int().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = input.userId ? [eq(appErrorLog.userId, input.userId)] : [];

      const rows = await db
        .select({
          id: appErrorLog.id,
          userId: appErrorLog.userId,
          route: appErrorLog.route,
          errorMessage: appErrorLog.errorMessage,
          stackTrace: appErrorLog.stackTrace,
          createdAt: appErrorLog.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(appErrorLog)
        .leftJoin(users, eq(appErrorLog.userId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(appErrorLog.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(appErrorLog)
        .where(conditions.length ? and(...conditions) : undefined);

      return { errors: rows, total: Number(total) };
    }),

  // ─── API Cost Log ─────────────────────────────────────────────────────────

  listApiCostLog: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        userId: z.number().int().optional(),
        daysBack: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Strip milliseconds to avoid MySQL datetime comparison issues with Drizzle serialization
      const sinceMs = Date.now() - input.daysBack * 24 * 60 * 60 * 1000;
      const since = new Date(Math.floor(sinceMs / 1000) * 1000);
      const offset = (input.page - 1) * input.limit;

      const conditions = [gte(apiCostLog.createdAt, since)];
      if (input.userId) conditions.push(eq(apiCostLog.userId, input.userId));

      // Raw log entries
      const rows = await db
        .select({
          id: apiCostLog.id,
          userId: apiCostLog.userId,
          model: apiCostLog.model,
          inputTokens: apiCostLog.inputTokens,
          outputTokens: apiCostLog.outputTokens,
          estimatedCostUsd: apiCostLog.estimatedCostUsd,
          feature: apiCostLog.feature,
          createdAt: apiCostLog.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(apiCostLog)
        .leftJoin(users, eq(apiCostLog.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(apiCostLog.createdAt))
        .limit(input.limit)
        .offset(offset);

      // Format since as a plain datetime string (no milliseconds) for raw SQL
      const sinceStr = since.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      const userIdFilter = input.userId ? ` AND acl.userId = ${input.userId}` : '';

      // Aggregated by user — raw SQL to avoid TiDB GROUP BY column mismatch
      const byUserRaw = await db.execute(
        `SELECT acl.userId, u.name AS userName, u.email AS userEmail,
                sum(acl.inputTokens) AS totalInputTokens,
                sum(acl.outputTokens) AS totalOutputTokens,
                sum(acl.estimatedCostUsd) AS totalCostUsd,
                count(*) AS callCount
         FROM api_cost_log acl
         LEFT JOIN users u ON acl.userId = u.id
         WHERE acl.createdAt >= '${sinceStr}'${userIdFilter}
         GROUP BY acl.userId, u.name, u.email
         ORDER BY sum(acl.estimatedCostUsd) DESC`
      );
      const byUser = (byUserRaw[0] as unknown as any[]) ?? [];

      // Aggregated by day — raw SQL to avoid TiDB GROUP BY column mismatch
      const byDayRaw = await db.execute(
        `SELECT date(createdAt) AS day,
                sum(estimatedCostUsd) AS totalCostUsd,
                count(*) AS callCount,
                sum(inputTokens + outputTokens) AS totalTokens
         FROM api_cost_log
         WHERE createdAt >= '${sinceStr}'${userIdFilter}
         GROUP BY date(createdAt)
         ORDER BY date(createdAt) DESC`
      );
      const byDay = (byDayRaw[0] as unknown as any[]) ?? [];

      const totalRaw = await db.execute(
        `SELECT count(*) AS total FROM api_cost_log WHERE createdAt >= '${sinceStr}'${userIdFilter}`
      );
      const total = Number(((totalRaw[0] as unknown as any[])[0])?.total ?? 0);

      return {
        entries: rows,
        byUser: byUser.map(r => ({
          ...r,
          totalInputTokens: Number(r.totalInputTokens),
          totalOutputTokens: Number(r.totalOutputTokens),
          totalCostUsd: Number(r.totalCostUsd),
          callCount: Number(r.callCount),
        })),
        byDay: byDay.map(r => ({
          day: r.day,
          totalCostUsd: Number(r.totalCostUsd),
          callCount: Number(r.callCount),
          totalTokens: Number(r.totalTokens),
        })),
        total: Number(total),
      };
    }),

  // ─── Audit Log (Layer 9 publish_audit_log) ────────────────────────────────

  listPublishAuditLog: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
        userId: z.number().int().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;

      const rows = await db
        .select({
          id: publishAuditLog.id,
          articleId: publishAuditLog.articleId,
          businessId: publishAuditLog.businessId,
          action: publishAuditLog.action,
          result: publishAuditLog.result,
          errorMessage: publishAuditLog.errorMessage,
          attemptNumber: publishAuditLog.attemptNumber,
          triggeredBy: publishAuditLog.triggeredBy,
          createdAt: publishAuditLog.createdAt,
          articleTitle: articles.title,
          businessName: businesses.name,
          userName: users.name,
          userEmail: users.email,
        })
        .from(publishAuditLog)
        .leftJoin(articles, eq(publishAuditLog.articleId, articles.id))
        .leftJoin(businesses, eq(publishAuditLog.businessId, businesses.id))
        .leftJoin(users, eq(businesses.userId, users.id))
        .orderBy(desc(publishAuditLog.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(publishAuditLog);

      return { entries: rows, total: Number(total) };
    }),

  // ─── Admin Log ────────────────────────────────────────────────────────────

  listAdminLog: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;

      const rows = await db
        .select({
          id: adminLog.id,
          action: adminLog.action,
          notes: adminLog.notes,
          createdAt: adminLog.createdAt,
          adminUserId: adminLog.adminUserId,
          targetUserId: adminLog.targetUserId,
          adminName: users.name,
          adminEmail: users.email,
        })
        .from(adminLog)
        .leftJoin(users, eq(adminLog.adminUserId, users.id))
        .orderBy(desc(adminLog.createdAt))
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)` })
        .from(adminLog);

      return { entries: rows, total: Number(total) };
    }),

  // ─── Impersonation ────────────────────────────────────────────────────────

  startImpersonation: adminProcedure
    .input(z.object({ targetUserId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify target user exists
      const [target] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1);

      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      // Issue a session token for the target user
      const token = await signSessionToken({ userId: target.id, role: "user" });
      const cookieOptions = getSessionCookieOptions(ctx.req);

      // Set the impersonation cookie (stores admin's original user ID)
      ctx.res.cookie(IMPERSONATION_COOKIE, String(ctx.user.id), {
        ...cookieOptions,
        maxAge: 2 * 60 * 60 * 1000, // 2 hours
      });

      // Replace the session cookie with target user's token
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: 2 * 60 * 60 * 1000, // 2 hours
      });

      await writeAdminLog(
        ctx.user.id,
        "impersonate_user",
        input.targetUserId,
        `Admin #${ctx.user.id} (${ctx.user.email}) started impersonating user #${target.id} (${target.email})`
      );

      return { success: true, targetUser: { id: target.id, name: target.name, email: target.email } };
    }),

  stopImpersonation: adminProcedure
    .mutation(async ({ ctx }) => {
      ctx.res.clearCookie(IMPERSONATION_COOKIE);
      ctx.res.clearCookie(COOKIE_NAME);
      return { success: true };
    }),

  // ─── Check if current user is impersonating ───────────────────────────────

  getImpersonationStatus: adminProcedure.query(async ({ ctx }) => {
    const { parse: parseCookies } = await import("cookie");
    const cookieHeader = ctx.req.headers.cookie ?? "";
    const cookies = parseCookies(cookieHeader);
    const adminId = cookies[IMPERSONATION_COOKIE];
    return {
      isImpersonating: !!adminId,
      adminUserId: adminId ? parseInt(adminId, 10) : null,
    };
  }),
});
