import { getDb } from "../db/client";
import { analyticsEvents } from "../db/schema";
import { loadEnv } from "../config/env";

export interface AnalyticsEventInput {
  eventName: string;
  userId?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Fire-and-forget analytics event sink (US-2.2.1 «course_enrolled»,
 * US-3.1.1 «lesson_viewed», US-4.1.2 «video_transcoded» → Epic 9 pipeline).
 * Never throws — analytics must not break the request path.
 */
export function emitAnalyticsEvent(input: AnalyticsEventInput) {
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