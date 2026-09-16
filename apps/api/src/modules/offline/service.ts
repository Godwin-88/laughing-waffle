import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  CreateOfflineDownloadResponse,
  OfflineDownloadListResponse,
  OfflineDownloadRow,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, lessons, modules, offlineDownloads, quizQuestions } from "../../db/schema";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../../lib/errors";
import { getConfig } from "../../lib/config";
import { getStorage } from "../../storage/storage";
import {
  deriveDeviceKey,
  encryptPayload,
  offlineStorageKey,
  OFFLINE_EXPIRY_DAYS,
  wrapContentKey,
} from "./crypto";

/**
 * US-3.1.2 — Offline lesson download (mobile).
 *   • Enrolled learners only.
 *   • Content is encrypted at rest with AES-256-GCM; the content key is
 *     wrapped with a device-bound key (deviceId-derived) so the ciphertext
 *     is unusable without the originating device.
 *   • Downloads expire 30 days after download OR when the enrolment expires,
 *     whichever is sooner.
 *   • A queue status (queued → processing → ready) exposes progress.
 */

function toRow(
  row: typeof offlineDownloads.$inferSelect,
  lessonTitle: string,
  courseTitle: string,
  fileUrl: string | null,
): OfflineDownloadRow {
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle,
    courseTitle,
    status: row.status as OfflineDownloadRow["status"],
    progress: row.progress,
    sizeBytes: row.sizeBytes,
    keyWrapped: (row.keyWrapped ?? null) as Record<string, string> | null,
    fileUrl,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/** Verify the learner has an active enrolment for the lesson's course + the feature flag. */
async function assertEligible(
  userId: string,
  lessonId: string,
): Promise<{ enrolmentId: string; enrolmentExpiry: Date | null }> {
  const cfg = await getConfig();
  if (!cfg.features.offlineDownload) {
    throw badRequest("Offline downloads are currently disabled by the platform administrator.", {
      offlineDownload: "disabled",
    });
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const lessonRows = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (lessonRows.length === 0) throw notFound("Lesson not found.");
  const lesson = lessonRows[0];

  const enrolmentRows = await db
    .select()
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, lesson.courseId)))
    .limit(1);
  const enrolment = enrolmentRows[0];
  if (!enrolment) {
    throw forbidden("Enrol in the course before downloading lessons for offline viewing.");
  }
  if (enrolment.expiresAt && enrolment.expiresAt < new Date()) {
    throw forbidden("Your enrolment has expired — offline content is no longer available.");
  }
  return { enrolmentId: enrolment.id, enrolmentExpiry: enrolment.expiresAt ?? null };
}

/** Build the lesson bundle (text/markdown + quiz questions + video metadata). */
async function buildLessonBundle(
  userId: string,
  lessonId: string,
): Promise<{ bundle: Buffer; sha: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const lessonRows = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  const lesson = lessonRows[0];
  const moduleRows = lesson.moduleId
    ? await db.select({ title: modules.title }).from(modules).where(eq(modules.id, lesson.moduleId)).limit(1)
    : [];
  const questionRows = await db
    .select({ prompt: quizQuestions.prompt, options: quizQuestions.options, explanation: quizQuestions.explanation })
    .from(quizQuestions)
    .where(eq(quizQuestions.lessonId, lessonId))
    .orderBy(asc(quizQuestions.position));

  const payload: Record<string, unknown> = {
    schema: "takwimu-offline-lesson/v1",
    lessonId,
    userId,
    title: lesson.title,
    summary: lesson.summary,
    content: lesson.content,
    kind: lesson.kind,
    video: lesson.hlsPrefix ? { hlsPrefix: lesson.hlsPrefix } : null,
    quiz: questionRows.length > 0
      ? questionRows.map((q) => ({ prompt: q.prompt, options: q.options, explanation: q.explanation }))
      : null,
    generatedAt: new Date().toISOString(),
  };
  const bundle = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
  const sha = createHash("sha256").update(bundle).digest("hex");
  return { bundle, sha };
}

function expiryFor(enrolmentExpiry: Date | null): Date {
  const in30 = new Date(Date.now() + OFFLINE_EXPIRY_DAYS * 24 * 3600 * 1000);
  return enrolmentExpiry && enrolmentExpiry < in30 ? enrolmentExpiry : in30;
}

