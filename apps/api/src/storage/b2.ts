import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env";
import type {
  BucketName,
  MultipartUpload,
  StorageBackend,
  StoredObject,
  StoredRange,
  UploadPartResult,
} from "./storage";

/**
 * Backblaze B2 storage driver — S3-compatible, ~75% cheaper than S3,
 * presigned-URL access for private assets (spec: Blob Storage Decision).
 *
 * Buckets: lms-course-assets (videos/PDFs/SCORM) · lms-user-uploads
 * (assignments/avatars) · lms-public (marketing images). Private buckets
 * are always served through time-limited presigned URLs; HLS streams are
 * proxied by the platform media route so the player stays same-origin.
 */
export function createB2Storage(env: Env): StorageBackend {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY) {
    throw new Error("B2 storage selected but B2_KEY_ID / B2_APP_KEY are not set");
  }

  const client = new S3Client({
    endpoint: env.B2_ENDPOINT ?? "https://s3.us-west-000.backblazeb2.com",
    region: "us-west-000",
    credentials: {
      accessKeyId: env.B2_KEY_ID,
      secretAccessKey: env.B2_APP_KEY,
    },
  });

  const buckets: Record<BucketName, string> = {
    "course-assets": env.B2_BUCKET_COURSE_ASSETS,
    "user-uploads": env.B2_BUCKET_USER_UPLOADS,
    public: env.B2_BUCKET_PUBLIC,
  };

  return {
    name: "b2",
    async putObject(key, data, contentType, bucket) {
      await client.send(
        new PutObjectCommand({
          Bucket: buckets[bucket],
          Key: key,
          Body: data,
          ContentType: contentType,
        }),
      );
    },
    async signUrl(key, bucket, expiresInSeconds = 3600) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: buckets[bucket], Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },
    async readObject(key, bucket): Promise<StoredObject | null> {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: buckets[bucket], Key: key }),
        );
        if (!res.Body) return null;
        const data = await res.Body.transformToByteArray();
        return { data: Buffer.from(data), contentType: res.ContentType ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async readObjectRange(key, bucket, start, end): Promise<StoredRange | null> {
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: buckets[bucket],
            Key: key,
            Range: `bytes=${start}-${end}`,
          }),
        );
        if (!res.Body) return null;
        const data = await res.Body.transformToByteArray();
        const header = res.ContentRange ?? `bytes ${start}-${end}/*`;
        const totalMatch = /(\d+)$/.exec(header);
        const contentRange = res.ContentRange;
        return {
          data: Buffer.from(data),
          contentType: res.ContentType ?? "application/octet-stream",
          start,
          end: start + data.length - 1,
          totalSize: totalMatch ? Number(totalMatch[1]) : start + data.length,
        };
      } catch {
        const size = await this.objectSize(key, bucket);
        if (size === 0) return null;
        return this.readObjectRange(key, bucket, start, Math.min(end, size - 1));
      }
    },
    async deleteObject(key, bucket) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: buckets[bucket], Key: key }));
      } catch {
        /* noop */
      }
    },

    // ── multipart (US-4.1.2) ─────────────────────────────────
    async createMultipartUpload(key, bucket, contentType): Promise<MultipartUpload> {
      const res = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: buckets[bucket],
          Key: key,
          ContentType: contentType,
        }),
      );
      return { uploadId: res.UploadId ?? "" };
    },
    async presignUploadPart(key, bucket, uploadId, partNumber): Promise<string> {
      return getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: buckets[bucket],
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 60 * 60 },
      );
    },
    async writePart(_key, _bucket, _uploadId, _partNumber) {
      // B2 parts are PUT by the browser directly to presigned URLs.
      throw new Error("writePart is local-driver only");
    },
    async completeMultipartUpload(key, bucket, uploadId, parts, _contentType) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: buckets[bucket],
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },
    async abortMultipartUpload(key, bucket, uploadId) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({ Bucket: buckets[bucket], Key: key, UploadId: uploadId }),
        );
      } catch {
        /* noop */
      }
    },
    async objectSize(key, bucket): Promise<number> {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: buckets[bucket], Key: key }));
        return res.ContentLength ?? 0;
      } catch {
        return 0;
      }
    },
  };
}