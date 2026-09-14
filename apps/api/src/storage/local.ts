import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../config/env";
import type { BucketName, StorageBackend, StoredObject } from "./storage";

const API_SRC_DIR = path.dirname(fileURLToPath(import.meta.url)); // …/apps/api/src/storage

/**
 * Local-disk driver for development (no cloud credentials required).
 * Files live under <repo-root>/data/storage/<bucket>/<key>.
 * signUrl returns an API-served URL (the /api/v1/files route streams it).
 */
export function createLocalStorage(env: Env): StorageBackend {
  const rootDir = path.resolve(API_SRC_DIR, "../../../../data/storage");

  function bucketDir(bucket: BucketName): string {
    return path.join(rootDir, bucket);
  }

  return {
    name: "local",
    async putObject(key, data, _contentType, bucket) {
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
        const ext = path.extname(key).toLowerCase();
        const contentType =
          ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
        return { data, contentType };
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
  };
}