export async function createOfflineDownload(
  userId: string,
  input: { lessonId: string; deviceId: string },
): Promise<CreateOfflineDownloadResponse> {
  if (!input.deviceId || input.deviceId.length < 8) {
    throw badRequest("A deviceId is required to bind this download to your device.", { deviceId: "required" });
  }
  const { enrolmentId, enrolmentExpiry } = await assertEligible(userId, input.lessonId);
  const { bundle, sha } = await buildLessonBundle(userId, input.lessonId);
  const deviceKey = deriveDeviceKey(input.deviceId);

  const { db } = getDb(loadEnv().DATABASE_URL);
  // Stage 1 — queue record so the client sees progress.
  const [row] = await db
    .insert(offlineDownloads)
    .values({
      userId,
      lessonId: input.lessonId,
      enrolmentId,
      deviceId: input.deviceId,
      status: "queued",
      progress: 0,
      expiresAt: expiryFor(enrolmentExpiry),
      sizeBytes: bundle.length,
      contentSha: sha,
    })
    .returning();

  await db
    .update(offlineDownloads)
    .set({ status: "processing", progress: 30 })
    .where(eq(offlineDownloads.id, row.id));

  // Encrypt the bundle + wrap the content key for the device.
  const { contentKey, wrapped } = wrapContentKey(deviceKey);
  const encrypted = encryptPayload(contentKey, bundle);
  const fileBytes = Buffer.concat([
    Buffer.from("TAKOF1", "utf-8"), // magic marker
    Buffer.from(encrypted.iv, "utf-8"),
    Buffer.from(encrypted.tag, "utf-8"),
    encrypted.ciphertext,
  ]);

  const storage = getStorage();
  const key = offlineStorageKey(userId, row.id);
  await storage.putObject(key, fileBytes, "application/octet-stream", "user-uploads");

  const [readyRow] = await db
    .update(offlineDownloads)
    .set({
      status: "ready",
      progress: 100,
      fileKey: key,
      keyWrapped: wrapped as unknown as Record<string, string>,
      completedAt: new Date(),
    })
    .where(eq(offlineDownloads.id, row.id))
    .returning();

  const fileUrl = await storage.signUrl(key, "user-uploads", 2 * 3600);
  const lessonTitle = (await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, input.lessonId)).limit(1))[0]?.title ?? "Lesson";
  return {
    download: toRow(readyRow, lessonTitle, "", fileUrl),
    ready: true,
  };
}

/** Scope a download to its owner; enforces expiries + the enrolment gate. */
async function loadOwnedDownload(
  userId: string,
  downloadId: string,
  requireReady = false,
): Promise<typeof offlineDownloads.$inferSelect> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(offlineDownloads)
    .where(and(eq(offlineDownloads.id, downloadId), eq(offlineDownloads.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw notFound("Offline download not found.");
  const row = rows[0];

  if (row.status === "ready" && row.expiresAt < new Date()) {
    await db.update(offlineDownloads).set({ status: "expired" }).where(eq(offlineDownloads.id, row.id));
    row.status = "expired";
  }
  // Lazy expiry sweep when the enrolment ends.
  if (row.status === "ready" && row.enrolmentId) {
    const enr = await db
      .select({ expiresAt: enrolments.expiresAt })
      .from(enrolments)
      .where(eq(enrolments.id, row.enrolmentId))
      .limit(1);
    if (enr.length > 0 && enr[0].expiresAt && enr[0].expiresAt! < new Date()) {
      await db.update(offlineDownloads).set({ status: "expired" }).where(eq(offlineDownloads.id, row.id));
      row.status = "expired";
    }
  }
  if (requireReady && row.status !== "ready") {
    throw badRequest("The download is not ready yet.", { status: row.status });
  }
  return row;
}

async function decorate(row: typeof offlineDownloads.$inferSelect): Promise<OfflineDownloadRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const lessonRows = await db
    .select({ title: lessons.title, courseId: lessons.courseId })
    .from(lessons)
    .where(eq(lessons.id, row.lessonId))
    .limit(1);
  const courseRows = lessonRows.length > 0
    ? await db.select({ title: courses.title }).from(courses).where(eq(courses.id, lessonRows[0].courseId)).limit(1)
    : [];
  const fileUrl = row.status === "ready" && row.fileKey
    ? await getStorage().signUrl(row.fileKey, "user-uploads", 2 * 3600)
    : null;
  return toRow(row, lessonRows[0]?.title ?? "Lesson", courseRows[0]?.title ?? "Course", fileUrl);
}

export async function listOfflineDownloads(userId: string): Promise<OfflineDownloadListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(offlineDownloads)
    .where(eq(offlineDownloads.userId, userId))
    .orderBy(desc(offlineDownloads.createdAt));
  const items = await Promise.all(rows.map(decorate));
  return { items, total: items.length };
}

export async function getOfflineDownload(userId: string, downloadId: string): Promise<OfflineDownloadRow> {
  const row = await loadOwnedDownload(userId, downloadId);
  return decorate(row);
}

export async function cancelOfflineDownload(userId: string, downloadId: string): Promise<{ ok: true }> {
  const row = await loadOwnedDownload(userId, downloadId);
  if (row.status === "ready" && row.fileKey) {
    try {
      await getStorage().deleteObject(row.fileKey, "user-uploads");
    } catch {
      /* non-fatal */
    }
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .update(offlineDownloads)
    .set({ status: "revoked", cancelledAt: new Date() })
    .where(eq(offlineDownloads.id, row.id));
  return { ok: true };
}

/** Stream the encrypted payload (ciphertext stays server-side; device unwraps). */
export async function getOfflineDownloadFile(
  userId: string,
  downloadId: string,
): Promise<{ data: Buffer; filename: string }> {
  const row = await loadOwnedDownload(userId, downloadId, true);
  if (!row.fileKey) throw serviceUnavailable("Download file is missing. Request a new download.", "missing_file");
  const obj = await getStorage().readObject(row.fileKey, "user-uploads");
  if (!obj) throw serviceUnavailable("Download file is missing. Request a new download.", "missing_file");
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .update(offlineDownloads)
    .set({ lastAccessedAt: new Date() })
    .where(eq(offlineDownloads.id, row.id));
  return { data: obj.data, filename: `takwimu-lesson-${row.lessonId.slice(0, 8)}.takwimu` };
}