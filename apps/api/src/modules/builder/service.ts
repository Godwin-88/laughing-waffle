import { and, asc, eq, desc, sql } from "drizzle-orm";
import type {
  BuilderCourse,
  BuilderCourseListEntry,
  BuilderLessonSummary,
  BuilderModuleSummary,
  CreateCoursePayload,
  CreateLessonPayload,
  CreateModulePayload,
  UpdateCoursePayload,
  UpdateLessonPayload,
  UpdateModulePayload,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, lessons, modules } from "../../db/schema";
import { forbidden, notFound } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";
import { slugify } from "../../lib/slug";

type Role = string;

async function ownedCourseBySlug(userId: string, role: Role, slug: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [course] = await db.select().from(courses).where(eq(courses.slug, slug)).limit(1);
  if (!course) throw notFound("Course not found.");
  if (course.instructorId !== userId && role !== "admin") {
    throw forbidden("Only the course instructor can manage this course.");
  }
  return course;
}

async function ownedCourseById(userId: string, role: Role, courseId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!course) throw notFound("Course not found.");
  if (course.instructorId !== userId && role !== "admin") {
    throw forbidden("Only the course instructor can manage this course.");
  }
  return course;
}

async function ownedModule(userId: string, role: Role, moduleId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1);
  if (!mod) throw notFound("Module not found.");
  await ownedCourseById(userId, role, mod.courseId);
  return mod;
}

async function ownedLesson(userId: string, role: Role, lessonId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson) throw notFound("Lesson not found.");
  await ownedCourseById(userId, role, lesson.courseId);
  return lesson;
}

async function courseSlugFor(userId: string, role: Role, courseId: string): Promise<string> {
  const course = await ownedCourseById(userId, role, courseId);
  return course.slug;
}

async function uniqueSlug(base: string): Promise<string> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const candidate = slugify(base) || "course";
  const existing = await db
    .select({ slug: courses.slug })
    .from(courses)
    .where(eq(courses.slug, candidate))
    .limit(1);
  if (existing.length === 0) return candidate;
  for (let i = 2; i < 100; i++) {
    const next = `${candidate}-${i}`;
    const found = await db
      .select({ slug: courses.slug })
      .from(courses)
      .where(eq(courses.slug, next))
      .limit(1);
    if (found.length === 0) return next;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}

async function nextModulePosition(courseId: string): Promise<number> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${modules.position}), 0)` })
    .from(modules)
    .where(eq(modules.courseId, courseId));
  return (row?.max ?? 0) + 1;
}

async function nextLessonPosition(courseId: string): Promise<number> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${lessons.position}), 0)` })
    .from(lessons)
    .where(eq(lessons.courseId, courseId));
  return (row?.max ?? 0) + 1;
}

// ─────────────────────────────────────────────────────────────
// Course listing / detail
// ─────────────────────────────────────────────────────────────

export async function listMyBuilderCourses(userId: string, role: Role): Promise<BuilderCourseListEntry[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(courses)
    .where(role === "admin" ? undefined : eq(courses.instructorId, userId))
    .orderBy(desc(courses.updatedAt));

  const out: BuilderCourseListEntry[] = [];
  for (const c of rows) {
    const [moduleAgg] = await db
      .select({
        moduleCount: sql<number>`count(distinct ${modules.id})`,
        lessonCount: sql<number>`count(distinct ${lessons.id})`,
      })
      .from(courses)
      .leftJoin(modules, eq(modules.courseId, courses.id))
      .leftJoin(lessons, eq(lessons.courseId, courses.id))
      .where(eq(courses.id, c.id));
    const [pubAgg] = await db
      .select({ published: sql<number>`count(*)` })
      .from(lessons)
      .where(and(eq(lessons.courseId, c.id), eq(lessons.published, true)));
    out.push({
      id: c.id,
      slug: c.slug,
      title: c.title,
      tagline: c.tagline,
      status: c.status as BuilderCourseListEntry["status"],
      category: c.category,
      priceCents: c.priceCents,
      moduleCount: Number(moduleAgg?.moduleCount ?? 0),
      lessonCount: Number(moduleAgg?.lessonCount ?? 0),
      publishedLessonCount: Number(pubAgg?.published ?? 0),
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
    });
  }
  return out;
}

export async function getBuilderCourse(
  userId: string,
  role: Role,
  slug: string,
): Promise<BuilderCourse> {
  const course = await ownedCourseBySlug(userId, role, slug);
  const { db } = getDb(loadEnv().DATABASE_URL);

  const moduleRows = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(asc(modules.position));

  const lessonRows = await db
    .select()
    .from(lessons)
    .where(eq(lessons.courseId, course.id))
    .orderBy(asc(lessons.position));

  const byModule = new Map<string, BuilderLessonSummary[]>();
  for (const l of lessonRows) {
    const key = l.moduleId ?? "__none__";
    const list = byModule.get(key) ?? [];
    list.push({
      id: l.id,
      moduleId: l.moduleId,
      position: l.position,
      title: l.title,
      summary: l.summary,
      kind: l.kind as BuilderLessonSummary["kind"],
      published: l.published,
      videoStatus: (l.videoStatus ?? "none") as BuilderLessonSummary["videoStatus"],
      videoDurationSeconds: l.videoDurationSeconds,
      updatedAt: l.updatedAt ? l.updatedAt.toISOString() : null,
    });
    byModule.set(key, list);
  }

  const modulesList: BuilderModuleSummary[] = moduleRows.map((m) => ({
    id: m.id,
    courseId: m.courseId,
    position: m.position,
    title: m.title,
    week: m.week,
    hoursEstimate: m.hoursEstimate,
    examCoverage: m.examCoverage,
    hook: m.hook,
    objectives: m.objectives ?? [],
    lessons: byModule.get(m.id) ?? [],
  }));
  const unassigned = byModule.get("__none__") ?? [];
  if (unassigned.length > 0) {
    modulesList.push({
      id: "__unassigned__",
      courseId: course.id,
      position: 0,
      title: "Unassigned lessons",
      week: null,
      hoursEstimate: null,
      examCoverage: null,
      hook: "",
      objectives: [],
      lessons: unassigned,
    });
  }

  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    tagline: course.tagline,
    description: course.description,
    objectives: course.objectives ?? [],
    instructor: course.instructor,
    durationWeeks: course.durationWeeks,
    skillLevel: course.skillLevel as BuilderCourse["skillLevel"],
    category: course.category,
    priceCents: course.priceCents,
    currency: course.currency,
    certificationLabel: course.certificationLabel,
    status: course.status as BuilderCourse["status"],
    previewVideoUrl: course.previewVideoUrl,
    modules: modulesList,
  };
}

