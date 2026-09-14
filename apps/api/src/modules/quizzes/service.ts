import { and, asc, eq, sql } from "drizzle-orm";
import type {
  QuizAttemptReference,
  QuizAttemptResult,
  QuizConfig,
  QuizQuestionResult,
  QuizStatusResponse,
  StartQuizAttemptResponse,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import {
  courses,
  enrolments,
  gradebook,
  lessons,
  progress,
  quizAttempts,
  quizQuestions,
} from "../../db/schema";
import { publishProgressEvent } from "../../lib/progress-events";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";

type QuizAttemptRow = typeof quizAttempts.$inferSelect;

const QUIZ_ALLOWED_LIMITS = new Set([0, 15, 30, 60, 90, 120]);
const DEFAULT_PASS_PERCENT = 70;

/** Fisher–Yates shuffle — exported for unit tests (US-3.2.2 randomisation). */
export function fisherYates<T>(input: T[], rng: () => number = Math.random): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pure grading helper — exported for unit tests (US-3.2.2 gradebook write). */
export function gradeQuizSnapshot(
  snapshot: Array<{
    id: string;
    prompt: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>,
  answers: Array<{ questionId: string; selectedIndex: number }>,
  passPercent: number,
): {
  questions: QuizQuestionResult[];
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
} {
  const submitted = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
  const questions: QuizQuestionResult[] = snapshot.map((q) => {
    const selectedIndex = submitted.get(q.id) ?? null;
    return {
      questionId: q.id,
      prompt: q.prompt,
      options: q.options,
      selectedIndex,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      correct: selectedIndex !== null && selectedIndex === q.correctIndex,
    };
  });
  const score = questions.filter((q) => q.correct).length;
  const maxScore = questions.length;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  return { questions, score, maxScore, percent, passed: percent >= passPercent };
}

async function enrolledCourseLesson(slug: string, position: number, userId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const courseRows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, slug), eq(courses.status, "published")))
    .limit(1);
  if (courseRows.length === 0) throw notFound("Course not found.");
  const course = courseRows[0];

  const enrolledRows = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, course.id)))
    .limit(1);
  if (enrolledRows.length === 0) throw forbidden("Enrol in the course to take this quiz.");

  const lessonRows = await db
    .select()
    .from(lessons)
    .where(
      and(
        eq(lessons.courseId, course.id),
        eq(lessons.position, position),
        eq(lessons.published, true),
      ),
    )
    .limit(1);
  if (lessonRows.length === 0) throw notFound("Lesson not found.");
  const lesson = lessonRows[0];
  if (lesson.kind !== "quiz") throw badRequest("This lesson is not a graded quiz.");
  return { course, lesson };
}

function lessonQuizConfig(lesson: typeof lessons.$inferSelect): QuizConfig {
  return {
    timeLimitMinutes: lesson.quizTimeLimitMinutes ?? 0,
    passPercent: lesson.quizPassPercent ?? DEFAULT_PASS_PERCENT,
    maxAttempts: lesson.quizMaxAttempts ?? 0,
    attemptCooldownMinutes: lesson.quizAttemptCooldownMinutes ?? 0,
    shuffleQuestions: lesson.quizShuffleQuestions ?? true,
    shuffleAnswers: lesson.quizShuffleAnswers ?? true,
  };
}

function toAttemptReference(a: QuizAttemptRow): QuizAttemptReference {
  return {
    attemptId: a.id,
    attemptNumber: a.attemptNumber,
    status: a.status as QuizAttemptReference["status"],
    score: Number(a.score ?? 0),
    maxScore: Number(a.maxScore ?? 0),
    percent: Number(a.percent ?? 0),
    passed: a.passed,
    autoSubmitted: a.autoSubmitted,
    startedAt: a.startedAt.toISOString(),
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
  };
}

async function attemptsForUser(
  db: Awaited<ReturnType<typeof getDb>>["db"],
  userId: string,
  lessonId: string,
) {
  return db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.lessonId, lessonId)))
    .orderBy(asc(quizAttempts.attemptNumber));
}

/** Auto-submit any in_progress attempt past its expiry (US-3.2.2 timer). */
async function finaliseExpiredAttempts(
  db: Awaited<ReturnType<typeof getDb>>["db"],
  userId: string,
  lessonId: string,
) {
  const now = new Date();
  const stale = await db
    .select()
    .from(quizAttempts)
    .where(
      and(
        eq(quizAttempts.userId, userId),
        eq(quizAttempts.lessonId, lessonId),
        eq(quizAttempts.status, "in_progress"),
        sql`${quizAttempts.expiresAt} IS NOT NULL`,
        sql`${quizAttempts.expiresAt} < ${now}`,
      ),
    );
  for (const attempt of stale) {
    const rows = await db
      .select({ passPercent: lessons.quizPassPercent })
      .from(lessons)
      .where(eq(lessons.id, attempt.lessonId))
      .limit(1);
    const grade = gradeQuizSnapshot(
      attempt.questionsSnapshot,
      attempt.answers,
      rows[0]?.passPercent ?? DEFAULT_PASS_PERCENT,
    );
    await db
      .update(quizAttempts)
      .set({
        status: "expired",
        autoSubmitted: true,
        submittedAt: now,
        score: String(grade.score),
        maxScore: String(grade.maxScore),
        percent: String(grade.percent),
        passed: grade.passed,
      })
      .where(eq(quizAttempts.id, attempt.id));
    await upsertGradebook(db, userId, attempt, grade);
  }
}

