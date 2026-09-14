import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { CatalogueResponse, CourseDetail, CourseSummary, Facet, LessonPublic, QuizQuestion } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, lessons, modules, progress, quizQuestions } from "../../db/schema";

const DURATION_BANDS: Array<{ value: string; label: string; min: number; max: number | null }> = [
  { value: "1-4", label: "1–4 weeks", min: 1, max: 4 },
  { value: "5-8", label: "5–8 weeks", min: 5, max: 8 },
  { value: "9-12", label: "9–12 weeks", min: 9, max: 12 },
  { value: "13+", label: "13+ weeks", min: 13, max: null },
];

export interface CatalogueParams {
  q: string | null;
  interests?: string[];
  categories: string[];
  levels: string[];
  durations: string[];
  price: "free" | "paid" | "all";
  languages: string[];
  ratingMin: number;
  sort: string;
  page: number;
  pageSize: number;
  userId?: string | null;
}

export function facetCounts(
  labels: ReadonlyArray<{ value: string; label: string }>,
  counts: Record<string, number>,
): Facet[] {
  return labels
    .map(({ value, label }) => ({ value, label, count: counts[value] ?? 0 }))
    .filter((f) => f.count > 0);
}

export async function catalogueSearch(
  params: CatalogueParams,
): Promise<CatalogueResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const page = Math.max(1, params.page);
  const pageSize = Math.min(60, Math.max(1, params.pageSize));

  // ── base conditions ──────────────────────────────────────────
  const whereList: Array<SQL | undefined> = [eq(courses.status, "published")];
  if (params.q?.trim()) {
    const q = params.q.trim();
    whereList.push(
      or(
        sql`${courses.searchTsv} @@ websearch_to_tsquery('simple', ${q})`,
        sql`${courses.title} ILIKE ${`%${q}%`}`,
      ),
    );
  }
  if (params.categories.length > 0) {
    whereList.push(inArray(courses.category, params.categories));
  }
  if (params.levels.length > 0) {
    whereList.push(inArray(courses.skillLevel, params.levels));
  }
  if (params.durations.length > 0) {
    const bandWhere: SQL[] = [];
    for (const d of params.durations) {
      const band = DURATION_BANDS.find((b) => b.value === d);
      if (!band) continue;
      bandWhere.push(
        band.max === null
          ? sql`${courses.durationWeeks} >= ${band.min}`
          : sql`${courses.durationWeeks} BETWEEN ${band.min} AND ${band.max}`,
      );
    }
    if (bandWhere.length > 0) whereList.push(or(...bandWhere));
  }
  if (params.price === "free") {
    whereList.push(eq(courses.priceCents, 0));
  } else if (params.price === "paid") {
    whereList.push(sql`${courses.priceCents} > 0`);
  }
  if (params.languages.length > 0) {
    whereList.push(sql`${courses.languages} ?| ${params.languages satisfies string[]}`);
  }
  if (params.ratingMin > 0) {
    whereList.push(sql`${courses.rating} >= ${params.ratingMin}`);
  }

  const where = and(...whereList);

  // ── ordering ─────────────────────────────────────────────────
  const orderBy = (() => {
    switch (params.sort) {
      case "rating":
        return [desc(courses.rating), desc(courses.ratingCount)];
      case "price_asc":
        return [asc(courses.priceCents)];
      case "price_desc":
        return [desc(courses.priceCents)];
      case "relevance":
        return [desc(sql`ts_rank_cd(${courses.searchTsv}, websearch_to_tsquery('simple', ${params.q ?? ""}))`), desc(courses.createdAt)];
      case "newest":
      default:
        return [desc(courses.createdAt)];
    }
  })();

  // ── facets (counts) ──────────────────────────────────────────
  const facetWhere = where ?? sql`true`;
  const catRows = await db.execute(
    sql`SELECT category AS value, count(*)::int AS n FROM courses WHERE ${facetWhere} GROUP BY category`,
  );
  const lvlRows = await db.execute(
    sql`SELECT skill_level AS value, count(*)::int AS n FROM courses WHERE ${facetWhere} GROUP BY skill_level`,
  );
  const langRows = await db.execute(
    sql`SELECT x AS value, count(*)::int AS n FROM courses CROSS JOIN LATERAL jsonb_array_elements_text(languages) AS x WHERE ${facetWhere} GROUP BY x`,
  );
  const bandRows = await db.execute(
    sql`SELECT CASE
            WHEN duration_weeks BETWEEN 1 AND 4 THEN '1-4'
            WHEN duration_weeks BETWEEN 5 AND 8 THEN '5-8'
            WHEN duration_weeks BETWEEN 9 AND 12 THEN '9-12'
            ELSE '13+' END AS value,
          count(*)::int AS n
        FROM courses WHERE ${facetWhere} GROUP BY 1`,
  );

  const catCounts: Record<string, number> = {};
  const levelCounts: Record<string, number> = {};
  const langCounts: Record<string, number> = {};
  const bandCounts: Record<string, number> = {};
  const toCount = (rows: { value?: unknown; n?: unknown }[]) =>
    Object.fromEntries(
      rows
        .filter((r) => r.value !== null && r.value !== undefined)
        .map((r) => [String(r.value), Number(r.n ?? 0)]),
    );
  Object.assign(catCounts, toCount(catRows.rows));
  Object.assign(levelCounts, toCount(lvlRows.rows));
  Object.assign(langCounts, toCount(langRows.rows));
  Object.assign(bandCounts, toCount(bandRows.rows));

  // ── rows ─────────────────────────────────────────────────────
  const rows = await db
    .select()
    .from(courses)
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(courses)
    .where(where);

  const enrolled = params.userId
    ? new Set(
        (
          await db
            .select({ courseId: enrolments.courseId })
            .from(enrolments)
            .where(and(eq(enrolments.userId, params.userId), inArray(enrolments.courseId, rows.map((r) => r.id))))
        ).map((r) => r.courseId),
      )
    : new Set<string>();

  const items = await Promise.all(rows.map((row) => mapCourseToSummary(row, enrolled.has(row.id))));

  return {
    items,
    meta: { page, pageSize, total, hasMore: page * pageSize < total },
    facets: {
      categories: facetCounts(CATEGORY_LABELS, catCounts),
      levels: facetCounts(LEVEL_LABELS, levelCounts),
      languages: facetCounts(LANG_LABELS, langCounts),
      durationBands: facetCounts(DURATION_BANDS, bandCounts),
    },
  };
}

