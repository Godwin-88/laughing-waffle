import { desc, eq } from "drizzle-orm";
import type { ConfigRevisionsResponse, PlatformConfig } from "@takwimu/shared";
import { loadEnv } from "../config/env";
import { getDb } from "../db/client";
import { configRevisions, systemConfig, users } from "../db/schema";
import { badRequest, notFound } from "./errors";
import { getRedis } from "./redis";

/**
 * Platform configuration (US-7.1.2) — admin-editable without a deploy.
 *
 * Storage: a single row in `system_config` holding the merged JSON object;
 * each change appends a full snapshot to `config_revisions` (admin UI lists
 * the last 10 and rolls back). Propagation: Redis-backed cache
 * (`takwimu:platform-config`, 60s TTL) with an in-memory-process fallback of
 * the same 60s — both satisfy the "changes take effect within 60 seconds"
 * acceptance criterion.
 */

const CACHE_TTL_MS = 60_000;
const REDIS_KEY = "takwimu:platform-config";
const CONFIG_ROW_KEY = "platform";

export function defaultConfig(): PlatformConfig {
  return {
    platform: {
      name: "Takwimu Data School",
      logoKey: null,
      primaryColor: "#4f46e5",
      defaultLanguage: "en",
      timezone: "UTC",
    },
    email: {
      fromName: "Takwimu Data School",
      fromAddress: "no-reply@takwimu.school",
    },
    maintenance: {
      enabled: false,
      message: "We're carrying out scheduled maintenance. Please check back shortly.",
    },
    payments: {
      enabledGateways: ["stripe", "mpesa", "paypal"],
    },
    features: {
      discussions: true,
      certificates: true,
      offlineDownload: true,
    },
  };
}

let memoryCache: { value: PlatformConfig; fetchedAt: number } | null = null;

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

function deepMerge<T extends object>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = (base as Record<string, unknown>)[key] ?? {};
    if (value === null || value === undefined) {
      delete out[key];
    } else if (typeof value === "object" && !Array.isArray(value) && typeof current === "object" && current !== null) {
      out[key] = deepMerge(current as object, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** Sanitise an arbitrary patch against the PlatformConfig shape (drop unknowns). */
function sanitizePatch(patch: Record<string, unknown>): Partial<PlatformConfig> {
  const allowedTop = new Set(["platform", "email", "maintenance", "payments", "features"]);
  const result: Record<string, unknown> = {};
  for (const [top, value] of Object.entries(patch)) {
    if (!allowedTop.has(top) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    result[top] = value;
  }
  return result as Partial<PlatformConfig>;
}

async function loadFromDb(): Promise<PlatformConfig> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(systemConfig).where(eq(systemConfig.key, CONFIG_ROW_KEY)).limit(1);
  const stored = rows[0]?.value as Partial<PlatformConfig> | undefined;
  return deepMerge(defaultConfig(), stored ?? {});
}

/**
 * Current config. Reads: in-memory cache (60s) → Redis cache (60s) → DB.
 * Writes the loaded value back to Redis so multi-instance deployments share
 * the cache and pick up admin changes within the TTL window.
 */
export async function getConfig(): Promise<PlatformConfig> {
  if (memoryCache && isFresh(memoryCache.fetchedAt)) return memoryCache.value;

  const redis = getRedis();
  let value: PlatformConfig | null = null;
  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      if (raw) value = JSON.parse(raw) as PlatformConfig;
    } catch {
      /* redis read failed → DB */
    }
  }

  if (!value) {
    value = await loadFromDb();
    if (redis) {
      try {
        await redis.set(REDIS_KEY, JSON.stringify(value), "EX", CACHE_TTL_MS / 1000);
      } catch {
        /* noop */
      }
    }
  }

  memoryCache = { value, fetchedAt: Date.now() };
  return value;
}