async function upsertGradebook(
  db: Awaited<ReturnType<typeof getDb>>["db"],
  userId: string,
  attempt: QuizAttemptRow,
  grade: { score: number; maxScore: number; percent: number; passed: boolean },
) {
  await db
    .insert(gradebook)
    .values({
      userId,
      courseId: attempt.courseId,
      lessonId: attempt.lessonId,
      itemType: "quiz",
      attemptId: attempt.id,
      score: String(grade.score),
      maxScore: String(grade.maxScore),
      percent: String(grade.percent),
      passed: grade.passed,
      submittedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [gradebook.userId, gradebook.lessonId, gradebook.itemType],
      set: {
        attemptId: attempt.id,
        score: String(grade.score),
        maxScore: String(grade.maxScore),
        percent: String(grade.percent),
        passed: grade.passed,
        submittedAt: new Date(),
      },
    });
}
export async function getQuizStatus(
  userId: string,
  slug: string,
  position: number,
): Promise<QuizStatusResponse> {
  const { course, lesson } = await enrolledCourseLesson(slug, position, userId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await finaliseExpiredAttempts(db, userId, lesson.id);

  const attempts = await attemptsForUser(db, userId, lesson.id);
  const config = lessonQuizConfig(lesson);
  const used = attempts.length;
  const maxAttemptsReached = config.maxAttempts > 0 && used >= config.maxAttempts;

  const latest = attempts.at(-1) ?? null;
  let cooldownRemainingSeconds = 0;
  if (latest && latest.submittedAt && config.attemptCooldownMinutes > 0) {
    const waitUntil = latest.submittedAt.getTime() + config.attemptCooldownMinutes * 60_000;
    cooldownRemainingSeconds = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
  }

  const best =
    [...attempts].sort((a, b) => Number(b.percent ?? 0) - Number(a.percent ?? 0))[0] ?? null;

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quizQuestions)
    .where(eq(quizQuestions.lessonId, lesson.id));

  return {
    lessonId: lesson.id,
    courseSlug: course.slug,
    lessonPosition: lesson.position,
    title: lesson.title,
    config,
    questionCount: Number(countRow?.n ?? 0),
    attemptsUsed: used,
    bestAttempt: best ? toAttemptReference(best) : null,
    latestAttempt: latest ? toAttemptReference(latest) : null,
    canAttempt:
      !maxAttemptsReached &&
      cooldownRemainingSeconds === 0 &&
      (!latest || latest.status !== "in_progress") &&
      Number(countRow?.n ?? 0) > 0,
    cooldownRemainingSeconds,
    maxAttemptsReached,
  };
}
export async function startQuizAttempt(
  userId: string,
  slug: string,
  position: number,
): Promise<StartQuizAttemptResponse> {
  const { course, lesson } = await enrolledCourseLesson(slug, position, userId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  await finaliseExpiredAttempts(db, userId, lesson.id);

  const config = lessonQuizConfig(lesson);
  const attempts = await attemptsForUser(db, userId, lesson.id);
  const used = attempts.length;
  if (config.maxAttempts > 0 && used >= config.maxAttempts) {
    throw badRequest("Maximum attempts reached for this quiz.");
  }
  const latest = attempts.at(-1);
  if (latest && latest.status === "in_progress") {
    throw badRequest("You already have an attempt in progress.");
  }
  if (latest?.submittedAt && config.attemptCooldownMinutes > 0) {
    const waitUntil = latest.submittedAt.getTime() + config.attemptCooldownMinutes * 60_000;
    if (Date.now() < waitUntil) {
      throw badRequest("Attempt cooldown is still active — come back shortly.");
    }
  }

  const questionRows = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.lessonId, lesson.id))
    .orderBy(asc(quizQuestions.position));

  let questions = questionRows.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
  }));
  if (config.shuffleQuestions) questions = fisherYates(questions);
  if (config.shuffleAnswers) {
    questions = questions.map((q) => {
      const tagged = q.options.map((opt, i) => ({ opt, i }));
      const shuffled = fisherYates(tagged);
      return {
        ...q,
        options: shuffled.map((s) => s.opt),
        correctIndex: shuffled.findIndex((s) => s.i === q.correctIndex),
      };
    });
  }

  const attemptNumber = used + 1;
  const startedAt = new Date();
  const expiresAt =
    QUIZ_ALLOWED_LIMITS.has(config.timeLimitMinutes) && config.timeLimitMinutes > 0
      ? new Date(startedAt.getTime() + config.timeLimitMinutes * 60_000)
      : null;

  const [row] = await db
    .insert(quizAttempts)
    .values({
      userId,
      courseId: course.id,
      lessonId: lesson.id,
      attemptNumber,
      status: "in_progress",
      startedAt,
      expiresAt,
      questionsSnapshot: questions as QuizAttemptRow["questionsSnapshot"],
      answers: [],
      score: "0",
      maxScore: String(questions.length),
      percent: "0",
      passed: false,
      autoSubmitted: false,
    })
    .returning();

  return {
    ...toAttemptReference(row),
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
  };
}

