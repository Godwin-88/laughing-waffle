"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { BuilderCourse } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { builderApi } from "@/lib/api";

/** US-4.1.1 — course builder workspace: structure, lessons, video, publish. */
export default function StudioCoursePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { user, loading } = useAuth();
  const [course, setCourse] = useState<BuilderCourse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    try {
      setCourse(await builderApi.get(slug));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not load course.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;
  if (!course && errorMsg) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4 text-center">
        <p className="text-sm text-red-600">{errorMsg}</p>
        <Link href="/studio" className="mt-4 inline-block text-sm font-semibold text-brand-600">
          ← Back to Studio
        </Link>
      </div>
    );
  }
  if (!course) return <div className="p-16 text-ink-500">Loading course…</div>;

  const publish = async () => {
    setPublishing(true);
    setErrorMsg(null);
    try {
      setCourse(await builderApi.publish(slug));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
      <nav className="flex items-center gap-2 text-sm text-ink-500">
        <Link href="/studio" className="hover:text-brand-700">← Studio</Link>
        <span className="text-ink-300">/</span>
        <span className="font-medium text-ink-700">{course.title}</span>
      </nav>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{course.title}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {course.modules.length} modules ·{" "}
            {course.modules.reduce((n, m) => n + m.lessons.length, 0)} lessons ·{" "}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                course.status === "published" ? "bg-green-100 text-green-700" : "bg-ink-100 text-ink-600"
              }`}
            >
              {course.status}
            </span>
          </p>
          {course.status !== "published" ? (
            <button
              onClick={() => void publish()}
              disabled={publishing}
              className="mt-3 rounded-xl bg-green-600 px-5 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-60"
            >
              {publishing ? "Publishing…" : "Publish course"}
            </button>
          ) : (
            <Link
              href={`/courses/${course.slug}`}
              className="mt-3 inline-block rounded-xl border border-ink-200 px-5 py-2 text-sm font-semibold text-ink-700 hover:border-brand-400"
            >
              View public page →
            </Link>
          )}
        </div>
        <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm">
          <p className="font-semibold text-ink-900">Public link</p>
          <p className="mt-0.5 break-all text-xs text-ink-500">/courses/{course.slug}</p>
        </div>
      </header>

      {errorMsg ? (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{errorMsg}</p>
      ) : null}

      <CourseBuilderModules course={course} setCourse={setCourse} setErrorMsg={setErrorMsg} />
    </div>
  );
function CourseBuilderModules({
  course,
  setCourse,
  setErrorMsg,
}: {
  course: BuilderCourse;
  setCourse: (c: BuilderCourse) => void;
  setErrorMsg: (s: string | null) => void;
}) {
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [addingLessonId, setAddingLessonId] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const addModule = async () => {
    if (!newModuleTitle.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      setCourse(await builderApi.addModule(course.slug, { title: newModuleTitle.trim() }));
      setNewModuleTitle("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not add module.");
    } finally {
      setBusy(false);
    }
  };

  const addLesson = async (moduleId: string | null) => {
    if (!lessonTitle.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      setCourse(
        await builderApi.addLesson(course.slug, {
          title: lessonTitle.trim(),
          kind: "text",
          moduleId,
          published: course.status === "published",
        }),
      );
      setLessonTitle("");
      setAddingLessonId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not add lesson.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <input
          value={newModuleTitle}
          onChange={(e) => setNewModuleTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addModule()}
          className="flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
          placeholder="New module title (e.g. Week 1 — Foundations)"
        />
        <button
          onClick={() => void addModule()}
          disabled={busy || !newModuleTitle.trim()}
          className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          + Module
        </button>
      </div>

      {course.modules.map((m) => (
        <details key={m.id} className="rounded-2xl border border-ink-200 bg-white" open>
          <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
            <span className="font-semibold text-ink-900">
              {m.position}. {m.title}
            </span>
            <span className="text-xs text-ink-500">
              {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
              {m.week ? ` · week ${m.week}` : ""}
            </span>
          </summary>
          <div className="border-t border-ink-200 p-4">
            {m.lessons.length === 0 ? (
              <p className="text-sm text-ink-400">No lessons yet.</p>
            ) : (
              <ul className="space-y-2">
                {m.lessons.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xs text-ink-400">#{l.position}</span>
                      <span className="truncate text-sm font-medium text-ink-800">{l.title}</span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">{l.kind}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.kind === "video" ? <VideoStatusBadge status={l.videoStatus} /> : null}
                      {l.published ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">live</span>
                      ) : (
                        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-500">draft</span>
                      )}
                      {l.kind === "video" ? (
                        <Link
                          href={`/studio/courses/${course.slug}/lessons/${l.id}/video`}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          {l.videoStatus === "ready" ? "Manage video" : "Upload video"}
                        </Link>
                      ) : (
                        <Link
                          href={`/studio/courses/${course.slug}/lessons/${l.id}`}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Edit
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
{addingLessonId === m.id ? (
              <div className="mt-3 flex gap-2">
                <input
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addLesson(m.id)}
                  className="flex-1 rounded-xl border border-brand-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                  placeholder="Lesson title…"
                  autoFocus
                />
                <button
                  onClick={() => void addLesson(m.id)}
                  disabled={busy || !lessonTitle.trim()}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => setAddingLessonId(null)}
                  className="rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setAddingLessonId(m.id)} className="mt-3 text-sm font-semibold text-brand-600 hover:text-brand-700">
                + Add lesson
              </button>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}

function VideoStatusBadge({ status }: { status: string }) {
  const color =
    status === "ready"
      ? "bg-green-100 text-green-700"
      : status === "failed"
        ? "bg-red-100 text-red-600"
        : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>{status}</span>;
}
}