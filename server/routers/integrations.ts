/**
 * server/routers/integrations.ts
 *
 * Layer 8 — CMS Integrations Router
 *
 * Procedures:
 *   integrations.save           — upsert CMS credentials (encrypted) for a business+platform
 *   integrations.get            — return all integrations for a business (credentials redacted)
 *   integrations.testConnection — test live connection to CMS, update status + lastTestedAt
 *   integrations.delete         — remove an integration
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { integrations, businesses } from "../../drizzle/schema";
import {
  encryptCredentials,
  decryptCredentials,
  testWordPressConnection,
  testWixConnection,
  testZapierConnection,
} from "../cmsPublisher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertBusinessOwnership(userId: number, businessId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [biz] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!biz) throw new TRPCError({ code: "FORBIDDEN", message: "Business not found or access denied" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const integrationsRouter = router({
  /**
   * Upsert CMS credentials for a business+platform.
   * Credentials are encrypted before storage.
   */
  save: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier", "shopify", "webflow", "squarespace", "ghost"]),
        credentials: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const encrypted = encryptCredentials(input.credentials);

      // Check if integration already exists
      const [existing] = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, input.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(integrations)
          .set({
            credentialsEncrypted: encrypted,
            status: "not_connected",
            lastTestError: null,
          })
          .where(eq(integrations.id, existing.id));
        return { id: existing.id };
      } else {
        const result = await db
          .insert(integrations)
          .values({
            businessId: input.businessId,
            platform: input.platform,
            credentialsEncrypted: encrypted,
            status: "not_connected",
          });
        return { id: result[0].insertId as number };
      }
    }),

  /**
   * Return all integrations for a business.
   * Credentials are NOT returned — only connection status and metadata.
   */
  get: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const rows = await db
        .select({
          id: integrations.id,
          platform: integrations.platform,
          status: integrations.status,
          lastTestedAt: integrations.lastTestedAt,
          lastTestError: integrations.lastTestError,
          createdAt: integrations.createdAt,
        })
        .from(integrations)
        .where(eq(integrations.businessId, input.businessId));

      return rows;
    }),

  /**
   * Return a single integration with decrypted credentials for editing.
   * Only returns the credential keys (not values) for security — except
   * non-secret fields like siteUrl and seoPlugin.
   */
  getForEdit: protectedProcedure
    .input(z.object({ businessId: z.number(), platform: z.enum(["wordpress", "wix", "zapier", "shopify", "webflow", "squarespace", "ghost"]) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const [row] = await db
        .select({
          id: integrations.id,
          platform: integrations.platform,
          status: integrations.status,
          credentialsEncrypted: integrations.credentialsEncrypted,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, input.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (!row) return null;

      // Decrypt and return only non-secret fields + masked secrets
      const creds = row.credentialsEncrypted
        ? decryptCredentials(row.credentialsEncrypted)
        : null;

      const safeFields: Record<string, string> = {};
      if (creds) {
        // Return non-secret fields as-is
        if (creds.siteUrl) safeFields.siteUrl = creds.siteUrl;
        if (creds.username) safeFields.username = creds.username;
        if (creds.seoPlugin) safeFields.seoPlugin = creds.seoPlugin;
        if (creds.siteId) safeFields.siteId = creds.siteId;
        if (creds.webhookUrl) safeFields.webhookUrl = creds.webhookUrl;
        // Mask secrets
        if (creds.applicationPassword) safeFields.applicationPassword = "••••••••";
        if (creds.apiKey) safeFields.apiKey = "••••••••";
      }

      return {
        id: row.id,
        platform: row.platform,
        status: row.status,
        fields: safeFields,
      };
    }),

  /**
   * Test the live connection to a CMS platform.
   * Updates integration status and lastTestedAt / lastTestError.
   */
  testConnection: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      const [row] = await db
        .select({ id: integrations.id, credentialsEncrypted: integrations.credentialsEncrypted })
        .from(integrations)
        .where(
          and(
            eq(integrations.businessId, input.businessId),
            eq(integrations.platform, input.platform)
          )
        )
        .limit(1);

      if (!row || !row.credentialsEncrypted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No credentials saved for this platform. Save credentials first." });
      }

      const creds = decryptCredentials(row.credentialsEncrypted);
      if (!creds) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to decrypt credentials" });
      }

      let result: { success: boolean; error?: string };

      if (input.platform === "wordpress") {
        result = await testWordPressConnection({
          siteUrl: creds.siteUrl ?? "",
          username: creds.username ?? "",
          applicationPassword: creds.applicationPassword ?? "",
          seoPlugin: (creds.seoPlugin as "yoast" | "rankmath" | "aioseo" | "none") ?? "none",
        });
      } else if (input.platform === "wix") {
        result = await testWixConnection({
          apiKey: creds.apiKey ?? "",
          siteId: creds.siteId ?? "",
        });
      } else {
        result = await testZapierConnection({
          webhookUrl: creds.webhookUrl ?? "",
        });
      }

      // Update integration status
      await db
        .update(integrations)
        .set({
          status: result.success ? "connected" : "failed",
          lastTestedAt: new Date(),
          lastTestError: result.error ?? null,
        })
        .where(eq(integrations.id, row.id));

      return result;
    }),

  /**
   * Delete an integration.
   */
  delete: protectedProcedure
    .input(
      z.object({
        businessId: z.number(),
        platform: z.enum(["wordpress", "wix", "zapier", "shopify", "webflow", "squarespace", "ghost"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertBusinessOwnership(ctx.user.id, input.businessId);

      await db
        .delete(integrations)
        .where(
          and(
            eq(integrations.businessId, input.businessId),
            eq(integrations.platform, input.platform)
          )
        );

      return { success: true };
    }),
});
