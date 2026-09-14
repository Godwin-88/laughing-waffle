"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonPublic } from "@takwimu/shared";
import { progressApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const TIME_THRESHOLD_MS = 60_000; // 60 s on page (US-5.1.1)
const SCROLL_MARGIN_PX = 96; // "scrolled to bottom" tolerance

/**
 * US-5.1.1 — text lessons are marked complete automatically when the learner
 * either scrolls to the bottom of the article OR has been on the page for 60 s.
 * Fires once; guarded against double-submission and requires an authenticated
 * (enrolled) learner.
 */
export function TextLessonCompletion({ lesson, courseSlug }: { lesson: LessonPublic; courseSlug: string }) {
  const { user } = useAuth();
  const [completed, setCompleted] = useState(false);
  const firedRef = useRef(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (!user || firedRef.current) return;

    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      setCompleted(true);
      void progressApi.complete(courseSlug, lesson.id).catch(() => {
        // Allow re-attempt next visit; never block the page on this.
        firedRef.current = false;
      });
    };

    const checkScroll = () => {
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - SCROLL_MARGIN_PX;
      if (atBottom) fire();
    };
    checkScroll();

    const timer = setInterval(() => {
      if (Date.now() - mountedAt.current >= TIME_THRESHOLD_MS) fire();
    }, 5_000);

    window.addEventListener("scroll", checkScroll, { passive: true });
    return () => {
      clearInterval(timer);
      window.removeEventListener("scroll", checkScroll);
    };
  }, [user, courseSlug, lesson.id]);

  if (!user || !completed) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-xl bg-green-100 px-4 py-2.5 text-sm font-semibold text-green-700">
      ✓ Completed
    </span>
  );
}