const CATEGORY_LABELS = [
  { value: "ai-engineering", label: "AI Engineering" },
  { value: "data-science", label: "Data Science" },
  { value: "cloud-aws", label: "Cloud & AWS" },
  { value: "software-engineering", label: "Software Engineering" },
  { value: "foundations", label: "Foundations" },
] as const;

const LEVEL_LABELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

const LANG_LABELS = [
  { value: "English", label: "English" },
  { value: "Swahili", label: "Swahili" },
  { value: "French", label: "French" },
] as const;

export async function catalogueRankedCourses(
  params: Omit<CatalogueParams, "page" | "pageSize"> & { page?: number; pageSize?: number },
): Promise<CourseSummary[]> {
  const res = await catalogueSearch({
    ...params,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 12,
  });
  return res.items;
}

export async function mapCourseToSummary(
  row: typeof courses.$inferSelect,
  isEnrolled: boolean,
): Promise<CourseSummary> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    instructor: row.instructor,
    durationWeeks: row.durationWeeks,
    skillLevel: row.skillLevel as "beginner" | "intermediate" | "advanced",
    category: row.category,
    languages: row.languages,
    priceCents: row.priceCents,
    currency: row.currency,
    rating: row.rating,
    ratingCount: row.ratingCount,
    tags: row.tags,
    coverImageUrl: row.coverImageUrl,
    certificationLabel: row.certificationLabel,
    progressPercent: null,
    enrolled: isEnrolled,
  };
}

export async function getCourseDetail(
  slug: string,
  userId?: string | null,
): Promise<CourseDetail | null> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, slug), eq(courses.status, "published")))
    .limit(1);
  if (rows.length === 0) return null;
  const course = rows[0];

  const enrolledRows = userId
    ? await db
        .select()
        .from(enrolments)
        .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, course.id)))
        .limit(1)
    : [];
  const isEnrolled = enrolledRows.length > 0;

  const moduleRows = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, course.id))
    .orderBy(asc(modules.position));
  const lessonCounts = await db
    .select({ moduleId: lessons.moduleId, n: count() })
    .from(lessons)
    .where(eq(lessons.courseId, course.id))
    .groupBy(lessons.moduleId);

  const countsByModule = new Map(lessonCounts.map((r) => [r.moduleId, r.n]));
  const moduleSummaries = moduleRows.map((m) => ({
    id: m.id,
    courseId: m.courseId,
    position: m.position,
    title: m.title,
    week: m.week,
    hoursEstimate: m.hoursEstimate,
    examCoverage: m.examCoverage,
    hook: m.hook,
    objectives: m.objectives,
    lessonCount: countsByModule.get(m.id) ?? 0,
  }));

  const related = await catalogueRankedCourses({
    q: course.category,
    interests: course.tags,
    categories: [course.category],
    levels: [course.skillLevel as string],
    durations: [],
    price: "all",
    languages: [],
    ratingMin: 0,
    sort: "rating",
    page: 1,
    pageSize: 3,
    userId,
  });

  return {
    ...(await mapCourseToSummary(course, isEnrolled)),
    objectives: course.objectives,
    instructorBio: course.instructorBio,
    previewVideoUrl: course.previewVideoUrl,
    modules: moduleSummaries,
    related,
  };
}

export async function getLessonByPosition(
  slug: string,
  position: number,
): Promise<LessonPublic | null> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const courseRows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, slug), eq(courses.status, "published")))
    .limit(1);
  if (courseRows.length === 0) return null;
  const course = courseRows[0];

  const lessonRows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.courseId, course.id), eq(lessons.position, position)))
    .limit(1);
  if (lessonRows.length === 0) return null;
  const lesson = lessonRows[0];

  const [{ n: totalLessons }] = await db
    .select({ n: count() })
    .from(lessons)
    .where(eq(lessons.courseId, course.id));

  const quizRows = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.lessonId, lesson.id))
    .orderBy(asc(quizQuestions.position));

  return {
    id: lesson.id,
    courseId: course.id,
    moduleId: lesson.moduleId,
    position: lesson.position,
    lessonNumber: lesson.lessonNumber,
    totalLessons,
    title: lesson.title,
    summary: lesson.summary,
    content: lesson.content,
    kind: lesson.kind as "text" | "video" | "notebook" | "lab" | "quiz",
    quizQuestions: quizRows.map((q) => ({
      id: q.id,
      lessonId: q.lessonId,
      position: q.position,
      prompt: q.prompt,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    }) as QuizQuestion),
  };
}