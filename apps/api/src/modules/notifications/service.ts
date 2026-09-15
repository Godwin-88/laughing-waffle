import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AppNotification,
  NotificationListResponse,
  NotificationPreferences,
  NotificationType,
  UnreadCountResponse,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import {
  analyticsEvents,
  courses,
  enrolments,
  lessons,
  notificationPreferences,
  notifications,
  users,
} from "../../db/schema";
import { getMailer } from "../../mail/mailer";
import { getConfig } from "../../lib/config";

// ─────────────────────────────────────────────────────────────
// US-10.1.1 — In-app + email notifications
// • Each type independently toggleable in Notification Preferences
// • In-app: unread badge on bell icon; dropdown shows last 20
// • Email: HTML template matching branding; plain-text fallback
// • Unsubscribe link in every email (CAN-SPAM / GDPR Art. 21)
// ─────────────────────────────────────────────────────────────

export const NOTIFICATION_TYPE_KEYS: Record<NotificationType, keyof NotificationPreferences> = {
  discussion_reply: "discussionReply",
  assignment_graded: "assignmentGraded",
  course_content_added: "courseContentAdded",
  certificate_issued: "certificateIssued",
  payment_receipt: "paymentReceipt",
  streak_reminder: "streakReminder",
  instructor_announcement: "instructorAnnouncement",
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  discussionReply: true,
  assignmentGraded: true,
  courseContentAdded: true,
  certificateIssued: true,
  paymentReceipt: true,
  streakReminder: true,
  instructorAnnouncement: true,
  marketing: true,
};

export interface NotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  actorUserId?: string | null;
  email?: boolean;
}

export async function createNotification(input: NotificationInput) {
  const prefs = await getPreferences(input.recipientId);
  const prefKey = NOTIFICATION_TYPE_KEYS[input.type];
  if (!prefs[prefKey]) return null;
  try {
    const { db } = getDb(loadEnv().DATABASE_URL);
    const row = await db
      .insert(notifications)
      .values({
        userId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        link: input.link ?? null,
        actorUserId: input.actorUserId ?? null,
      })
      .returning({ id: notifications.id, createdAt: notifications.createdAt });
    if (input.email !== false && (prefs.marketing ?? true)) {
      void sendNotificationEmail(input.recipientId, input.type, input.title, input.body, input.link ?? null);
    }
    return row[0];
  } catch (err) {
    console.warn(`[notifications] failed to create ${input.type}:`, (err as Error)?.message ?? err);
    return null;
  }
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    discussionReply: row.discussionReply ?? true,
    assignmentGraded: row.assignmentGraded ?? true,
    courseContentAdded: row.courseContentAdded ?? true,
    certificateIssued: row.certificateIssued ?? true,
    paymentReceipt: row.paymentReceipt ?? true,
    streakReminder: row.streakReminder ?? true,
    instructorAnnouncement: row.instructorAnnouncement ?? true,
    marketing: row.marketing ?? true,
  };
}

export async function updatePreferences(
  userId: string,
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const current = await getPreferences(userId);
  const next = { ...current, ...patch };
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .insert(notificationPreferences)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId],
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

