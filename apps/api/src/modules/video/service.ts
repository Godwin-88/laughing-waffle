import { and, asc, desc, eq } from "drizzle-orm";
import type {
  VideoAssetStatus,
  VideoLessonInfo,
  VideoPartUrlResponse,
  VideoStatus,
  VideoUploadSession,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import {
  courses,
  enrolments,
  lessons,
  progress,
  transcodeJobs,
  videoAssets,
} from "../../db/schema";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";
import {
  captionsKeyFor,
  getStorage,
  posterKeyFor,
  videoSourceKey,
} from "../../storage/storage";
import { queueTranscodeForAsset } from "./transcode";

const PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB chunks (US-4.1.2 chunked multipart)

/**
 * US-3.1.1 — video lesson payload. The HLS manifest (proxied) is gated on
 * enrolment; guests and unenrolled learners get preview details only
 * (poster + duration), matching the "preview without login" rule.
 */
export async function buildLessonVideoPayload(
  courseId: string,
  lesson: {
    id: string;
    kind: string | null;
    videoStatus: string | null;
    videoDurationSeconds: number | null;
    videoPosterKey: string | null;
    captionsKey: string | null;
    hlsPrefix: string | null;
  },
  userId: string | null,
): Promise<VideoLessonInfo | null> {
  if (lesson.kind !== "video") return null;
  const env = loadEnv();
  const { db } = getDb(env.DATABASE_URL);

  const [asset] = await db
    .select()
    .from(videoAssets)
    .where(eq(videoAssets.lessonId, lesson.id))
    .orderBy(desc(videoAssets.createdAt))
    .limit(1);

  const status: VideoStatus = (lesson.videoStatus as VideoStatus) || "none";
  const durationSeconds = lesson.videoDurationSeconds ?? asset?.durationSeconds ?? null;
  const posterUrl = lesson.videoPosterKey
    ? await getStorage().signUrl(lesson.videoPosterKey, "course-assets", 7 * 24 * 3600)
    : null;

  const isEnrolled = Boolean(
    userId &&
      (await db
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, courseId)))
        .limit(1)).length > 0,
  );

  let savedPositionMs: number | null = null;
  if (userId) {
    const [p] = await db
      .select({ lastPositionMs: progress.lastPositionMs })
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.lessonId, lesson.id)))
      .limit(1);
    savedPositionMs = p?.lastPositionMs ?? null;
  }

  const mediaBase = `${env.PUBLIC_API_URL}/api/v1/media/hls/${courseId}/${lesson.id}`;

  if (!isEnrolled) {
    return {
      status,
      durationSeconds,
      posterUrl,
      captionsUrl: null,
      hlsManifestUrl: null,
      tiers: [],
      savedPositionMs: null,
      error: status === "failed" ? (asset?.error ?? "Transcoding failed.") : null,
      uploadedAt: asset?.createdAt ? asset.createdAt.toISOString() : null,
    };
  }

  const tiers = [
    { height: 360, width: 640, bandwidth: 800_000, playlistPath: "360p/index.m3u8" },
    { height: 720, width: 1280, bandwidth: 2_800_000, playlistPath: "720p/index.m3u8" },
    { height: 1080, width: 1920, bandwidth: 5_000_000, playlistPath: "1080p/index.m3u8" },
  ];

  return {
    status,
    durationSeconds,
    posterUrl,
    captionsUrl: lesson.captionsKey ? `${mediaBase}/captions.vtt` : null,
    hlsManifestUrl: lesson.hlsPrefix ? `${mediaBase}/index.m3u8` : null,
    tiers,
    savedPositionMs: status === "ready" ? savedPositionMs : null,
    error: status === "failed" ? (asset?.error ?? "Transcoding failed.") : null,
    uploadedAt: asset?.createdAt ? asset.createdAt.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────
// US-4.1.2 — video upload pipeline (chunked multipart)
// ─────────────────────────────────────────────────────────────

export interface UploadSessionInput {
  filename: string;
  contentType?: string;
  sizeBytes: number;
}

export interface PartRecord {
  partNumber: number;
  etag?: string | null;
  size: number;
}

async function ownedAssetFor(userId: string, userRole: string, assetId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [asset] = await db.select().from(videoAssets).where(eq(videoAssets.id, assetId)).limit(1);
  if (!asset) throw notFound("Upload session not found.");
  if (asset.userId !== userId && userRole !== "admin") {
    throw forbidden("This upload belongs to another instructor.");
  }
  return asset;
}

async function ownedLessonFor(userId: string, userRole: string, lessonId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [lesson] = await db
    .select({ id: lessons.id, courseId: lessons.courseId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (!lesson) throw notFound("Lesson not found.");
  const [course] = await db
    .select({ id: courses.id, instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, lesson.courseId))
    .limit(1);
  if (!course) throw notFound("Course not found.");
  const isOwner = course.instructorId === userId;
  const isAdmin = userRole === "admin";
  if (!isOwner && !isAdmin) throw forbidden("Only the course instructor can manage this lesson.");
  return { lesson, course };
}

export async function createUploadSession(
  userId: string,
  userRole: string,
  lessonId: string,
  input: UploadSessionInput,
): Promise<VideoUploadSession> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const filename = (input.filename ?? "video.mp4").trim().replace(/[\\/]/g, "_") || "video.mp4";
  const contentType = input.contentType || "video/mp4";
  const sizeBytes = Math.max(0, Math.round(input.sizeBytes || 0));
  if (sizeBytes <= 0) throw badRequest("Provide a valid source file size.", { sizeBytes: "required" });

  const { lesson, course } = await ownedLessonFor(userId, userRole, lessonId);
  const storage = getStorage();
  const sourceKey = videoSourceKey(course.id, lesson.id, filename);
  const multipart = await storage.createMultipartUpload(sourceKey, "course-assets", contentType);

  const [asset] = await db
    .insert(videoAssets)
    .values({
      courseId: course.id,
      lessonId: lesson.id,
      userId,
      sourceFilename: filename,
      sourceContentType: contentType,
      sourceSizeBytes: sizeBytes,
      sourceKey,
      uploadId: multipart.uploadId,
      status: "uploading",
    })
    .returning();

  await db
    .update(lessons)
    .set({ kind: "video", videoStatus: "uploading" })
    .where(eq(lessons.id, lesson.id));

  const partCount = Math.max(1, Math.ceil(sizeBytes / PART_SIZE_BYTES));
  return {
    assetId: asset.id,
    lessonId: lesson.id,
    partSizeBytes: PART_SIZE_BYTES,
    partCount,
    driver: storage.name as "local" | "b2",
    putMethod: storage.name === "b2" ? "url" : "api",
    sourceKey,
  };
}

export async function partUploadUrl(
  userId: string,
  userRole: string,
  assetId: string,
  partNumber: number,
): Promise<VideoPartUrlResponse> {
  const asset = await ownedAssetFor(userId, userRole, assetId);
  if (asset.status !== "uploading") throw badRequest(`Upload is ${asset.status}, not in progress.`);
  const env = loadEnv();
  const storage = getStorage();
  if (storage.name === "b2") {
    const url = await storage.presignUploadPart(asset.sourceKey, "course-assets", asset.uploadId ?? "", partNumber);
    if (!url) throw badRequest("Could not presign part upload URL.");
    return { url, partNumber };
  }
  return {
    url: `${env.PUBLIC_API_URL}/api/v1/instructor/videos/${assetId}/parts/${partNumber}`,
    partNumber,
  };
}

async function recordPart(assetId: string, part: PartRecord) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [asset] = await db
    .select({ parts: videoAssets.parts, uploadedBytes: videoAssets.uploadedBytes })
    .from(videoAssets)
    .where(eq(videoAssets.id, assetId))
    .limit(1);
  if (!asset) throw notFound("Upload session not found.");
  const parts = (asset.parts ?? []).filter((p) => p.partNumber !== part.partNumber);
  parts.push({ partNumber: part.partNumber, etag: part.etag ?? null, size: part.size });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  const uploadedBytes = parts.reduce((sum, p) => sum + p.size, 0);
  await db
    .update(videoAssets)
    .set({ parts: parts as never, uploadedBytes })
    .where(eq(videoAssets.id, assetId));
}

/** Local driver — parts stream directly to the platform route (5 MB max each). */
export async function receivePart(
  userId: string,
  userRole: string,
  assetId: string,
  partNumber: number,
  data: Buffer,
): Promise<void> {
  const asset = await ownedAssetFor(userId, userRole, assetId);
  if (asset.status !== "uploading") throw badRequest("Upload is not in progress.");
  const maxParts = Math.max(1, Math.ceil(asset.sourceSizeBytes / PART_SIZE_BYTES));
  if (partNumber < 1 || partNumber > maxParts) throw badRequest("Invalid part number.");
  const storage = getStorage();
  await storage.writePart(asset.sourceKey, "course-assets", asset.uploadId ?? "", partNumber, data);
  await recordPart(assetId, { partNumber, size: data.byteLength });
}

/** B2 driver — client PUTs to a presigned UploadPart URL, then reports completion. */
export async function reportPartComplete(
  userId: string,
  userRole: string,
  assetId: string,
  part: PartRecord,
): Promise<void> {
  await ownedAssetFor(userId, userRole, assetId);
  await recordPart(assetId, part);
}

export async function completeUpload(
  userId: string,
  userRole: string,
  assetId: string,
): Promise<VideoAssetStatus> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const asset = await ownedAssetFor(userId, userRole, assetId);
  if (asset.status !== "uploading") throw badRequest("Upload is not in progress.");

  const expectedParts = Math.max(1, Math.ceil(asset.sourceSizeBytes / PART_SIZE_BYTES));
  const parts = asset.parts ?? [];
  if (parts.length < expectedParts) {
    throw badRequest(`Upload incomplete: ${parts.length}/${expectedParts} parts received.`);
  }

  const storage = getStorage();
  await storage.completeMultipartUpload(
    asset.sourceKey,
    "course-assets",
    asset.uploadId ?? "",
    parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag ?? "" })),
    asset.sourceContentType,
  );

  await db
    .update(videoAssets)
    .set({ status: "queued", error: null })
    .where(eq(videoAssets.id, assetId));

  await db
    .update(lessons)
    .set({ videoStatus: "queued" })
    .where(eq(lessons.id, asset.lessonId));

  emitAnalyticsEvent({
    eventName: "video_uploaded",
    userId,
    courseId: asset.courseId,
    lessonId: asset.lessonId,
    payload: { filename: asset.sourceFilename, sizeBytes: asset.sourceSizeBytes },
  });

  await queueTranscodeForAsset(asset.id);

  return getUploadStatus(userId, userRole, assetId);
}