export async function submitQuizAttempt(
  userId: string,
  slug: string,
  position: number,
  attemptId: string,
  answers: Array<{ questionId: string; selectedIndex: number }>,
): Promise<QuizAttemptResult> {
  const { course } = await enrolledCourseLesson(slug, position, userId);
  const { db } = getDb(loadEnv().DATABASE_URL);

  const rows = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw notFound("Attempt not found.");
  const attempt = rows[0];

  if (attempt.status === "submitted") {
    return buildStoredResult(attempt);
  }

  const now = new Date();
  const expired =
    attempt.status === "in_progress" &&
    attempt.expiresAt !== null &&
    attempt.expiresAt.getTime() < now.getTime();
  const autoSubmitted = expired;

  const snapshotIds = new Set(
    (attempt.questionsSnapshot ?? []).map((q) => (q as { id: string }).id),
  );
  const cleanAnswers = (answers ?? []).filter((a) => snapshotIds.has(a.questionId));

  const [configRow] = await db
    .select({ passPercent: lessons.quizPassPercent })
    .from(lessons)
    .where(eq(lessons.id, attempt.lessonId))
    .limit(1);
  const grade = gradeQuizSnapshot(
    attempt.questionsSnapshot,
    cleanAnswers,
    configRow?.passPercent ?? DEFAULT_PASS_PERCENT,
  );

  await db
    .update(quizAttempts)
    .set({
      status: expired ? "expired" : "submitted",
      answers: cleanAnswers,
      submittedAt: now,
      score: String(grade.score),
      maxScore: String(grade.maxScore),
      percent: String(grade.percent),
      passed: grade.passed,
      autoSubmitted,
    })
    .where(eq(quizAttempts.id, attempt.id));

  const [updated] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
  await upsertGradebook(db, userId, updated, grade);

  // US-5.1.1 — quiz lesson completes on submission.
  await markQuizLessonComplete(userId, attempt.courseId, attempt.lessonId);

  emitAnalyticsEvent({
    eventName: "quiz_submitted",
    userId,
    courseId: course.id,
    lessonId: attempt.lessonId,
    payload: {
      attemptNumber: attempt.attemptNumber,
      score: grade.score,
      maxScore: grade.maxScore,
      percent: grade.percent,
      passed: grade.passed,
      autoSubmitted,
    },
  });

  return {
    ...toAttemptReference(updated),
    gradebook: {
      itemType: "quiz",
      score: grade.score,
      maxScore: grade.maxScore,
      percent: grade.percent,
      passed: grade.passed,
      submittedAt: now.toISOString(),
    },
    questions: grade.questions,
  };
}

async function buildStoredResult(attempt: QuizAttemptRow): Promise<QuizAttemptResult> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const gbRows = await db
    .select()
    .from(gradebook)
    .where(and(eq(gradebook.userId, attempt.userId), eq(gradebook.lessonId, attempt.lessonId)))
    .limit(1);
  const gb = gbRows[0];
  const grade = gradeQuizSnapshot(
    attempt.questionsSnapshot,
    attempt.answers,
    gb?.passed ? 0 : 100,
  );
  return {
    ...toAttemptReference(attempt),
    gradebook: {
      itemType: "quiz",
      score: Number(gb?.score ?? grade.score),
      maxScore: Number(gb?.maxScore ?? grade.maxScore),
      percent: Number(gb?.percent ?? grade.percent),
      passed: gb?.passed ?? grade.passed,
      submittedAt: (gb?.submittedAt ?? attempt.submittedAt ?? new Date()).toISOString(),
    },
    questions: grade.questions,
  };
}

async function markQuizLessonComplete(userId: string, courseId: string, lessonId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db
    .insert(progress)
    .values({ userId, courseId, lessonId, completed: true, lastPositionMs: 0 })
    .onConflictDoUpdate({
      target: [progress.userId, progress.lessonId],
      set: { completed: true, updatedAt: new Date() },
    });

  const [{ completed, total }] = await db
    .select({
      completed: sql<number>`count(*) FILTER (WHERE completed)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(progress)
    .where(and(eq(progress.userId, userId), eq(progress.courseId, courseId)));

  const [course] = await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, courseId)).limit(1);
  const [lesson] = await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  const coursePercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  publishProgressEvent(userId, {
    event: "lesson-completed",
    courseSlug: course?.slug ?? "",
    lessonId,
    completed: true,
    positionMs: 0,
    coursePercent,
    lessonTitle: lesson?.title ?? "Quiz",
    at: new Date().toISOString(),
  });
}