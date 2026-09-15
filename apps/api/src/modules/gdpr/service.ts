import archiver from "archiver";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  DataRequestListResponse,
  DataRequestSummary,
  GdprActionResponse,
  GdprConfirmResponse,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import {
  analyticsEvents,
  certificates,
  courses,
  dataRequests,
  discussionPosts,
  enrolments,
  gradebook,
  lessons,
  notificationPreferences,
  notifications,
  orders,
  progress,
  quizAttempts,
  users,
} from "../../db/schema";
import { conflict, notFound, serviceUnavailable } from "../../lib/errors";
import { hashOpaqueToken, issueOpaqueToken } from "../../lib/tokens";
import { recordAudit } from "../../lib/audit";
import { getMailer } from "../../mail/mailer";
import { getStorage } from "../../storage/storage";

/** GDPR / data-subject request handling (US-7.2.1). Self-service and */
/** admin-on-behalf flows both create a pending_confirmation row, email a   */
/** single-use confirm link, then process. Deletion anonymises PII while    */
/** keeping aggregate rows; the request row is retained 30 days for audit.  */

type Status = DataRequestSummary["status"];
type DataRequestType = "export" | "delete";

const EMAIL_EXPIRY_MS = 24 * 60 * 60 * 1000;
const EMAIL_SUBJECTS: Record<DataRequestType, string> = {
  export: "Confirm your Takwimu data export",
  delete: "Confirm account deletion — Takwimu Data School",
};

interface RequestOptions {
  initiatedBy?: "self" | "admin";
  adminId?: string | null;
}
export async function requestDataAction(
  userId: string,
  type: DataRequestType,
  opts: RequestOptions = {},
): Promise<GdprActionResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const initiatedBy = opts.initiatedBy ?? "self";
  const adminId = initiatedBy === "admin" ? (opts.adminId ?? null) : null;
  const auditAction = type === "delete" ? "gdpr.deletion_requested" : "gdpr.export_requested";

  // Reuse a still-valid pending confirmation instead of spamming inboxes.
  const existing = await db
    .select()
    .from(dataRequests)
    .where(
      and(
        eq(dataRequests.userId, userId),
        eq(dataRequests.type, type),
        eq(dataRequests.status, "pending_confirmation"),
      ),
    )
    .orderBy(desc(dataRequests.createdAt))
    .limit(1);
  if (existing[0] && Date.now() - existing[0].requestedAt.getTime() < EMAIL_EXPIRY_MS) {
    const request = existing[0];
    void recordAudit({
      actorId: adminId ?? userId,
      action: auditAction,
      targetType: "user",
      targetId: userId,
      details: { requestId: request.id, repeated: true, initiator: initiatedBy },
    });
    return {
      request: summarize(request),
      message: "A confirmation email is already on its way — check your inbox.",
    };
  }

  const { token, tokenHash } = issueConfirmationToken();
  const [request] = await db
    .insert(dataRequests)
    .values({
      userId,
      type,
      status: "pending_confirmation",
      initiatedBy,
      adminId,
      tokenHash,
    })
    .returning();

  await sendConfirmationEmail(userId, type, token);

  void recordAudit({
    actorId: adminId ?? userId,
    action: auditAction,
    targetType: "user",
    targetId: userId,
    details: { requestId: request.id, initiator: initiatedBy },
  });

  return {
    request: summarize(request),
    message:
      type === "delete"
        ? "Deletion request created. Confirm the link in your email — this cannot be undone."
        : "Export request created. Confirm the link in your email to generate your data.",
  };
}
export async function confirmDataRequest(token: string): Promise<GdprConfirmResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(dataRequests)
    .where(eq(dataRequests.tokenHash, hashOpaqueToken(token)))
    .limit(1);
  const request = rows[0];
  if (!request) throw notFound("Confirmation link is invalid or already used.");
  if (request.status !== "pending_confirmation") {
    throw conflict("This request was already processed.", "request_already_processed");
  }
  if (Date.now() - request.requestedAt.getTime() > EMAIL_EXPIRY_MS) {
    throw conflict("This confirmation link has expired — request again from your settings.");
  }

  await db
    .update(dataRequests)
    .set({ status: "processing", confirmedAt: new Date(), tokenHash: null }) // consume token
    .where(eq(dataRequests.id, request.id));

  try {
    if (request.type === "export") {
      const storageKey = await buildAndStoreExport(request.userId, request.id);
      await db
        .update(dataRequests)
        .set({ status: "completed", storageKey, completedAt: new Date() })
        .where(eq(dataRequests.id, request.id));
      void sendCompletionEmail(request.userId, "export");
      void recordAudit({
        actorId: request.adminId ?? request.userId,
        action: "gdpr.export_completed",
        targetType: "user",
        targetId: request.userId,
        details: { requestId: request.id },
      });
      return {
        status: "completed",
        message: "Your data export is ready. Download it from Settings → Data & privacy.",
        administeredFor: request.initiatedBy === "admin" ? request.adminId : null,
      };
    }

    // Deletion
    await anonymiseUser(request.userId);
    await db
      .update(dataRequests)
      .set({
        status: "completed",
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(dataRequests.id, request.id));
    void sendCompletionEmail(request.userId, "delete");
    void recordAudit({
      actorId: request.adminId ?? request.userId,
      action: "gdpr.account_deleted",
      targetType: "user",
      targetId: request.userId,
      details: {
        requestId: request.id,
        retainedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    return {
      status: "completed",
      message: "Your account data has been anonymised. Thank you for learning with us.",
      administeredFor: request.initiatedBy === "admin" ? request.adminId : null,
    };
  } catch (err) {
    await db
      .update(dataRequests)
      .set({ status: "failed", error: (err as Error)?.message ?? "processing_error" })
      .where(eq(dataRequests.id, request.id));
    throw serviceUnavailable(
      "Your request could not be processed right now — please try again.",
    );
  }
}

/** Anonymise PII for a GDPR delete or an admin delete. Row kept for stats. */
export async function anonymiseUser(userId: string): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const anonEmail = `deleted-${randomUUID().slice(0, 10)}@privacy.takwimu.school`;
  await db
    .update(users)
    .set({
      email: anonEmail,
      firstName: "Deleted",
      lastName: "User",
      passwordHash: randomUUID(),
      bio: "",
      avatarKey: null,
      interests: [],
      experienceLevel: null,
      ssoProvider: null,
      ssoSubject: null,
      status: "deleted",
      deletedAt: new Date(),
      emailVerifiedAt: null,
      consentGivenAt: null,
      forcePasswordResetAt: null,
    })
    .where(eq(users.id, userId));
}

export async function listMyRequests(userId: string): Promise<DataRequestListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(dataRequests)
    .where(eq(dataRequests.userId, userId))
    .orderBy(desc(dataRequests.createdAt));
  return { items: rows.map(summarize) };
}

export async function listAllRequests(): Promise<DataRequestListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(dataRequests).orderBy(desc(dataRequests.createdAt));
  return { items: rows.map(summarize) };
}

