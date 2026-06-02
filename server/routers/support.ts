/**
 * server/routers/support.ts
 *
 * Layer 11 — Support Centre
 *
 * Procedures:
 *  support.search            — full-text search across help articles
 *  support.getArticle        — return a single article by slug
 *  support.getTopics         — return all topics with their article list
 *  support.submitContactForm — send a support request to rachel.m@noize.com.au
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  HELP_ARTICLES,
  HELP_TOPICS,
  searchHelpArticles,
  getArticleSnippet,
} from "../../shared/helpContent";
import { Resend } from "resend";
import { ENV } from "../_core/env";

// Lazy Resend client
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(ENV.resendApiKey);
  return _resend;
}

const SUPPORT_EMAIL = "rachel.m@noize.com.au";

export const supportRouter = router({
  /**
   * Full-text search across all help articles.
   * Returns articles with a short snippet showing where the match was found.
   */
  search: publicProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(({ input }) => {
      const results = searchHelpArticles(input.query);
      return results.map((article) => ({
        id: article.id,
        topicId: article.topicId,
        title: article.title,
        slug: article.slug,
        snippet: getArticleSnippet(article, input.query),
        tags: article.tags,
      }));
    }),

  /**
   * Return a single help article by slug.
   * Returns null if not found (client handles the 404 state).
   */
  getArticle: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ input }) => {
      const article = HELP_ARTICLES.find((a) => a.slug === input.slug);
      if (!article) return null;
      const topic = HELP_TOPICS.find((t) => t.id === article.topicId);
      return { ...article, topic: topic ?? null };
    }),

  /**
   * Return all topics with their articles (for sidebar navigation).
   * Articles are returned without body content to keep the payload small.
   */
  getTopics: publicProcedure.query(() => {
    return HELP_TOPICS.map((topic) => ({
      ...topic,
      articles: HELP_ARTICLES.filter((a) => a.topicId === topic.id).map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        tags: a.tags,
      })),
    }));
  }),

  /**
   * Submit a support contact form.
   * Sends an email to rachel.m@noize.com.au via Resend.
   * Uses publicProcedure so unauthenticated users can contact support.
   */
  submitContactForm: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required").max(100),
        email: z.string().email("Invalid email address"),
        subject: z.string().min(1, "Subject is required").max(200),
        message: z.string().min(10, "Message must be at least 10 characters").max(5000),
      })
    )
    .mutation(async ({ input }) => {
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#0f172a;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Blog Batcher — Support Request</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <strong style="color:#0f172a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">From</strong>
              </td>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:15px;">
                ${input.name} &lt;${input.email}&gt;
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <strong style="color:#0f172a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Subject</strong>
              </td>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:15px;">
                ${input.subject}
              </td>
            </tr>
          </table>
          <div style="margin-top:24px;">
            <strong style="color:#0f172a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Message</strong>
            <div style="margin-top:12px;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;color:#334155;font-size:15px;line-height:1.7;white-space:pre-wrap;">${input.message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
          </div>
          <div style="margin-top:32px;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
            <p style="margin:0;color:#1e40af;font-size:13px;">Reply directly to this email to respond to ${input.name}.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      try {
        const { error } = await getResend().emails.send({
          from: `Blog Batcher Support <${ENV.emailFromAddress}>`,
          to: SUPPORT_EMAIL,
          replyTo: input.email,
          subject: `[Support] ${input.subject}`,
          html,
        });

        if (error) {
          console.error("[Support] Failed to send contact form email:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to send your message. Please try again or email rachel.m@noize.com.au directly.",
          });
        }

        return { success: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        console.error("[Support] Unexpected error sending contact form:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send your message. Please try again or email rachel.m@noize.com.au directly.",
        });
      }
    }),
});
