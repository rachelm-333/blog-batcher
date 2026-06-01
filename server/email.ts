/**
 * server/email.ts
 * Resend-powered transactional email helper.
 * Handles email verification and password reset emails for Blog Batcher auth.
 *
 * To swap the sender address before launch:
 *   1. Verify your domain in Resend dashboard (resend.com)
 *   2. Update EMAIL_FROM_ADDRESS in Settings → Secrets
 */
import { Resend } from "resend";
import { ENV } from "./_core/env";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(ENV.resendApiKey);
  }
  return _resend;
}

const APP_NAME = "Blog Batcher";
const APP_URL = ENV.isProduction
  ? "https://blogbatcher.manus.space"
  : "http://localhost:3000";

// ---------------------------------------------------------------------------
// Email Verification
// ---------------------------------------------------------------------------
export async function sendVerificationEmail(
  toEmail: string,
  toName: string | null,
  token: string
): Promise<void> {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  const firstName = toName?.split(" ")[0] ?? "there";

  const { error } = await getResend().emails.send({
    from: `${APP_NAME} <${ENV.emailFromAddress}>`,
    to: toEmail,
    subject: "Verify your Blog Batcher account",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#0f172a;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Blog Batcher</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:600;">Verify your email address</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.6;">
            Thanks for signing up. Click the button below to verify your email address and activate your account.
          </p>
          <a href="${verifyUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            Verify Email Address
          </a>
          <p style="margin:32px 0 0;color:#94a3b8;font-size:13px;line-height:1.6;">
            This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">
            Or copy this link: <a href="${verifyUrl}" style="color:#0f172a;">${verifyUrl}</a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} Blog Batcher. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });

  if (error) {
    console.error("[Email] Failed to send verification email:", error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Password Reset
// ---------------------------------------------------------------------------
export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string | null,
  token: string
): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;
  const firstName = toName?.split(" ")[0] ?? "there";

  const { error } = await getResend().emails.send({
    from: `${APP_NAME} <${ENV.emailFromAddress}>`,
    to: toEmail,
    subject: "Reset your Blog Batcher password",
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#0f172a;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Blog Batcher</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:600;">Reset your password</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
          <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.6;">
            We received a request to reset your password. Click the button below to choose a new one.
          </p>
          <a href="${resetUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">
            Reset Password
          </a>
          <p style="margin:32px 0 0;color:#94a3b8;font-size:13px;line-height:1.6;">
            This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">
            Or copy this link: <a href="${resetUrl}" style="color:#0f172a;">${resetUrl}</a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} Blog Batcher. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });

  if (error) {
    console.error("[Email] Failed to send password reset email:", error);
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
}
