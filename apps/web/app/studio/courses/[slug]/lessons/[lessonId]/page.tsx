"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { BuilderCourse } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { builderApi } from "@/lib/api";

/** US-4.1.1 — edit a text lesson, or flip it to a video lesson. */
export default function LessonEditPage() {
  const params = useParams<{ slug: string; lessonId: string }>();
  const { slug, lessonId } = params;
  const router = useRouter();
  const { user, loading } = useAuth();
  const [course, setCourse] = useState<BuilderCourse | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const c = await builderApi.get(slug);
        setCourse(c);
        const lesson = c.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId);
        if (lesson) {
          setTitle(lesson.title);
          setSummary(lesson.summary ?? "");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not load lesson.");
      }
    })();
  }, [slug, lessonId]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;
  if (!course) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4 text-center">
        {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : <p className="text-sm text-ink-500">Loading…</p>}
      </div>
    );
  }

  const lesson = course.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId);
  if (!lesson) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4 text-center">
        <p className="text-sm text-ink-500">Lesson not found.</p>
        <Link href={`/studio/courses/${slug}`} className="mt-3 inline-block text-sm font-semibold text-brand-600">
          ← Back to course
        </Link>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setSavedMsg(false);
    setErrorMsg(null);
    try {
      setCourse(
        await builderApi.updateLesson(lessonId, {
          title: title.trim() || lesson.title,
          summary,
          content,
        }),
      );
      setSavedMsg(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not save lesson.");
    } finally {
      setBusy(false);
    }
  };

  const makeVideo = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await builderApi.updateLesson(lessonId, { kind: "video", published: true });
      router.push(`/studio/courses/${slug}/lessons/${lessonId}/video`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not convert lesson.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-8 max-w-3xl px-4 sm:px-6">
      <nav className="text-sm text-ink-500">
        <Link href={`/studio/courses/${slug}`} className="hover:text-brand-700">← Back to course</Link>
        <span className="mx-2 text-ink-300">·</span>
        <span className="font-medium text-ink-700">{lesson.title}</span>
      </nav>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Summary</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink-800">Content (Markdown)</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            className="mt-1 w-full rounded-xl border border-ink-200 bg-white p-3 font-mono text-sm outline-none focus:border-brand-500"
            placeholder={lesson.kind === "video" ? "Lesson notes go here (shown below the video)." : "# Lesson content…"}
          />
        </label>

        {errorMsg ? <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{errorMsg}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => void save()} disabled={busy} className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
          {savedMsg ? <span className="text-sm text-green-600">✓ Saved</span> : null}
          {lesson.kind !== "video" ? (
            <button onClick={() => void makeVideo()} disabled={busy} className="rounded-xl border border-brand-300 bg-brand-50 px-5 py-2.5 text-sm font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-50">
              Convert to video lesson →
            </button>
          ) : (
            <Link href={`/studio/courses/${slug}/lessons/${lessonId}/video`} className="rounded-xl border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-700 hover:border-brand-400">
              Manage video
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}