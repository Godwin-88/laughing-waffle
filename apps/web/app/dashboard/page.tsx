"use client";

import { useEffect, useState } from "react";
import type { CourseSummary, EnrolmentSummary } from "@takwimu/shared";
import { catalogueApi, enrolmentApi, formatPrice, profileApi, skillLabel, subscribeToProgress } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [recommended, setRecommended] = useState<CourseSummary[]>([]);
  const [enrolments, setEnrolments] = useState<EnrolmentSummary[]>([]);
  const [bio, setBio] = useState("");
  const [bioSaved, setBioSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setBio(user.bio ?? "");
    void catalogueApi.list({ sort: "rating", pageSize: 3 }).then((res) => setRecommended(res.items)).catch(() => {});
    void enrolmentApi.mine().then(setEnrolments).catch(() => {});

    // US-5.1.1 — real-time progress bar updates: when a completion event arrives
    // for one of my courses, refresh the enrolment list so progress bars move
    // without a page reload.
    const close = subscribeToProgress((message) => {
      if (message.event !== "lesson-completed") return;
      void enrolmentApi.mine().then(setEnrolments).catch(() => {});
    });
    return close;
  }, [user]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;

  const pct = user.profileCompleteness ?? 0;

  async function saveBio() {
    setSaving(true);
    setBioSaved(false);
    try {
      await profileApi.updateBio(bio);
      setBioSaved(true);
    } catch {
      setBioSaved(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Hello, {user.firstName} 👋</h1>
          <p className="mt-1 text-sm text-ink-500">
            {user.email} · {user.emailVerified ? "email verified" : "email not verified yet"}
            {user.wizardStep < 3 ? " · profile incomplete" : ""}
          </p>
        </div>
        {user.wizardStep < 3 ? (
          <a href="/onboarding" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
            Finish profile setup →
          </a>
        ) : null}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-ink-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-500">Your profile</h2>
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-600">Profile completeness</span>
              <span className="text-sm font-bold text-brand-700">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-500">Name</dt>
            <dd className="font-medium text-ink-800">{user.firstName} {user.lastName}</dd>
            <dt className="text-ink-500">Level</dt>
            <dd className="font-medium text-ink-800">{user.experienceLevel ? skillLabel(user.experienceLevel) : "—"}</dd>
            <dt className="text-ink-500">Interests</dt>
            <dd className="truncate font-medium text-ink-800" title={user.interests.join(", ")}>
              {user.interests.length > 0 ? user.interests.join(", ") : "—"}
            </dd>
          </dl>
        </section>
<section className="rounded-2xl border border-ink-200 bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-500">About you</h2>
          <textarea
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setBioSaved(false);
            }}
            maxLength={500}
            rows={4}
            placeholder="A short bio for your instructor and classmates…"
            className="mt-3 w-full rounded-xl border border-ink-200 bg-white p-3 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={() => void saveBio()}
            disabled={saving}
            className="mt-2 rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save bio"}
          </button>
          {bioSaved ? <span className="ml-2 text-sm text-green-600">✓ Saved</span> : null}
          <p className="mt-4 text-xs text-ink-400">Bio and interests power personalised course recommendations.</p>
        </section>
      </div>

      {enrolments.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink-900">My Learning</h2>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {enrolments.map((e) => (
              <a
                key={e.courseId}
                href={`/courses/${e.courseSlug}/lessons/${e.lastLessonPosition ?? e.firstLessonPosition ?? 1}`}
                className="rounded-2xl border border-ink-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{skillLabel(e.courseCategory)}</span>
                  <span className="text-sm font-bold text-brand-700">{e.progressPercent}%</span>
                </div>
                <h3 className="mt-2.5 font-bold leading-snug text-ink-900">{e.courseTitle}</h3>
                <p className="mt-1.5 text-xs text-ink-400">{e.instructor}</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${e.progressPercent}%` }} />
                </div>
                <p className="mt-2 text-xs font-semibold text-brand-600">
                  {e.progressPercent > 0 && e.progressPercent < 100 ? "Continue learning →" : e.progressPercent >= 100 ? "Completed ✓" : "Start learning →"}
                </p>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink-900">Recommended for you</h2>
          <a href="/courses" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Browse all courses →
          </a>
        </div>
        {recommended.length > 0 ? (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {recommended.map((c) => (
              <a key={c.id} href={`/courses/${c.slug}`} className="rounded-2xl border border-ink-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{skillLabel(c.skillLevel)}</span>
                  <span className="text-sm font-bold text-brand-700">{formatPrice(c.priceCents, c.currency)}</span>
                </div>
                <h3 className="mt-2.5 font-bold leading-snug text-ink-900">{c.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-sm text-ink-500">{c.tagline}</p>
                <p className="mt-2 text-xs text-ink-400">{c.durationWeeks} weeks · {c.instructor}</p>
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-8 text-center">
            <p className="text-sm text-ink-600">Complete your profile to unlock personalised recommendations.</p>
            <a href="/onboarding" className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
              Finish setup →
            </a>
          </div>
        )}
      </section>
    </div>
  );
}