export async function getUploadStatus(
  userId: string,
  userRole: string,
  assetId: string,
): Promise<VideoAssetStatus> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const asset = await ownedAssetFor(userId, userRole, assetId);
  const [job] = await db
    .select({ state: transcodeJobs.state })
    .from(transcodeJobs)
    .where(eq(transcodeJobs.assetId, assetId))
    .orderBy(desc(transcodeJobs.createdAt))
    .limit(1);

  return {
    assetId: asset.id,
    status: (asset.status as VideoAssetStatus["status"]) ?? "failed",
    uploadedBytes: asset.uploadedBytes ?? 0,
    sourceSizeBytes: asset.sourceSizeBytes,
    durationSeconds: asset.durationSeconds,
    error: asset.error,
    jobState: (job?.state as VideoAssetStatus["jobState"]) ?? null,
    createdAt: asset.createdAt ? asset.createdAt.toISOString() : null,
    updatedAt: asset.updatedAt ? asset.updatedAt.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Captions + poster attachments (US-3.1.1, US-4.1.3)
// ─────────────────────────────────────────────────────────────

export async function attachCaptions(
  userId: string,
  userRole: string,
  lessonId: string,
  data: Buffer,
): Promise<{ captionsUrl: string }> {
  const { lesson, course } = await ownedLessonFor(userId, userRole, lessonId);
  const key = captionsKeyFor(course.id, lesson.id);
  const storage = getStorage();
  await storage.putObject(key, data, "text/vtt", "course-assets");
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(lessons).set({ captionsKey: key }).where(eq(lessons.id, lesson.id));
  return {
    captionsUrl: `${loadEnv().PUBLIC_API_URL}/api/v1/media/hls/${course.id}/${lesson.id}/captions.vtt`,
  };
}

export async function attachPoster(
  userId: string,
  userRole: string,
  lessonId: string,
  data: Buffer,
  contentType: string,
): Promise<{ posterUrl: string }> {
  const { lesson, course } = await ownedLessonFor(userId, userRole, lessonId);
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = posterKeyFor(course.id, lesson.id, ext);
  const storage = getStorage();
  await storage.putObject(key, data, contentType, "course-assets");
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(lessons).set({ videoPosterKey: key }).where(eq(lessons.id, lesson.id));
  return { posterUrl: await storage.signUrl(key, "course-assets", 7 * 24 * 3600) };
}

export { PART_SIZE_BYTES as videoPartsSize };
