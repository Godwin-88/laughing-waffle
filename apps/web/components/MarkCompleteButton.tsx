"use client";

import { useState } from "react";
import type { LessonPublic } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { progressApi } from "@/lib/api";

/** US-3.1.1 — text-lesson completion control (videos auto-complete). */
export function MarkCompleteButton({ lesson, courseSlug }: { lesson: LessonPublic; courseSlug: string }) {
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!user) return null;

  const onComplete = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await progressApi.complete(courseSlug, lesson.id);
      setDone(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not mark complete.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-xl bg-green-100 px-4 py-2.5 text-sm font-semibold text-green-700">
        ✓ Completed
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onComplete}
        disabled={busy}
        className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Mark as complete"}
      </button>
      {errorMsg ? <span className="text-xs text-red-600">{errorMsg}</span> : null}
    </div>
  );
}