import { loadEnv } from "../config/env";

export type BucketName = "course-assets" | "user-uploads" | "public";

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

/**
 * Blob storage abstraction. Sprint 1–2 ships a local-disk driver for
 * development and a Backblaze B2 (S3-compatible) driver matching the spec.
 * Driver selection: STORAGE_DRIVER=auto → b2 when B2_* credentials exist,
 * otherwise local. Override with STORAGE_DRIVER=b2|local.
 */
export interface StorageBackend {
  readonly name: string;
  putObject(key: string, data: Buffer, contentType: string, bucket: BucketName): Promise<void>;
  /** Time-limited URL (presigned for B2; API-served for local). */
  signUrl(key: string, bucket: BucketName, expiresInSeconds?: number): Promise<string>;
  readObject(key: string, bucket: BucketName): Promise<StoredObject | null>;
  deleteObject(key: string, bucket: BucketName): Promise<void>;
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

import { createB2Storage } from "./b2";
import { createLocalStorage } from "./local";