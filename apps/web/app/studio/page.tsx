"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BuilderCourseListEntry } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { builderApi } from "@/lib/api";

const SKILL_OPTIONS: Array<{ value: "beginner" | "intermediate" | "advanced"; label: string }> = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

/** US-4.1.1 — instructor course workspace: list + create. */
export default function StudioPage() {
  const { user, loading } = useAuth();
  const [courses, setCourses] = useState<BuilderCourseListEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [category, setCategory] = useState("ai-engineering");
  const [skillLevel, setSkillLevel] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void builderApi.list().then(setCourses).catch(() => {});
  }, [user]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;
  if (!["instructor", "admin"].includes(user.role)) {
    return (
      <div className="mx-auto mt-16 max-w-xl px-4 text-center">
        <h1 className="text-2xl font-extrabold text-ink-900">Instructor access required</h1>
        <p className="mt-2 text-sm text-ink-500">
          Only instructors can build courses. Contact Takwimu Data School to request the instructor role.
        </p>
      </div>
    );
  }

  const create = async () => {
    if (!title.trim()) {
      setErrMsg("Add a course title.");
      return;
    }
    setBusy(true);
    setErrMsg(null);
    try {
      const created = await builderApi.create({
        title: title.trim(),
        tagline: tagline.trim(),
        category,
        skillLevel,
        durationWeeks,
        priceCents: Math.round(price * 100),
      });
      setCourses((prev) => [created, ...prev]);
      setCreating(false);
      setTitle("");
      setTagline("");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Could not create course.");
    } finally {
      setBusy(false);
    }
return (
    <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Course Studio</h1>
          <p className="mt-1 text-sm text-ink-500">
            Build, structure and publish courses for Takwimu Data School learners.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
        >
          {creating ? "Cancel" : "+ New course"}
        </button>
      </header>

      {creating ? (
        <section className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-brand-700">New course</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                placeholder="e.g. AWS Certified AI Engineer"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Tagline</span>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
                placeholder="Short hook for the catalogue"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              >
                <option value="ai-engineering">AI Engineering</option>
                <option value="generative-ai">Generative AI</option>
                <option value="data-science">Data Science</option>
                <option value="cloud-computing">Cloud / AWS</option>
                <option value="python-programming">Python</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Skill level</span>
              <select
                value={skillLevel}
                onChange={(e) => setSkillLevel(e.target.value as typeof skillLevel)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              >
                {SKILL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Duration (weeks)</span>
              <input
                type="number"
                min={1}
                max={52}
                value={durationWeeks}
                onChange={(e) => setDurationWeeks(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink-700">Price (USD, 0 = free)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
          </div>
          {errMsg ? <p className="mt-3 text-sm text-red-600">{errMsg}</p> : null}
          <button
            onClick={() => void create()}
            disabled={busy}
            className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create course"}
          </button>
        </section>
      ) : null}
<section className="mt-8">
        <h2 className="text-lg font-bold text-ink-900">Your courses</h2>
        {courses.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-10 text-center">
            <p className="text-sm text-ink-600">You haven&apos;t created any courses yet.</p>
            <p className="mt-1 text-xs text-ink-400">Click “+ New course” to get started.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/studio/courses/${c.slug}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-5 transition hover:border-brand-400 hover:shadow-sm"
              >
                <div className="min-w-0">
                  <p className="font-bold text-ink-900">{c.title}</p>
                  <p className="mt-0.5 truncate text-sm text-ink-500">{c.tagline || "No tagline yet"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      c.status === "published" ? "bg-green-100 text-green-700" : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {c.status}
                  </span>
                  <span className="text-xs text-ink-500">
                    {c.moduleCount} modules · {c.publishedLessonCount}/{c.lessonCount} lessons
                  </span>
                  <span className="text-xs font-semibold text-brand-600">Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
  };