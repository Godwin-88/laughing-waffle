"use client";

import { useEffect } from "react";
import { analyticsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * US-9.1.1 — fires a learner-activity heartbeat when a lesson is opened
 * (or a discussion is viewed). Fire-and-forget; never blocks the page.
 */
export function ActivityHeartbeat(props: { kind: "lesson" | "video" | "quiz" | "discussion"; courseId?: string; lessonId?: string }) {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    void analyticsApi.heartbeat({ kind: props.kind, courseId: props.courseId, lessonId: props.lessonId, seconds: 0.033 });
  }, [user, props.courseId, props.lessonId, props.kind]);
  return null;
}