export async function downloadExport(
  userId: string,
  requestId: string,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(dataRequests)
    .where(
      and(
        eq(dataRequests.id, requestId),
        eq(dataRequests.userId, userId),
        eq(dataRequests.type, "export"),
      ),
    )
    .limit(1);
  const request = rows[0];
  if (!request || request.status !== "completed" || !request.storageKey) {
    throw notFound("This export is not ready yet.");
  }
  const stored = await getStorage().readObject(request.storageKey, "user-uploads");
  if (!stored) throw notFound("Export file not found.");
  return {
    buffer: stored.data,
    contentType: stored.contentType || "application/zip",
    filename: `takwimu-data-export-${userId.slice(0, 8)}.zip`,
  };
}

export function hasCompletedExport(rows: Array<{ type: string; status: string }>): boolean {
  return rows.some((r) => r.type === "export" && r.status === "completed");
}
// ── internals ────────────────────────────────────────────────

function issueConfirmationToken(): { token: string; tokenHash: string } {
  const token = issueOpaqueToken();
  return { token, tokenHash: hashOpaqueToken(token) };
}

function summarize(row: {
  id: string;
  type: DataRequestType;
  status: Status;
  initiatedBy: "self" | "admin";
  requestedAt: Date;
  confirmedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  error: string | null;
}): DataRequestSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    initiatedBy: row.initiatedBy,
    requestedAt: row.requestedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    downloadUrl:
      row.type === "export" && row.status === "completed"
        ? `/api/v1/gdpr/exports/${row.id}/download`
        : null,
    error: row.error,
  };
}

async function sendConfirmationEmail(userId: string, type: DataRequestType, token: string): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ email: users.email, firstName: users.firstName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return;
  const env = loadEnv();
  const confirmUrl = `${env.WEB_ORIGIN}/privacy/confirm?token=${token}`;
  const mailer = getMailer();
  const text =
    type === "delete"
      ? `Hi ${user.firstName},\n\nWe received a request to delete your Takwimu Data School account.\nThis will anonymise all personal data and cannot be undone.\n\nConfirm: ${confirmUrl}\n\nIf you did not request this, you can safely ignore this email.`
      : `Hi ${user.firstName},\n\nWe received a request to export your Takwimu Data School data.\n\nConfirm to generate your download: ${confirmUrl}\n\nIf you did not request this, you can safely ignore this email.`;
  try {
    await mailer.sendEmail({ to: user.email, subject: EMAIL_SUBJECTS[type], text });
  } catch (err) {
    console.warn(`[gdpr] confirmation email failed for ${user.email}:`, (err as Error)?.message ?? err);
  }
}

