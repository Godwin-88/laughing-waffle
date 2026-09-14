"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CourseDetail } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { enrolmentApi, formatPrice } from "@/lib/api";

/**
 * US-2.2.1 — card-level enrolment control. Guests see the price + CTA to sign
 * in; authenticated users enrol in one click and are redirected to the first
 * lesson of the course.
 */
export function EnrollCard({ course }: { course: CourseDetail }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    enrolmentApi
      .context(course.slug)
      .then((ctx) => {
        if (cancelled) return;
        setEnrolled(ctx.enrolled);
        setPercent(ctx.progressPercent);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, course.slug]);

  const onEnrol = async () => {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/courses/${course.slug}`)}`);
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await enrolmentApi.enrol(course.slug);
      setEnrolled(true);
      setSaved(true);
      setBusy(false);
      if (res.redirect) {
        router.push(`/courses/${course.slug}/lessons/${res.redirect.lessonPosition}`);
      }
    } catch (err) {
      setBusy(false);
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  if (enrolled) {
    return (
      <aside className="h-fit rounded-2xl border border-ink-200 bg-white p-5">
        <p className="flex items-center gap-2 text-3xl font-extrabold text-brand-700">
          <span className="text-lg">✓</span> {formatPrice(course.priceCents)}
        </p>
        <p className="mt-1 text-sm text-ink-500">You are enrolled in this course.</p>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-600">
            <span>Progress</span>
            <span>{percent}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <Link
          href={`/courses/${course.slug}/lessons/1`}
          className="mt-4 block w-full rounded-xl bg-brand-600 py-3 text-center text-sm font-bold text-white hover:bg-brand-700"
        >
          {percent > 0 && percent < 100 ? "Continue learning" : "Start learning"}
        </Link>
        {course.certificationLabel ? (
          <p className="mt-2 text-center text-xs text-ink-500">🏅 {course.certificationLabel} included</p>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="h-fit rounded-2xl border border-ink-200 bg-white p-5">
      <p className="text-3xl font-extrabold text-brand-700">{formatPrice(course.priceCents)}</p>
      <p className="mt-1 text-sm text-ink-500">
        {course.priceCents === 0 ? "Free enrolment · certificates included" : "One-time payment · certificate included"}
      </p>
      <button
        onClick={onEnrol}
        disabled={busy}
        className="mt-4 block w-full rounded-xl bg-brand-600 py-3 text-center text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? "Checking account…" : busy ? "Enrolling…" : saved ? "Enrolled ✓" : user ? "Enrol for free" : "Sign in to enrol"}
      </button>
      {errorMsg ? <p className="mt-2 text-xs text-red-600">{errorMsg}</p> : null}
      <p className="mt-2 flex items-center gap-1 text-xs text-ink-500">
        <span className="text-accent-500">★</span> {course.rating.toFixed(1)} · {course.ratingCount} reviews
      </p>
    </aside>
  );
}