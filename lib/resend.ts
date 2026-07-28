import { Resend } from "resend";
import type { Env } from "./db";

export function getResend(env: Env): Resend {
  return new Resend(env.RESEND_API_KEY);
}

export async function sendMagicLinkEmail(env: Env, toEmail: string, magicUrl: string): Promise<void> {
  const resend = getResend(env);
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: toEmail,
    subject: "Sign in to photohere",
    html: `<p>Tap the link below to sign in to photohere.</p><p><a href="${magicUrl}">${magicUrl}</a></p><p style="color:#888;font-size:12px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
