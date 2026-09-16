import { getRedis } from "./redis";

/**
 * Per-client hourly rate limiter for the OAuth-protected public API
 * (US-8.1.1 — "1,000 requests/hour per API key; 429 with Retry-After").
 *
 * Transport: Redis INCR with a per-hour bucket key when Redis is available;
 * falls back to an in-process sliding bucket so the contract holds even in
 * single-instance development without Redis.
 */

const HOUR_MS = 3_600_000;

interface Bucket {
  /** yyyy-mm-dd-hh bucket label. */
  key: string;
  count: number;
}

const memory = new Map<string, Bucket>();

function hourBucketKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}`;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the quota window resets (drives `Retry-After`). */
  retryAfterSeconds: number;
}

/** Exportable for tests: resets in-process counters. */
export function resetRateLimiterForTests(): void {
  memory.clear();
}

export async function checkClientRateLimit(
  clientId: string,
  limitPerHour: number,
): Promise<RateLimitDecision> {
  const now = new Date();
  const bucket = hourBucketKey(now);
  const resetMs = HOUR_MS - ((now.getTime() % HOUR_MS));
  const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));

  const redis = getRedis();
  if (redis) {
    try {
      const rkey = `rl:oauth:${clientId}:${bucket}`;
      const count = await redis.incr(rkey);
      if (count === 1) await redis.expire(rkey, 3700); // slightly over 1 hour
      const remaining = Math.max(0, limitPerHour - count);
      return {
        allowed: count <= limitPerHour,
        remaining,
        retryAfterSeconds,
      };
    } catch {
      /* fall through to in-process bucket */
    }
  }

  const entry = memory.get(clientId);
  if (!entry || entry.key !== bucket) {
    memory.set(clientId, { key: bucket, count: 1 });
    return { allowed: true, remaining: limitPerHour - 1, retryAfterSeconds };
  }
  const next = { key: entry.key, count: entry.count + 1 };
  memory.set(clientId, next);
  return {
    allowed: next.count <= limitPerHour,
    remaining: Math.max(0, limitPerHour - next.count),
    retryAfterSeconds,
  };
}