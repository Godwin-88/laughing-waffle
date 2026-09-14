import { loadEnv } from "../config/env";

export type BucketName = "course-assets" | "user-uploads" | "public";

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

export interface StoredRange {
  data: Buffer;
  contentType: string;
  start: number;
  end: number;
  totalSize: number;
}

export interface MultipartUpload {
  uploadId: string;
}

export interface UploadPartResult {
  partNumber: number;
  etag: string;
}

/**
 * Blob storage abstraction. Sprint 1–2 ships a local-disk driver for
 * development and a Backblaze B2 (S3-compatible) driver matching the spec.
 * Driver selection: STORAGE_DRIVER=auto → b2 when B2_* credentials exist,
 * otherwise local. Override with STORAGE_DRIVER=b2|local.
 *
 * Sprint 3–4 additions: multipart upload sessions (US-4.1.2 — chunked video
 * upload up to 10 GB) and ranged reads (US-3.1.1 — HLS .ts segment serving).
 */
export interface StorageBackend {
  readonly name: string;
  putObject(key: string, data: Buffer, contentType: string, bucket: BucketName): Promise<void>;
  /** Time-limited URL (presigned for B2; API-served for local). */
  signUrl(key: string, bucket: BucketName, expiresInSeconds?: number): Promise<string>;
  readObject(key: string, bucket: BucketName): Promise<StoredObject | null>;
  readObjectRange(key: string, bucket: BucketName, start: number, end: number): Promise<StoredRange | null>;
  deleteObject(key: string, bucket: BucketName): Promise<void>;

  // ── multipart upload (US-4.1.2) ─────────────────────────────
  /** Start a multipart session. Local driver returns a scratch-marker id. */
  createMultipartUpload(key: string, bucket: BucketName, contentType: string): Promise<MultipartUpload>;
  /**
   * Presigned UploadPart URL for B2; the local driver returns null and the
   * caller PUTs the part body directly to the matching platform route.
   */
  presignUploadPart(
    key: string,
    bucket: BucketName,
    uploadId: string,
    partNumber: number,
  ): Promise<string | null>;
  /** Store a raw part body received by the platform route (local driver). */
  writePart(
    key: string,
    bucket: BucketName,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<void>;
  /** Assemble final object from parts (B2: CompleteMultipartUpload; local: concat). */
  completeMultipartUpload(
    key: string,
    bucket: BucketName,
    uploadId: string,
    parts: UploadPartResult[],
    contentType: string,
  ): Promise<void>;
  /** Abort a session and discard scratch/parts. */
  abortMultipartUpload(key: string, bucket: BucketName, uploadId: string): Promise<void>;
  /** Object size in bytes (0 when missing) — used for upload progress + range math. */
  objectSize(key: string, bucket: BucketName): Promise<number>;
}

let cachedBackend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (cachedBackend) return cachedBackend;
  const env = loadEnv();
  if (env.STORAGE_DRIVER === "b2") {
    cachedBackend = createB2Storage(env);
  } else {
    cachedBackend = createLocalStorage(env);
  }
  return cachedBackend;
}

export function avatarKeyFor(userId: string, ext: string): string {
  return `avatars/${userId}.${ext}`;
}

// ── Sprint 3–4 key helpers ───────────────────────────────────
export function videoSourceKey(courseId: string, lessonId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `videos/${courseId}/${lessonId}/source-${Date.now()}-${safe}`;
}

export function hlsPrefixFor(courseId: string, lessonId: string): string {
  return `transcoded/${courseId}/${lessonId}`;
}

export function captionsKeyFor(courseId: string, lessonId: string): string {
  return `captions/${courseId}/${lessonId}/captions.vtt`;
}

export function posterKeyFor(courseId: string, lessonId: string, ext: string): string {
  const safeExt = ext.startsWith(".") ? ext : `.${ext}`;
  return `posters/${courseId}/${lessonId}/poster${safeExt}`;
}

export function mediaContentType(fileKey: string): string {
  const ext = fileKey.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "m3u8":
      return "application/vnd.apple.mpegurl";
    case "ts":
      return "video/mp2t";
    case "vtt":
      return "text/vtt; charset=utf-8";
    case "webvtt":
      return "text/vtt; charset=utf-8";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "aac":
      return "audio/aac";
    case "m4a":
      return "audio/mp4";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

import { createB2Storage } from "./b2";
import { createLocalStorage } from "./local";