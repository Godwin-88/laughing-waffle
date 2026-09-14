import type { ProgressEventMessage } from "@takwimu/shared";
import { loadEnv } from "../config/env";
import { getDb } from "../db/client";
import { analyticsEvents } from "../db/schema";

/**
 * In-process progress event bus backing the GET /me/progress/events SSE stream
 * (US-5.1.1 — real-time progress bar updates). A Redis pub/sub transport can be
 * swapped in for multi-instance deployments without changing call sites.
 */

type Listener = (message: ProgressEventMessage) => void;

const listeners = new Map<string, Set<Listener>>();

export function onProgressEvent(userId: string, listener: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(userId);
  };
}

export function publishProgressEvent(userId: string, message: ProgressEventMessage): void {
  const set = listeners.get(userId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(message);
    } catch (err) {
      console.warn("[progress-events] listener failed:", err);
    }
  }
}

/**
 * Fire-and-forget analytics event sink (complements lib/events.ts emitAnalyticsEvent;
 * used by callers that already publish via the progress bus).
 */
export function recordAnalyticsEvent(input: {
  eventName: string;
  userId?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  void db
    .insert(analyticsEvents)
    .values({
      eventName: input.eventName,
      userId: input.userId ?? null,
      courseId: input.courseId ?? null,
      lessonId: input.lessonId ?? null,
      payload: input.payload ?? {},
    })
    .catch((err) => {
      console.warn(`[analytics] failed to record ${input.eventName}:`, err?.message ?? err);
    });
}