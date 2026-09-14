import { and, asc, eq, desc, count, sql } from "drizzle-orm";
import type {
  CourseProgressResponse,
  EnrolmentContext,
  EnrolmentSummary,
  EnrolNowResponse,
  LessonProgressRow,
  SaveProgressResponse,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, lessons, progress } from "../../db/schema";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";
import { publishProgressEvent } from "../../lib/progress-events";

export interface SaveProgressInput {
  courseSlug: string;
  lessonId: string;
  positionMs: number;
  completed?: boolean;
}

async function loadPublishedCourseBySlug(slug: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, slug), eq(courses.status, "published")))
    .limit(1);
  return rows[0] ?? null;
}

async function lessonBelongsToCourse(lessonId: string, courseId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.id, lessonId), eq(lessons.courseId, courseId)))
    .limit(1);
  return rows.length > 0;
}

interface CourseProgressStats {
  enrolled: boolean;
  percent: number;
  completedLessons: number;
  totalLessons: number;
  firstLessonPosition: number | null;
  lastLessonPosition: number | null;
  nextLessonPosition: number | null;
}

async function courseProgressStats(
  courseId: string,
  userId: string | null,
): Promise<CourseProgressStats> {
  const { db } = getDb(loadEnv().DATABASE_URL);

  const [{ total }] = await db
    .select({ total: count() })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), eq(lessons.published, true)));

  const [first] = await db
    .select({ p: lessons.position })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), eq(lessons.published, true)))
    .orderBy(asc(lessons.position))
    .limit(1);

  if (!userId) {
    return {
      enrolled: false,
      percent: 0,
      completedLessons: 0,
      totalLessons: total,
      firstLessonPosition: first?.p ?? null,
      lastLessonPosition: null,
      nextLessonPosition: first?.p ?? null,
    };
  }

  const enrolledRows = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, courseId)))
    .limit(1);
  const enrolled = enrolledRows.length > 0;

  const [{ completed }] = await db
    .select({ completed: count() })
    .from(progress)
    .where(
      and(
        eq(progress.userId, userId),
        eq(progress.courseId, courseId),
        eq(progress.completed, true),
      ),
    );

  const lastRows = await db
    .select({ p: lessons.position, updated: progress.updatedAt })
    .from(progress)
    .innerJoin(lessons, eq(progress.lessonId, lessons.id))
    .where(and(eq(progress.userId, userId), eq(progress.courseId, courseId)))
    .orderBy(desc(progress.updatedAt))
    .limit(1);

  const nextRow = await db.execute(
    sql`
      SELECT MIN(l.position) AS p
      FROM lessons l
      LEFT JOIN lesson_progress pr
        ON pr.lesson_id = l.id AND pr.user_id = ${userId}
      WHERE l.course_id = ${courseId} AND l.published = true
        AND (pr.id IS NULL OR pr.completed = false)
    `,
  );
  const nextPosition =
    nextRow.rows.length > 0 && nextRow.rows[0].p != null ? Number(nextRow.rows[0].p) : null;

  return {
    enrolled,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    completedLessons: completed,
    totalLessons: total,
    firstLessonPosition: first?.p ?? null,
    lastLessonPosition: lastRows.length > 0 ? lastRows[0].p : null,
    nextLessonPosition: nextPosition,
  };
}

// ─────────────────────────────────────────────────────────────
// US-2.2.1 free enrolment
// ─────────────────────────────────────────────────────────────

export async function enrolFree(userId: string, courseSlug: string): Promise<EnrolNowResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const course = await loadPublishedCourseBySlug(courseSlug);
  if (!course) throw notFound("Course not found.");

  if (course.priceCents > 0) {
    throw badRequest("Paid checkout is enabled with the Sprint 6 milestone — this course is not free.");
  }

  const existing = await db
    .select()
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, course.id)))
    .limit(1);

  const alreadyEnrolled = existing.length > 0;
  let enrolmentId = alreadyEnrolled ? existing[0].id : "";

  if (!alreadyEnrolled) {
    const [row] = await db
      .insert(enrolments)
      .values({ userId, courseId: course.id, pricePaidCents: 0, status: "enrolled" })
      .returning();
    enrolmentId = row.id;
  }

  emitAnalyticsEvent({
    eventName: "course_enrolled",
    userId,
    courseId: course.id,
    payload: { courseSlug, alreadyEnrolled, pricePaidCents: 0 },
  });

  const stats = await courseProgressStats(course.id, userId);
  return {
    enrolmentId,
    alreadyEnrolled,
    redirect: stats.firstLessonPosition
      ? { courseSlug, lessonPosition: stats.firstLessonPosition }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Enrolment listing + context
// ─────────────────────────────────────────────────────────────

export async function listMyEnrolments(userId: string): Promise<EnrolmentSummary[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      id: enrolments.id,
      courseId: courses.id,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      courseCoverImageUrl: courses.coverImageUrl,
      courseCategory: courses.category,
      instructor: courses.instructor,
      enrolledAt: enrolments.enrolledAt,
      status: enrolments.status,
      pricePaidCents: enrolments.pricePaidCents,
    })
    .from(enrolments)
    .innerJoin(courses, eq(enrolments.courseId, courses.id))
    .where(eq(enrolments.userId, userId))
    .orderBy(desc(enrolments.enrolledAt));

  const out: EnrolmentSummary[] = [];
  for (const row of rows) {
    const stats = await courseProgressStats(row.courseId, userId);
    out.push({
      courseId: row.courseId,
      courseSlug: row.courseSlug,
      courseTitle: row.courseTitle,
      courseCoverImageUrl: row.courseCoverImageUrl,
      courseCategory: row.courseCategory,
      instructor: row.instructor,
      enrolledAt: row.enrolledAt.toISOString(),
      status: row.status,
      pricePaidCents: row.pricePaidCents,
      progressPercent: stats.percent,
      firstLessonPosition: stats.firstLessonPosition,
      lastLessonPosition: stats.lastLessonPosition,
    });
  }
  return out;
}

