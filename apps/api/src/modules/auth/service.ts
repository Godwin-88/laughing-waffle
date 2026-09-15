import { eq } from "drizzle-orm";
import { EMAIL_RE, isStrongPassword, passwordError } from "@takwimu/shared";
import type { CourseSummary, PublicUser } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { emailVerificationTokens, passwordResetTokens, refreshTokens, users } from "../../db/schema";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/password";
import { hashOpaqueToken, issueOpaqueToken, signAccessToken } from "../../lib/tokens";
import { mapUserToPublic, type UserRow } from "../../lib/users";
import { getMailer } from "../../mail/mailer";
import { catalogueRankedCourses } from "../catalogue/service";

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  consent: boolean;
}

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface AuthSuccess {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  user: PublicUser;
  refreshToken: string; // raw opaque token (also set as an httpOnly cookie)
}

export const REFRESH_COOKIE = "tkw_refresh";

export function refreshCookieName(): string {
  return REFRESH_COOKIE;
}

async function getDbHandle() {
  return getDb(loadEnv().DATABASE_URL);
}

export async function register(input: RegisterInput): Promise<{
  userId: string;
  email: string;
  devVerificationUrl: string | null;
}> {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const email = input.email.trim().toLowerCase();

  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
  if (!isStrongPassword(input.password)) fields.password = passwordError();
  if (!firstName || !lastName) fields.name = "First and last name are required.";
  if (!fields.email && !fields.password && !fields.name && input.consent !== true) {
    fields.consent = "You must consent to the privacy policy to create an account.";
  }
  if (Object.keys(fields).length > 0) {
    throw badRequest(Object.values(fields)[0], fields);
  }

  const { db } = await getDbHandle();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    throw conflict("An account with this email already exists.", "email_taken");
  }

  const passwordHash = await hashPassword(input.password);
  const created = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstName,
      lastName,
      consentGivenAt: new Date(),
      role: "learner",
    })
    .returning();
  const user = created[0];

  const rawToken = issueOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  await db.insert(emailVerificationTokens).values({
    userId: user.id,
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt,
  });

  const env = loadEnv();
  const verifyUrl = `${env.PUBLIC_API_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  await getMailer().sendVerificationEmail({ to: email, firstName, verifyUrl });

  return {
    userId: user.id,
    email,
    devVerificationUrl:
      env.NODE_ENV === "development" || env.NODE_ENV === "test" ? verifyUrl : null,
  };
}

export async function verifyEmail(rawToken: string): Promise<void> {
  const { db } = await getDbHandle();
  const tokenHash = hashOpaqueToken(rawToken);
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  if (rows.length === 0) {
    throw badRequest("This verification link is invalid. Please request a new one.", {
      token: "invalid_token",
    });
  }
  const record = rows[0];
  if (record.usedAt !== null || record.expiresAt < new Date()) {
    throw badRequest("This verification link has expired or already been used.", {
      token: "expired_token",
    });
  }
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.id, record.id));
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, record.userId));
}

export async function login(
  emailInput: string,
  password: string,
  meta: SessionMeta,
): Promise<AuthSuccess> {
  const email = emailInput.trim().toLowerCase();
  const { db } = await getDbHandle();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (rows.length === 0 || !rows[0].passwordHash) {
    throw unauthorized("Invalid email or password.");
  }
  const user = rows[0];
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw unauthorized("Invalid email or password.");
  if (user.status !== "active") throw forbidden("This account has been disabled.");
  if (user.emailVerifiedAt === null) {
    throw new ApiError(
      403,
      "email_unverified",
      "Please verify your email address before signing in. Check your inbox for the verification link.",
    );
  }
  return issueSession(user, meta);
}

export async function refresh(
  rawRefreshToken: string | null,
  meta: SessionMeta,
): Promise<AuthSuccess> {
  if (!rawRefreshToken) throw unauthorized();
  const { db } = await getDbHandle();
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (rows.length === 0) throw unauthorized("Session expired. Please sign in again.");
  const record = rows[0];
  if (record.revokedAt !== null) throw unauthorized("Session revoked. Please sign in again.");
  if (record.expiresAt < new Date()) throw unauthorized("Session expired. Please sign in again.");

  const userRows = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  if (userRows.length === 0 || userRows[0].status !== "active") throw unauthorized();

  // Rotate: revoke the presented token, issue a fresh pair.
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, record.id));

  return issueSession(userRows[0], meta);
}

export async function logout(rawRefreshToken: string | null): Promise<void> {
  if (!rawRefreshToken) return;
  const { db } = await getDbHandle();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, hashOpaqueToken(rawRefreshToken)));
}
export async function issueSessionPair(
  user: UserRow,
  meta: SessionMeta,
): Promise<AuthSuccess> {
  return issueSession(user, meta);
}

async function issueSession(user: UserRow, meta: SessionMeta): Promise<AuthSuccess> {
  const env = loadEnv();
  const { db } = await getDbHandle();

  const rawRefresh = issueOpaqueToken();
  const refreshExpiry = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: hashOpaqueToken(rawRefresh),
    expiresAt: refreshExpiry,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  const { token: accessToken, expiresInSeconds } = await signAccessToken(
    env.JWT_SECRET,
    user.id,
    user.role,
    env.JWT_ACCESS_TTL,
  );

  return {
    accessToken,
    tokenType: "Bearer",
    expiresInSeconds,
    refreshToken: rawRefresh,
    user: await mapUserToPublic(user),
  };
}

export async function getMe(userId: string): Promise<{
  user: PublicUser;
  sso: { google: boolean; microsoft: boolean };
  recommendations: CourseSummary[];
}> {
  const env = loadEnv();
  const { db } = await getDbHandle();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (rows.length === 0) throw notFound("Account not found.");
  const user = await mapUserToPublic(rows[0]);

  let recommendations: CourseSummary[] = [];
  try {
    recommendations = await catalogueRankedCourses({
      q: null,
      interests: rows[0].interests ?? [],
      categories: [],
      levels: [],
      durations: [],
      price: "all",
      languages: [],
      ratingMin: 0,
      sort: "newest",
      page: 1,
      pageSize: 4,
      userId,
    });
  } catch {
    /* recommendations are best-effort */
  }

  return {
    user,
    sso: {
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
    },
    recommendations,
  };
}

// ── Password reset (US-7.1.1 "force password reset") ─────────

export async function createPasswordResetToken(
  userId: string,
  createdBy?: string | null,
): Promise<string> {
  const { db } = await getDbHandle();
  const rawToken = issueOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt,
    createdBy: createdBy ?? null,
  });
  await db.update(users).set({ forcePasswordResetAt: new Date() }).where(eq(users.id, userId));
  return rawToken;
}

export async function sendPasswordResetEmail(userId: string, token: string): Promise<void> {
  const { db } = await getDbHandle();
  const rows = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) return;
  const env = loadEnv();
  const resetUrl = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
  await getMailer().sendEmail({
    to: rows[0].email,
    subject: "Your password reset request — Takwimu Data School",
    text:
      `Hi ${rows[0].firstName},\n\n` +
      `An administrator requested a password reset for your Takwimu Data School account.\n\n` +
      `Set a new password here: ${resetUrl}\n\n` +
      `The link expires in 24 hours. If you didn't request this, please contact support.`,
  });
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  if (!isStrongPassword(newPassword)) throw badRequest(passwordError(), { password: "too_weak" });
  const { db } = await getDbHandle();
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashOpaqueToken(token)))
    .limit(1);
  const record = rows[0];
  if (!record) throw badRequest("This reset link is invalid.", { token: "invalid" });
  if (record.usedAt) throw badRequest("This reset link has already been used.", { token: "used" });
  if (record.expiresAt < new Date()) {
    throw badRequest("This reset link has expired. Ask an administrator for a new one.", { token: "expired" });
  }

  const userRows = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  const user = userRows[0];
  if (!user || user.status === "deleted") {
    throw badRequest("This account can no longer be reset.", { token: "invalid" });
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, forcePasswordResetAt: null })
    .where(eq(users.id, record.userId));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
  // Invalidate any live sessions so the old password is forced out.
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, record.userId));
  void user;
}