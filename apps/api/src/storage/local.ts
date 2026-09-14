import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Env } from "../config/env";
import type {
  BucketName,
  MultipartUpload,
  StorageBackend,
  StoredObject,
  StoredRange,
  UploadPartResult,
} from "./storage";

const API_SRC_DIR = path.dirname(fileURLToPath(import.meta.url)); // …/apps/api/src/storage

/**
 * Local-disk driver for development (no cloud credentials required).
 * Files live under <repo-root>/data/storage/<bucket>/<key>.
 * signUrl returns an API-served URL (the /api/v1/files route streams it).
 * Multipart scratch parts live under <root>/multipart/<uploadId>/part-<n>.
 */
export function createLocalStorage(env: Env): StorageBackend {
  const rootDir = path.resolve(API_SRC_DIR, "../../../../data/storage");

  function bucketDir(bucket: BucketName): string {
    return path.join(rootDir, bucket);
  }

  function unsafe(key: string): boolean {
    return key === "" || key.includes("..") || key.startsWith("/");
  }

  return {
    name: "local",
    async putObject(key, data, _contentType, bucket) {
      if (unsafe(key)) throw new Error(`invalid object key: ${key}`);
      const target = path.join(bucketDir(bucket), key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    },
    async signUrl(key, bucket, expiresInSeconds = 60 * 60) {
      const expiry = Date.now() + expiresInSeconds * 1000;
      return `${env.PUBLIC_API_URL}/api/v1/files/${bucket}/${key}?e=${expiry}`;
    },
    async readObject(key, bucket): Promise<StoredObject | null> {
      try {
        const data = await fs.readFile(path.join(bucketDir(bucket), key));
        const contentType =
          key.toLowerCase().endsWith(".png")
            ? "image/png"
            : key.toLowerCase().endsWith(".webp")
              ? "image/webp"
              : key.toLowerCase().endsWith(".jpg") || key.toLowerCase().endsWith(".jpeg")
                ? "image/jpeg"
                : "application/octet-stream";
        return { data, contentType };
      } catch {
        return null;
      }
    },
    async readObjectRange(key, bucket, start, end): Promise<StoredRange | null> {
      const target = path.join(bucketDir(bucket), key);
      try {
        const stats = await fs.stat(target);
        const totalSize = stats.size;
        const from = Math.max(0, start);
        const to = Math.min(totalSize - 1, end);
        if (from > to || from >= totalSize) return null;
        const handle = await fs.open(target, "r");
        try {
          const buf = Buffer.alloc(to - from + 1);
          await handle.read(buf, 0, buf.length, from);
          const contentType =
            key.toLowerCase().endsWith(".m3u8")
              ? "application/vnd.apple.mpegurl"
              : key.toLowerCase().endsWith(".ts")
                ? "video/mp2t"
                : key.toLowerCase().endsWith(".vtt")
                  ? "text/vtt; charset=utf-8"
                  : "application/octet-stream";
          return { data: buf, contentType, start: from, end: to, totalSize };
        } finally {
          await handle.close();
        }
      } catch {
        return null;
      }
    },
    async deleteObject(key, bucket) {
      try {
        await fs.unlink(path.join(bucketDir(bucket), key));
      } catch {
        /* noop */
      }
    },

    // ── multipart (US-4.1.2) ─────────────────────────────────
    async createMultipartUpload(): Promise<MultipartUpload> {
      // Parts are addressed by uploadId in scratch — the target key is bound at
      // writePart/complete time via the object key param.
      return { uploadId: randomUUID() };
    },
    async presignUploadPart(): Promise<string | null> {
      return null; // local parts are PUT directly to the platform route
    },
    async writePart(key, bucket, uploadId, partNumber, data) {
      const scratch = path.join(rootDir, "multipart", uploadId);
      await fs.mkdir(scratch, { recursive: true });
      await fs.writeFile(path.join(scratch, `part-${String(partNumber).padStart(6, "0")}`), data);
      void key;
      void bucket;
    },
    async completeMultipartUpload(key, bucket, uploadId, parts, contentType) {
      const scratch = path.join(rootDir, "multipart", uploadId);
      const chunkCount = parts.length;
      const buffers: Buffer[] = [];
      for (let i = 1; i <= chunkCount; i++) {
        const partFile = path.join(scratch, `part-${String(i).padStart(6, "0")}`);
        buffers.push(await fs.readFile(partFile));
      }
      const assembled = Buffer.concat(buffers);
      const target = path.join(bucketDir(bucket), key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, assembled);
      await fs.rm(scratch, { recursive: true, force: true });
      void contentType;
    },
    async abortMultipartUpload(_key, _bucket, uploadId) {
      const scratch = path.join(rootDir, "multipart", uploadId);
      await fs.rm(scratch, { recursive: true, force: true });
    },
    async objectSize(key, bucket): Promise<number> {
      try {
        const stats = await fs.stat(path.join(bucketDir(bucket), key));
        return stats.size;
      } catch {
        return 0;
      }
    },
  };
}