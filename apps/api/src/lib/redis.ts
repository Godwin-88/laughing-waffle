import Redis from "ioredis";
import { loadEnv } from "../config/env";

/**
 * Optional Redis client (docker-compose redis:7). Used by the config cache
 * (US-7.1.2 "Redis-backed config cache") and available as the transport for
 * the progress-event bus. Fallback behaviour: when REDIS_URL is unset, or the
 * first connection attempt fails, callers get null and use process-local state
 * (the config service still satisfies the 60s propagation window in-memory).
 */
let client: Redis | null = null;
let unavailableUntil = 0;

export function getRedis(): Redis | null {
  if (unavailableUntil > Date.now()) return null;
  if (client) return client;
  const url = loadEnv().REDIS_URL;
  if (!url) return null;
  try {
    const candidate = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    candidate.on("error", (err) => {
      console.warn(`[redis] unavailable (${err?.message ?? "unknown"}) — config cache falls back to in-memory/DB`);
      unavailableUntil = Date.now() + 30_000;
      try {
        client?.disconnect();
      } catch {
        /* noop */
      }
      client = null;
    });
    candidate.on("connect", () => {
      unavailableUntil = 0;
    });
    client = candidate;
  } catch {
    return null;
  }
  return client;
}

export function closeRedis(): void {
  try {
    client?.disconnect();
  } catch {
    /* noop */
  }
  client = null;
}