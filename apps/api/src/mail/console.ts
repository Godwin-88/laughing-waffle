import type { GenericEmail, Mailer, VerificationEmail } from "./mailer";

/**
 * Development transport — prints verification links to the API console.
 * (nodemailer/SMTP is used when SMTP_URL is configured.)
 */
export function createConsoleMailer(): Mailer {
  return {
    name: "console",
    async sendVerificationEmail(email: VerificationEmail) {
      console.log(
        `\n[mail:console] → ${email.to}\n  Subject: Verify your Takwimu Data School account\n  Open to verify: ${email.verifyUrl}\n`,
      );
    },
    async sendEmail(email: GenericEmail) {
      console.log(
        `\n[mail:console] → ${email.to}\n  Subject: ${email.subject}\n  ${email.text.replace(/\n+/g, "\n  ")}\n`,
      );
    },
  };
}