export async function getCachedMaintenanceState(): Promise<{ enabled: boolean; message: string }> {
  const cfg = await getConfig();
  return { enabled: cfg.maintenance.enabled, message: cfg.maintenance.message };
}

/** Apply a validated partial patch and snapshot a revision (US-7.1.2). */
export async function updateConfig(
  actorId: string,
  patch: unknown,
): Promise<{ config: PlatformConfig; revisionId: string }> {
  const current = await getConfig();
  const next = deepMerge(current, sanitizePatch((patch ?? {}) as Record<string, unknown>));

  // Validate scalars so bad input never reaches the store.
  const platformName = next.platform.name.trim();
  if (!platformName) throw badRequest("Platform name cannot be empty.", { name: "required" });
  if (!/^#[0-9a-fA-F]{6}$/.test(next.platform.primaryColor)) {
    throw badRequest("Primary colour must be a hex colour like #4f46e5.", { primaryColor: "invalid" });
  }
  if (!next.email.fromAddress || !next.email.fromName) {
    throw badRequest("Email sender name and address are required.", { email: "required" });
  }
  const validGateways = new Set<string>(["stripe", "mpesa", "paypal"]);
  for (const g of next.payments.enabledGateways) {
    if (!validGateways.has(g)) throw badRequest(`Unknown payment gateway: ${g}`, { gateways: "invalid" });
  }

  const { db } = getDb(loadEnv().DATABASE_URL);
  const [revision] = await db
    .insert(configRevisions)
    .values({
      snapshot: current as unknown as Record<string, unknown>,
      actorId,
    })
    .returning();

  await persist(next, actorId);
  return { config: next, revisionId: revision.id };
}

export async function listConfigRevisions(limit = 10): Promise<ConfigRevisionsResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      id: configRevisions.id,
      snapshot: configRevisions.snapshot,
      appliedAt: configRevisions.appliedAt,
      actorId: configRevisions.actorId,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
    })
    .from(configRevisions)
    .leftJoin(users, eq(configRevisions.actorId, users.id))
    .orderBy(desc(configRevisions.appliedAt))
    .limit(Math.max(1, Math.min(100, limit)));
  return {
    items: rows.map((r) => ({
      id: r.id,
      snapshot: (r.snapshot ?? defaultConfig()) as unknown as PlatformConfig,
      actorName: r.actorId && r.actorFirstName ? `${r.actorFirstName} ${r.actorLastName ?? ""}`.trim() : null,
      appliedAt: r.appliedAt.toISOString(),
    })),
  };
}

/** Restore a stored revision as the active config (US-7.1.2 "rollback"). */
export async function rollbackConfigRevision(
  actorId: string,
  revisionId: string,
): Promise<{ config: PlatformConfig; revisionId: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(configRevisions).where(eq(configRevisions.id, revisionId)).limit(1);
  const revision = rows[0];
  if (!revision) throw notFound("Configuration revision not found.");

  const current = await getConfig();
  const next = deepMerge(defaultConfig(), revision.snapshot as unknown as Record<string, unknown>);

  const [newRevision] = await db
    .insert(configRevisions)
    .values({
      snapshot: current as unknown as Record<string, unknown>,
      actorId,
    })
    .returning();

  await persist(next, actorId);
  return { config: next, revisionId: newRevision.id };
}
export function resetConfigCacheForTests(): void {
  memoryCache = null;
  void getRedis()?.del(REDIS_KEY).catch(() => {});
}

async function persist(config: PlatformConfig, actorId: string | null): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .insert(systemConfig)
    .values({ key: CONFIG_ROW_KEY, value: config as unknown as Record<string, unknown>, updatedBy: actorId })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: config as unknown as Record<string, unknown>, updatedBy: actorId, updatedAt: new Date() },
    });
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(config), "EX", CACHE_TTL_MS / 1000);
    } catch {
      /* noop */
    }
  }
  memoryCache = { value: config, fetchedAt: Date.now() };
}