export async function getEnrolmentContext(
  userId: string | null,
  courseSlug: string,
): Promise<EnrolmentContext | null> {
  const course = await loadPublishedCourseBySlug(courseSlug);
  if (!course) return null;
  const stats = await courseProgressStats(course.id, userId);
  return {
    enrolled: stats.enrolled,
    progressPercent: stats.percent,
    firstLessonPosition: stats.firstLessonPosition,
    lastLessonPosition: stats.lastLessonPosition,
    nextLessonPosition: stats.nextLessonPosition,
  };
}

// ─────────────────────────────────────────────────────────────
// US-3.1.1 playback-position persistence
// ─────────────────────────────────────────────────────────────

export async function saveProgress(
  userId: string,
  input: SaveProgressInput,
): Promise<SaveProgressResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const course = await loadPublishedCourseBySlug(input.courseSlug);
  if (!course) throw notFound("Course not found.");
  if (!(await lessonBelongsToCourse(input.lessonId, course.id))) {
    throw notFound("Lesson does not belong to this course.");
  }

  const enrolled = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, course.id)))
    .limit(1);
  if (enrolled.length === 0) throw forbidden("Enrol in the course to track progress.");

  const lessonRows = await db
    .select({ id: lessons.id, kind: lessons.kind, duration: lessons.videoDurationSeconds })
    .from(lessons)
    .where(eq(lessons.id, input.lessonId))
    .limit(1);
  const lesson = lessonRows[0];

  const positionMs = Math.max(0, Math.round(input.positionMs || 0));
  // US-5.1.1 — video lesson marks complete at ≥90 % of duration (non-contiguous ok).
  const videoComplete =
    lesson.kind === "video" &&
    typeof lesson.duration === "number" &&
    lesson.duration > 0 &&
    positionMs >= lesson.duration * 900;
  const completed = Boolean(input.completed || videoComplete);

  const [lessonRow] = await db
    .select({ moduleId: lessons.moduleId })
    .from(lessons)
    .where(eq(lessons.id, input.lessonId))
    .limit(1);

  await db
    .insert(progress)
    .values({
      userId,
      courseId: course.id,
      moduleId: lessonRow?.moduleId ?? null,
      lessonId: input.lessonId,
      completed,
      lastPositionMs: positionMs,
    })
    .onConflictDoUpdate({
      target: [progress.userId, progress.lessonId],
      set: { completed, lastPositionMs: positionMs, updatedAt: new Date() },
    });

  const stats = await courseProgressStats(course.id, userId);

  emitAnalyticsEvent({
    eventName: "lesson_progress",
    userId,
    courseId: course.id,
    lessonId: input.lessonId,
    payload: { positionMs, completed },
  });

  // US-5.1.1 — push real-time progress to the learner's SSE stream.
  const lessonTitleRows = await db
    .select({ title: lessons.title })
    .from(lessons)
    .where(eq(lessons.id, input.lessonId))
    .limit(1);
  publishProgressEvent(userId, {
    event: completed ? "lesson-completed" : "position-saved",
    courseSlug: course.slug,
    lessonId: input.lessonId,
    completed,
    positionMs,
    coursePercent: stats.percent,
    lessonTitle: lessonTitleRows[0]?.title ?? "Lesson",
    at: new Date().toISOString(),
  });

  return {
    lessonId: input.lessonId,
    courseSlug: course.slug,
    completed,
    positionMs,
    coursePercent: stats.percent,
  };
}

export async function markLessonComplete(userId: string, lessonId: string): Promise<SaveProgressResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ courseId: lessons.courseId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (rows.length === 0) throw notFound("Lesson not found.");
  const courseRows = await db
    .select({ slug: courses.slug })
    .from(courses)
    .where(eq(courses.id, rows[0].courseId))
    .limit(1);
  return saveProgress(userId, {
    courseSlug: courseRows[0].slug,
    lessonId,
    positionMs: 0,
    completed: true,
  });
}

export async function getCourseProgress(
  userId: string,
  courseSlug: string,
): Promise<CourseProgressResponse | null> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const course = await loadPublishedCourseBySlug(courseSlug);
  if (!course) return null;

  const stats = await courseProgressStats(course.id, userId);

  const lessonRows = await db
    .select({
      id: lessons.id,
      position: lessons.position,
      title: lessons.title,
    })
    .from(lessons)
    .where(and(eq(lessons.courseId, course.id), eq(lessons.published, true)))
    .orderBy(asc(lessons.position));

  const progRows = await db
    .select({
      lessonId: progress.lessonId,
      completed: progress.completed,
      lastPositionMs: progress.lastPositionMs,
      updatedAt: progress.updatedAt,
    })
    .from(progress)
    .where(and(eq(progress.userId, userId), eq(progress.courseId, course.id)));

  const byLesson = new Map(progRows.map((r) => [r.lessonId, r]));

  const lessonsList: LessonProgressRow[] = lessonRows.map((l) => {
    const p = byLesson.get(l.id);
    return {
      lessonId: l.id,
      position: l.position,
      title: l.title,
      completed: p?.completed ?? false,
      lastPositionMs: p?.lastPositionMs ?? 0,
      updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
    };
  });

  return {
    courseSlug: course.slug,
    enrolled: stats.enrolled,
    percent: stats.percent,
    completedLessons: stats.completedLessons,
    totalLessons: stats.totalLessons,
    lessons: lessonsList,
  };
}
