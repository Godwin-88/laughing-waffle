import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env";
import type { BucketName, StorageBackend, StoredObject } from "./storage";

/**
 * Backblaze B2 storage driver — S3-compatible, ~75% cheaper than S3,
 * presigned-URL access for private assets (spec: Blob Storage Decision).
 *
 * Buckets: lms-course-assets (videos/PDFs/SCORM) · lms-user-uploads
 * (assignments/avatars) · lms-public (marketing images). Private buckets
 * are always served through time-limited presigned URLs.
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
    async deleteObject(key, bucket) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: buckets[bucket], Key: key }));
      } catch {
        /* noop */
      }
    },
  };
}