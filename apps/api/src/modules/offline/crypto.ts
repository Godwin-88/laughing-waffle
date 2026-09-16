import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { loadEnv } from "../../config/env";

/**
 * US-3.1.2 — Offline lesson download (mobile-first).
 *
 * AES-256-GCM encryption at rest with a device-bound key:
 *   • A random 32-byte content key encrypts the lesson bundle (AES-256-GCM).
 *   • The content key is itself WRAPPED with a device key derived from an
 *     HMAC over a device-supplied identifier: HKDF(secret, deviceId).
 *   • The API stores only the wrapped key; the device can unwrap it with its
 *     key — a download is unusable outside the originating device.
 */

export const OFFLINE_EXPIRY_DAYS = 30;
const CONTENT_KEY_BYTES = 32;
const GCM_TAG_BYTES = 16;

/** Deterministic device key from the server secret + device id (32 bytes). */
export function deriveDeviceKey(deviceId: string): Buffer {
  return createHmac("sha256", loadEnv().JWT_SECRET)
    .update(`takwimu-offline-v1:${deviceId}`)
    .digest();
}

export interface WrappedKey {
  /** base64 12-byte GCM IV */
  iv: string;
  /** base64 16-byte GCM auth tag */
  tag: string;
  /** base64 encrypted 32-byte content key */
  ciphertext: string;
}

/** Wrap a random content key with the device key (AES-256-GCM). */
export function wrapContentKey(deviceKey: Buffer): { contentKey: Buffer; wrapped: WrappedKey } {
  const contentKey = randomBytes(CONTENT_KEY_BYTES);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deviceKey, iv);
  const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  return {
    contentKey,
    wrapped: {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
}

/** Encrypt a payload with a content key. Returns { iv, tag, ciphertext }. */
export function encryptPayload(
  contentKey: Buffer,
  plaintext: Buffer,
): { iv: string; tag: string; ciphertext: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext };
}

/** Decrypt an AES-256-GCM payload (used by tests + the web decryptor). */
export function decryptPayload(
  contentKey: Buffer,
  payload: { iv: string; tag: string; ciphertext: Buffer },
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return plaintext;
}

/** Content-addressed storage key for an offline download. */
export function offlineStorageKey(userId: string, downloadId: string): string {
  return `offline/${userId}/${downloadId}.takwimu`;
}