import { getDb } from "../db/client";
import { auditLogs } from "../db/schema";
import { loadEnv } from "../config/env";

/**
 * Append-only audit log (US-7.1.1 "Audit log entry created for every admin
 * action"). Writes are fire-and-forget-safe: a failed audit row must never
 * block the admin action it documents.
 */
export interface AuditInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { db } = getDb(loadEnv().DATABASE_URL);
    await db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      details: input.details ?? {},
    });
  } catch (err) {
    console.warn(`[audit] failed to record ${input.action}:`, (err as Error)?.message ?? err);
  }
}