// ─────────────────────────────────────────────────────────────
// Course CRUD
// ─────────────────────────────────────────────────────────────

export async function createCourse(
  userId: string,
  role: Role,
  payload: CreateCoursePayload,
): Promise<BuilderCourseListEntry> {
  if (!["instructor", "admin"].includes(role)) {
    throw forbidden("Instructor access is required to create courses.");
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const slug = await uniqueSlug(payload.title);
  await db.insert(courses).values({
    slug,
    title: payload.title,
    tagline: payload.tagline ?? "",
    category: payload.category,
    skillLevel: payload.skillLevel,
    durationWeeks: payload.durationWeeks ?? 0,
    priceCents: payload.priceCents ?? 0,
    instructorId: userId,
    status: "draft",
  });

  emitAnalyticsEvent({
    eventName: "course_created",
    userId,
    courseId: undefined,
    payload: { slug },
  });

  const list = await listMyBuilderCourses(userId, role);
  return list.find((c) => c.slug === slug) ?? list[0];
}

export async function updateCourse(
  userId: string,
  role: Role,
  slug: string,
  payload: UpdateCoursePayload,
): Promise<BuilderCourse> {
  const course = await ownedCourseBySlug(userId, role, slug);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(courses).set({ ...payload, updatedAt: new Date() }).where(eq(courses.id, course.id));
  return getBuilderCourse(userId, role, slug);
}

export async function publishCourse(userId: string, role: Role, slug: string): Promise<BuilderCourse> {
  const course = await ownedCourseBySlug(userId, role, slug);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .update(courses)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(courses.id, course.id));
  emitAnalyticsEvent({
    eventName: "course_published",
    userId,
    courseId: course.id,
    payload: { slug: course.slug },
  });
  return getBuilderCourse(userId, role, slug);
}

// ─────────────────────────────────────────────────────────────
// Modules
// ─────────────────────────────────────────────────────────────

export async function addModule(
  userId: string,
  role: Role,
  courseSlug: string,
  payload: CreateModulePayload,
): Promise<BuilderCourse> {
  const course = await ownedCourseBySlug(userId, role, courseSlug);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.insert(modules).values({
    courseId: course.id,
    position: await nextModulePosition(course.id),
    title: payload.title,
    week: payload.week ?? null,
    hoursEstimate: payload.hoursEstimate ?? null,
    examCoverage: payload.examCoverage ?? null,
    hook: payload.hook ?? "",
    objectives: payload.objectives ?? [],
  });
  return getBuilderCourse(userId, role, courseSlug);
}

export async function updateModule(
  userId: string,
  role: Role,
  moduleId: string,
  payload: UpdateModulePayload,
): Promise<BuilderCourse> {
  const mod = await ownedModule(userId, role, moduleId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(modules).set({ ...payload, updatedAt: new Date() }).where(eq(modules.id, moduleId));
  const slug = await courseSlugFor(userId, role, mod.courseId);
  return getBuilderCourse(userId, role, slug);
}

export async function deleteModule(userId: string, role: Role, moduleId: string): Promise<void> {
  await ownedModule(userId, role, moduleId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.delete(modules).where(eq(modules.id, moduleId));
  await db.update(lessons).set({ moduleId: null }).where(eq(lessons.moduleId, moduleId));
}

// ─────────────────────────────────────────────────────────────
// Lessons
// ─────────────────────────────────────────────────────────────

export async function addLesson(
  userId: string,
  role: Role,
  courseSlug: string,
  payload: CreateLessonPayload,
): Promise<BuilderCourse> {
  const course = await ownedCourseBySlug(userId, role, courseSlug);
  if (payload.moduleId) await ownedModule(userId, role, payload.moduleId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.insert(lessons).values({
    courseId: course.id,
    moduleId: payload.moduleId ?? null,
    position: await nextLessonPosition(course.id),
    title: payload.title,
    summary: payload.summary ?? "",
    content: payload.content ?? "",
    kind: payload.kind ?? "text",
    published: payload.published ?? false,
  });
  return getBuilderCourse(userId, role, courseSlug);
}

export async function updateLesson(
  userId: string,
  role: Role,
  lessonId: string,
  payload: UpdateLessonPayload,
): Promise<BuilderCourse> {
  const lesson = await ownedLesson(userId, role, lessonId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .update(lessons)
    .set({ ...payload, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));
  const slug = await courseSlugFor(userId, role, lesson.courseId);
  return getBuilderCourse(userId, role, slug);
}

export async function deleteLesson(userId: string, role: Role, lessonId: string): Promise<void> {
  const lesson = await ownedLesson(userId, role, lessonId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.delete(lessons).where(eq(lessons.id, lessonId));
}
