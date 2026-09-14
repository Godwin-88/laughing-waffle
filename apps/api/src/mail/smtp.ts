import nodemailer from "nodemailer";
import type { Env } from "../config/env";
import type { Mailer, VerificationEmail } from "./mailer";

/** SMTP transport (SendGrid / AWS SES compatible) used when SMTP_URL is set. */
export function createSmtpMailer(env: Env): Mailer {
  const transport = nodemailer.createTransport(env.SMTP_URL!);
  return {
    name: "smtp",
    async sendVerificationEmail(email: VerificationEmail) {
      await transport.sendMail({
        from: env.SMTP_FROM,
        to: email.to,
        subject: "Verify your Takwimu Data School account",
        text: `Hi ${email.firstName},\n\nWelcome to Takwimu Data School. Please verify your email address by opening this link:\n\n${email.verifyUrl}\n\nIf you did not create this account, you can safely ignore this email.\n`,
        html: `<h2>Takwimu Data School</h2><p>Hi ${email.firstName},</p><p>Welcome! Please verify your email by clicking the button below.</p><p><a href="${email.verifyUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Verify my email</a></p><p>If the button doesn't work, copy this link: ${email.verifyUrl}</p>`,
      });
    },
  };
}