async function sendCompletionEmail(userId: string, type: DataRequestType): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return;
  const env = loadEnv();
  const mailer = getMailer();
  const text =
    type === "delete"
      ? "Your Takwimu Data School account data has been anonymised. You can create a new account at any time."
      : `Your data export is ready — download it from ${env.WEB_ORIGIN}/settings/privacy`;
  try {
    await mailer.sendEmail({
      to: user.email,
      subject: type === "delete" ? "Your account has been deleted" : "Your data export is ready",
      text,
    });
  } catch {
    /* noop */
  }
}
async function buildAndStoreExport(userId: string, requestId: string): Promise<string> {
  const { db } = getDb(loadEnv().DATABASE_URL);

  const [profileRows, enrolmentRows, progressRows, attemptRows, gradeRows, orderRows, certRows, analyticsRows, discussionRows, notificationRows, preferenceRows] =
    await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db
        .select({
          id: enrolments.id,
          courseSlug: courses.slug,
          courseTitle: courses.title,
          enrolledAt: enrolments.enrolledAt,
          status: enrolments.status,
        })
        .from(enrolments)
        .innerJoin(courses, eq(enrolments.courseId, courses.id))
        .where(eq(enrolments.userId, userId)),
      db
        .select({
          lessonTitle: lessons.title,
          courseId: progress.courseId,
          completed: progress.completed,
          lastPositionMs: progress.lastPositionMs,
          updatedAt: progress.updatedAt,
        })
        .from(progress)
        .innerJoin(lessons, eq(progress.lessonId, lessons.id))
        .where(eq(progress.userId, userId)),
      db
        .select({
          id: quizAttempts.id,
          lessonTitle: lessons.title,
          status: quizAttempts.status,
          startedAt: quizAttempts.startedAt,
          submittedAt: quizAttempts.submittedAt,
          score: quizAttempts.score,
          maxScore: quizAttempts.maxScore,
          percent: quizAttempts.percent,
          passed: quizAttempts.passed,
        })
        .from(quizAttempts)
        .innerJoin(lessons, eq(quizAttempts.lessonId, lessons.id))
        .where(eq(quizAttempts.userId, userId)),
      db.select().from(gradebook).where(eq(gradebook.userId, userId)),
      db.select().from(orders).where(eq(orders.userId, userId)),
      db.select().from(certificates).where(eq(certificates.userId, userId)),
      db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, userId)),
      // US-6.1.1 — the learner's forum activity (Sprint 8 fills this section).
      db
        .select({
          id: discussionPosts.id,
          courseId: discussionPosts.courseId,
          lessonId: discussionPosts.lessonId,
          parentId: discussionPosts.parentId,
          depth: discussionPosts.depth,
          body: discussionPosts.body,
          upvoteCount: discussionPosts.upvoteCount,
          status: discussionPosts.status,
          createdAt: discussionPosts.createdAt,
        })
        .from(discussionPosts)
        .where(eq(discussionPosts.authorId, userId)),
      // US-10.1.1 — in-app notifications addressed to the learner.
      db.select().from(notifications).where(eq(notifications.userId, userId)),
      db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)),
    ]);

  const profile = profileRows[0];
  const profileSafe = profile ? { ...profile, passwordHash: undefined } : {};

  const entries: Array<{ path: string; data: Buffer | string }> = [
    { path: "profile.json", data: JSON.stringify(profileSafe, null, 2) },
    { path: "enrolments.json", data: JSON.stringify(enrolmentRows, null, 2) },
    { path: "lesson_progress.json", data: JSON.stringify(progressRows, null, 2) },
    { path: "quiz_attempts.json", data: JSON.stringify(attemptRows, null, 2) },
    { path: "gradebook.json", data: JSON.stringify(gradeRows, null, 2) },
    { path: "orders.json", data: JSON.stringify(orderRows, null, 2) },
    { path: "certificates.json", data: JSON.stringify(certRows, null, 2) },
    { path: "analytics_events.json", data: JSON.stringify(analyticsRows, null, 2) },
    { path: "forum_posts.json", data: JSON.stringify(discussionRows, null, 2) }, // US-6.1.1
    { path: "notifications.json", data: JSON.stringify(notificationRows, null, 2) }, // US-10.1.1
    { path: "notification_preferences.json", data: JSON.stringify(preferenceRows, null, 2) }, // US-10.1.1
  ];

  // Certificate PDFs the learner earned (US-5.1.2 artefacts).
  const storage = getStorage();
  for (const cert of certRows) {
    const stored = await storage.readObject(cert.fileKey, "user-uploads");
    if (stored) entries.push({ path: `certificates/${cert.certificateNumber}.pdf`, data: stored.data });
  }

  const zip = await buildZip(entries);
  const storageKey = `gdpr-exports/${userId}/${requestId}.zip`;
  await storage.putObject(storageKey, zip, "application/zip", "user-uploads");
  return storageKey;
}

function buildZip(entries: Array<{ path: string; data: Buffer | string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("warning", (err) => console.warn("[gdpr] zip warning:", err.message));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) archive.append(entry.data, { name: entry.path });
    void archive.finalize();
  });
}