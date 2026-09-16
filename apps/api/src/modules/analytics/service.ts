import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type {
  AnalyticsInProgressCourse,
  AnalyticsKpis,
  CourseSummary,
  HeatmapDay,
  LearnerAnalytics,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import {
  analyticsEvents,
  certificates,
  courses,
  enrolments,
  progress,
  users,
} from "../../db/schema";
import { emitAnalyticsEvent } from "../../lib/events";
import { catalogueRankedCourses } from "../catalogue/service";
import { courseProgressStats } from "../enrolments/service";

/**
 * US-9.1.1 — Learner analytics dashboard.
 * Source of truth: `analytics_events` (heartbeat rows carry `payload.seconds`),
 * `enrolments`, `lesson_progress`, `certificates`.
 */

// ── Streak computation ───────────────────────────────────────

async function distinctActivityDays(userId: string, lookbackDays: number): Promise<Set<string>> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await db
    .select({ day: sql`date_trunc('day', ${analyticsEvents.createdAt})::date` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.userId, userId), sql`${analyticsEvents.createdAt} >= ${since}`))
    .groupBy(sql`date_trunc('day', ${analyticsEvents.createdAt})::date`);
  const set = new Set<string>();
  for (const r of rows) {
    const d = r.day instanceof Date ? r.day : new Date(String(r.day));
    if (!Number.isNaN(d.getTime())) set.add(d.toISOString().slice(0, 10));
  }
  return set;
}

/** Consecutive-day streak ending today (or yesterday if today is idle) — GitHub-style. */
export async function computeActiveStreakDays(userId: string): Promise<number> {
  const days = await distinctActivityDays(userId, 400);
  if (days.size === 0) return 0;

  const anchor = new Date();
  if (!days.has(anchor.toISOString().slice(0, 10))) {
    anchor.setDate(anchor.getDate() - 1); // streak survives a single idle today
  }
  let streak = 0;
  let cursor = new Date(anchor);
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── Heartbeat (client → server) ──────────────────────────────

export async function recordActivityHeartbeat(input: {
  userId: string;
  kind: "lesson" | "video" | "quiz" | "discussion";
  courseId?: string | null;
  lessonId?: string | null;
  seconds: number;
}): Promise<{ ok: true; streakDays: number }> {
  const clamped = Math.min(3600, Math.max(0.033, input.seconds)); // 0.033m … 60m
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, input.userId));

  emitAnalyticsEvent({
    eventName: "activity_heartbeat",
    userId: input.userId,
    courseId: input.courseId ?? null,
    lessonId: input.lessonId ?? null,
    payload: { kind: input.kind, seconds: clamped },
  });

  const streakDays = await computeActiveStreakDays(input.userId);
  return { ok: true, streakDays };
}

// ── Aggregate dashboard (US-9.1.1) ───────────────────────────

async function totalSeconds(userId: string, sinceDays: number | null): Promise<number> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const base = and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.eventName, "activity_heartbeat"));
  const where = sinceDays
    ? and(base, sql`${analyticsEvents.createdAt} >= ${new Date(Date.now() - sinceDays * 86_400_000)}`)
    : base;
  const rows = await db
    .select({ total: sql`COALESCE(SUM((payload->>'seconds')::numeric), 0)` })
    .from(analyticsEvents)
    .where(where);
  const val = String((rows[0] as { total?: unknown }).total ?? 0);
  const asNumber = Number(val);
  return Number.isNaN(asNumber) ? 0 : asNumber;
}

async function kpisFor(userId: string): Promise<AnalyticsKpis> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [{ enrolledCount }] = await db
    .select({ enrolledCount: count() })
    .from(enrolments)
    .where(eq(enrolments.userId, userId));
  const completedRows = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), sql`${enrolments.completedAt} IS NOT NULL`));
  const certRows = await db.select({ id: certificates.id }).from(certificates).where(eq(certificates.userId, userId));
  const hoursWeek = (await totalSeconds(userId, 7)) / 3600;
  const hoursTotal = (await totalSeconds(userId, null)) / 3600;
  return {
    coursesEnrolled: Number(enrolledCount ?? 0),
    coursesCompleted: completedRows.length,
    hoursLearnedWeek: Math.round(hoursWeek * 100) / 100,
    hoursLearnedTotal: Math.round(hoursTotal * 100) / 100,
    activeStreakDays: await computeActiveStreakDays(userId),
    certificatesEarned: certRows.length,
  };
}

async function heatmapFor(userId: string, days = 90): Promise<HeatmapDay[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      day: sql`to_char(date_trunc('day', ${analyticsEvents.createdAt})::date, 'YYYY-MM-DD')`,
      n: sql`count(*)`,
    })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.userId, userId), sql`${analyticsEvents.createdAt} >= ${since}`))
    .groupBy(sql`date_trunc('day', ${analyticsEvents.createdAt})::date`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ date: String(r.day), count: Number(r.n ?? 0) }));
}

async function inProgressFor(userId: string): Promise<AnalyticsInProgressCourse[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const enr = await db
    .select()
    .from(enrolments)
    .innerJoin(courses, eq(enrolments.courseId, courses.id))
    .where(eq(enrolments.userId, userId));
  const out: AnalyticsInProgressCourse[] = [];
  for (const e of enr) {
    const row = e.courses as typeof courses.$inferSelect;
    const enrolled = e.enrolments as typeof enrolments.$inferSelect;
    const stats = await courseProgressStats(row.id, userId);
    if (stats.percent >= 100) continue;
    const lastRows = await db
      .select({ at: progress.updatedAt })
      .from(progress)
      .where(and(eq(progress.userId, userId), eq(progress.courseId, row.id)))
      .orderBy(desc(progress.updatedAt))
      .limit(1);
    out.push({
      courseId: row.id,
      courseSlug: row.slug,
      courseTitle: row.title,
      category: row.category,
      categoryLabel: row.category,
      instructor: row.instructor,
      progressPercent: stats.percent,
      lastAccessedAt: lastRows.length > 0 ? lastRows[0].at.toISOString() : null,
      firstLessonPosition: stats.firstLessonPosition,
      nextLessonPosition: stats.nextLessonPosition ?? stats.firstLessonPosition,
    });
  }
  out.sort((a, b) => (b.lastAccessedAt ?? "").localeCompare(a.lastAccessedAt ?? ""));
  return out;
}

async function recommendFor(userId: string): Promise<CourseSummary[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const enr = await db
    .select({ category: courses.category, slug: courses.slug })
    .from(enrolments)
    .innerJoin(courses, eq(enrolments.courseId, courses.id))
    .where(eq(enrolments.userId, userId));
  const enrolledSlugs = new Set(enr.map((r) => r.slug));
  const categoryCounts = new Map<string, number>();
  for (const e of enr) categoryCounts.set(e.category, (categoryCounts.get(e.category) ?? 0) + 1);
  const topCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 2);

  const res = await catalogueRankedCourses({
    q: null,
    categories: topCategory,
    levels: [],
    durations: [],
    price: "all",
    languages: [],
    ratingMin: 0,
    sort: "rating",
    page: 1,
    pageSize: 9,
  });
  return res.filter((c) => !enrolledSlugs.has(c.slug)).slice(0, 3);
}

export async function getLearnerAnalytics(userId: string): Promise<LearnerAnalytics> {
  return {
    kpis: await kpisFor(userId),
    heatmap: await heatmapFor(userId),
    inProgress: await inProgressFor(userId),
    recommended: await recommendFor(userId),
  };
}