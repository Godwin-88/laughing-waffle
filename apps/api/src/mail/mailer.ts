import { loadEnv } from "../config/env";
import { createConsoleMailer } from "./console";
import { createSmtpMailer } from "./smtp";

export interface VerificationEmail {
  to: string;
  firstName: string;
  verifyUrl: string;
}

export interface GenericEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly name: string;
  sendVerificationEmail(email: VerificationEmail): Promise<void>;
  sendEmail(email: GenericEmail): Promise<void>;
}

let cachedMailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (cachedMailer) return cachedMailer;
  const env = loadEnv();
  cachedMailer = env.SMTP_URL ? createSmtpMailer(env) : createConsoleMailer();
  return cachedMailer;
}