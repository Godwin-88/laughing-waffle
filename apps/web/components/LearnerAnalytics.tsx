"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LearnerAnalytics, HeatmapDay } from "@takwimu/shared";
import { analyticsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * US-9.1.1 — learner analytics: KPI strip, 90-day activity heatmap,
 * in-progress courses, and analytics-driven recommendations.
 */
export function LearnerAnalytics() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<LearnerAnalytics | null>(null);

  const refresh = useCallback(() => {
    void analyticsApi
      .dashboard()
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    refresh();
  }, [loading, user, refresh]);

  if (!data) {
    return (
      <section className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
        <p className="text-sm text-ink-400">Analytics loading…</p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-ink-900">Your analytics</h2>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
          🔥 {data.kpis.activeStreakDays}-day streak
        </span>
      </header>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Courses enrolled" value={String(data.kpis.coursesEnrolled)} hint="Active + completed" />
        <Kpi label="Completed" value={String(data.kpis.coursesCompleted)} hint="Certificate-ready courses" />
        <Kpi label="Hours this week" value={String(data.kpis.hoursLearnedWeek)} hint={`${data.kpis.hoursLearnedTotal} total`} />
        <Kpi label="Certificates" value={String(data.kpis.certificatesEarned)} hint="Earned so far" />
      </div>

      {data.heatmap.length > 0 ? <Heatmap days={data.heatmap} /> : null}

      {data.inProgress.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-ink-500">In progress</h3>
          <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.inProgress.map((c) => (
              <Link
                key={c.courseId}
                href={`/courses/${c.courseSlug}/lessons/${c.nextLessonPosition ?? c.firstLessonPosition ?? 1}`}
                className="rounded-2xl border border-ink-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md"
              >
                <p className="text-sm font-bold text-brand-700">{c.progressPercent}%</p>
                <h4 className="mt-1.5 font-bold leading-snug text-ink-900">{c.courseTitle}</h4>
                <p className="mt-1 text-xs text-ink-400">{c.instructor}</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${c.progressPercent}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Kpi(props: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4">
      <p className="text-2xl font-black text-ink-900">{props.value}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-800">{props.label}</p>
      <p className="text-xs text-ink-500">{props.hint}</p>
    </div>
  );
}

/** Last-90-days contribution heatmap (GitHub style, y-axis = weekday). */
function Heatmap({ days }: { days: HeatmapDay[] }) {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const max = Math.max(1, ...days.map((d) => d.count));
  const weeks: Array<Array<{ date: string; count: number } | null>> = [];
  let week: Array<{ date: string; count: number } | null> = [];

  const start = new Date();
  start.setDate(start.getDate() - 90);
  const cursor = new Date(start);
  // Align the first column to Sunday
  while (cursor.getDay() !== 0) cursor.setDate(cursor.getDate() - 1);
  const end = new Date();
  while (cursor <= end) {
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    const key = cursor.toISOString().slice(0, 10);
    const count = byDate.get(key);
    week.push(count ? { date: key, count } : null);
    cursor.setDate(cursor.getDate() + 1);
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  const level = (count: number): string => {
    const r = Math.min(4, Math.floor((count / max) * 5));
    const shades = ["bg-ink-100", "bg-brand-50", "bg-brand-200", "bg-brand-400", "bg-brand-600"];
    return shades[r] ?? "bg-brand-600";
  };

  return (
    <div className="mt-6 overflow-x-auto">
      <h3 className="text-sm font-bold uppercase tracking-wider text-ink-500">Last 90 days of learning</h3>
      <div className="mt-3 flex gap-1.5">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {w.map((day) =>
              day ? (
                <div
                  key={day.date}
                  title={`${formatDate(day.date)} · ${day.count} activity event${day.count === 1 ? "" : "s"}`}
                  className={`h-3 w-3 rounded-[3px] ${level(day.count)}`}
                />
              ) : (
                <div key={`${wi}-empty`} className="h-3 w-3 rounded-[3px] bg-ink-50" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}