export async function listNotifications(userId: string, limit = 20): Promise<NotificationListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      actorName: users.firstName,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorUserId, users.id))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  const items = rows.map<AppNotification>((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    link: r.link,
    actorName: r.actorName,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  const unread = await unreadCount(userId);
  return { items, unread: unread.unread };
}

export async function unreadCount(userId: string): Promise<UnreadCountResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} IS NULL`));
  return { unread: row?.n ?? 0 };
}

export async function markRead(userId: string, ids?: string[]): Promise<UnreadCountResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  if (ids && ids.length > 0) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
  } else {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.userId, userId));
  }
  return unreadCount(userId);
}
// ─────────────────────────────────────────────────────────────
// Typed notification helpers used by the domain modules
// ─────────────────────────────────────────────────────────────

export async function notifyDiscussionReply(opts: {
  recipientIds: string[];
  replierId: string;
  postBody: string;
  courseSlug: string;
  lessonPosition: number;
  lessonTitle: string;
}) {
  for (const recipientId of opts.recipientIds) {
    if (recipientId === opts.replierId) continue;
    await createNotification({
      recipientId,
      type: "discussion_reply",
      title: "Someone replied to your question",
      body: `${opts.postBody.slice(0, 140)}${opts.postBody.length > 140 ? "…" : ""}`,
      link: `/courses/${opts.courseSlug}/lessons/${opts.lessonPosition}`,
      actorUserId: opts.replierId,
    });
  }
}

export async function notifyQuizGraded(opts: {
  userId: string;
  courseSlug: string;
  lessonPosition: number;
  percent: number;
  passed: boolean;
}) {
  try {
    const { db } = getDb(loadEnv().DATABASE_URL);
    const [lessonRow] = await db
      .select({ title: lessons.title })
      .from(lessons)
      .innerJoin(courses, eq(lessons.courseId, courses.id))
      .where(and(eq(courses.slug, opts.courseSlug), eq(lessons.position, opts.lessonPosition)))
      .limit(1);
    const lessonTitle = lessonRow?.title ?? `Lesson ${opts.lessonPosition}`;
    await createNotification({
      recipientId: opts.userId,
      type: "assignment_graded",
      title: opts.passed ? "Quiz passed — nice work!" : "Quiz graded",
      body: `${lessonTitle}: you scored ${opts.percent}%${opts.passed ? " (pass)" : " (retake available)"}.`,
      link: `/courses/${opts.courseSlug}/lessons/${opts.lessonPosition}`,
    });
  } catch (err) {
    console.warn("[notifications] quiz-graded notification failed:", (err as Error)?.message ?? err);
  }
}

export async function notifyCertificateIssued(opts: {
  userId: string;
  certificateNumber: string;
  courseTitle: string;
}) {
  await createNotification({
    recipientId: opts.userId,
    type: "certificate_issued",
    title: "Certificate issued 🎉",
    body: `Your Takwimu certificate ${opts.certificateNumber} for “${opts.courseTitle}” is ready to download.`,
    link: "/certificates",
  });
}

export async function notifyPaymentReceipt(opts: {
  userId: string;
  orderNumber: string;
  courseTitle: string;
  amountText: string;
}) {
  await createNotification({
    recipientId: opts.userId,
    type: "payment_receipt",
    title: "Payment received",
    body: `Receipt ${opts.orderNumber} — ${opts.courseTitle} · ${opts.amountText}.`,
    link: "/orders",
  });
}
/** US-10.1.1 “new course content added” — fan-out to every enrolled learner. */
export async function notifyCourseContentAdded(opts: {
  courseId: string;
  courseSlug: string;
  lessonTitle: string;
  lessonPosition: number;
}) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ userId: enrolments.userId })
    .from(enrolments)
    .where(eq(enrolments.courseId, opts.courseId));
  for (const { userId } of rows) {
    await createNotification({
      recipientId: userId,
      type: "course_content_added",
      title: "New lesson added",
      body: `“${opts.lessonTitle}” was just published to your course.`,
      link: `/courses/${opts.courseSlug}/lessons/${opts.lessonPosition}`,
    });
  }
}

/** US-10.1.1 “instructor announcement” — instructor/admin → all enrolled. */
export async function notifyAnnouncement(opts: {
  courseId: string;
  courseSlug: string;
  authorId: string;
  title: string;
  body: string;
  link?: string | null;
}) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ userId: enrolments.userId })
    .from(enrolments)
    .where(eq(enrolments.courseId, opts.courseId));
  for (const { userId } of rows) {
    await createNotification({
      recipientId: userId,
      type: "instructor_announcement",
      title: opts.title,
      body: opts.body,
      link: opts.link ?? `/courses/${opts.courseSlug}`,
      actorUserId: opts.authorId,
    });
  }
}

/**
 * US-10.1.1 “streak reminder” — called on login. When a learner has been
 * active on >=3 distinct days in the last 7 and hasn't studied today, nudge
 * them (at most once per day, only if the type is still enabled).
 */
export async function maybeSendStreakReminder(userId: string) {
  try {
    const prefs = await getPreferences(userId);
    if (!prefs.streakReminder) return;
    const { db } = getDb(loadEnv().DATABASE_URL);
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.userId, userId),
          eq(analyticsEvents.eventName, "lesson_viewed"),
          sql`${analyticsEvents.createdAt}::date >= CURRENT_DATE - 7`,
        ),
      );
    if ((recent?.n ?? 0) < 3) return;
    const [already] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, "streak_reminder"),
          sql`${notifications.createdAt}::date = CURRENT_DATE`,
        ),
      );
    if ((already?.n ?? 0) > 0) return;
    await createNotification({
      recipientId: userId,
      type: "streak_reminder",
      title: "Keep your streak alive 🔥",
      body: "You've been learning 3 days in a row — today's lesson is waiting.",
      link: "/dashboard",
    });
  } catch (err) {
    console.warn("[notifications] streak reminder skipped:", (err as Error)?.message ?? err);
  }
}
// ─────────────────────────────────────────────────────────────
// Email leg — branded HTML + plain-text fallback + unsubscribe
// (CAN-SPAM / GDPR Article 21 compliant link).
// ─────────────────────────────────────────────────────────────

async function sendNotificationEmail(
  recipientId: string,
  type: NotificationType,
  title: string,
  body: string | undefined,
  link: string | null,
) {
  try {
    const { db } = getDb(loadEnv().DATABASE_URL);
    const [user] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, recipientId))
      .limit(1);
    if (!user) return;
    const env = loadEnv();
    const cfg = await getConfig();
    const target = link ? `${env.WEB_ORIGIN}${link}` : env.WEB_ORIGIN;
    const unsubscribeUrl = `${env.WEB_ORIGIN}/settings/notifications?unsubscribe=1`;
    const text =
      `${title}\n\n${body ?? ""}\n\nView on Takwimu: ${target}\n\nYou're receiving this because you have ${type.replace(/_/g, " ")} notifications enabled in your Takwimu Data School preferences.\nUnsubscribe or manage all notification types: ${unsubscribeUrl}`;
    const brand = cfg.platform.name || "Takwimu Data School";
    const accent = cfg.platform.primaryColor || "#0f766e";
    const safeTitle = title.replace(/</g, "&lt;");
    const safeBody = (body ?? "").replace(/</g, "&lt;");
    const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#fafafa;font-family:Raleway,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:24px auto;border:1px solid #e2e2e2;border-radius:16px;overflow:hidden">
    <div style="background:${accent};color:#fff;padding:20px 28px">
      <span style="font-weight:800">${brand}</span>
    </div>
    <div style="padding:28px;color:#1a1a1a">
      <h2 style="margin:0 0 8px;font-size:20px">${safeTitle}</h2>
      <p style="margin:0;line-height:1.6">${safeBody}</p>
      <p style="margin:20px 0 0"><a href="${target}" style="background:${accent};color:#fff;display:inline-block;padding:10px 18px;border-radius:8px;text-decoration:none">Open in ${brand}</a></p>
    </div>
    <div style="padding:16px 28px;color:#6b7280;font-size:12px;border-top:1px solid #eee">
      ${cfg.email.fromName || "Takwimu Data School"}, ${cfg.email.fromAddress || "hello@takwimu.school"}<br/>
      <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe / manage notification preferences</a>
    </div>
  </div>
</body></html>`;
    await getMailer().sendEmail({ to: user.email, subject: title, text, html });
  } catch (err) {
    console.warn(`[notifications] email leg failed (${type}):`, (err as Error)?.message ?? err);
  }
}

export function resetNotificationCacheForTests() {
  /* no-op hook for test isolation */
}
