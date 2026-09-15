/**
 * Seed runner — loads courses.json + courses-extra.json + lesson markdown
 * files, plus a demo user. Idempotent: skips any course already present by slug.
 *
 * Usage: npm run db:seed  (requires migrated database)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { loadEnv } from "../config/env";
import { getDb } from "../db/client";
import {
  courses as coursesTable,
  lessons as lessonsTable,
  modules as modulesTable,
  quizQuestions as quizQuestionsTable,
  users as usersTable,
} from "../db/schema";
import { hashPassword } from "../lib/password";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

interface QuizSeed {
  position: number;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface LessonSeed {
  position: number;
  lessonNumber?: number;
  totalLessons?: number;
  title: string;
  summary: string;
  kind: string;
  content?: string;
  contentFile?: string;
  quiz?: QuizSeed[];
  quizConfig?: {
    timeLimitMinutes?: number;
    passPercent?: number;
    maxAttempts?: number;
    attemptCooldownMinutes?: number;
    shuffleQuestions?: boolean;
    shuffleAnswers?: boolean;
  };
}

interface ModuleSeed {
  position: number;
  title: string;
  week?: number | null;
  hoursEstimate?: number | null;
  examCoverage?: string | null;
  hook: string;
  objectives: string[];
  lessons?: LessonSeed[];
}

interface CourseSeed {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  objectives: string[];
  instructor: string;
  instructorBio: string;
  durationWeeks: number;
  skillLevel: string;
  category: string;
  languages: string[];
  priceCents: number;
  currency: string;
  rating: number;
  ratingCount: number;
  tags: string[];
  coverImageUrl: string | null;
  previewVideoUrl: string | null;
  certificationLabel: string | null;
  modules: ModuleSeed[];
}

async function readJson(file: string): Promise<CourseSeed[]> {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as CourseSeed[];
}
export async function seedCourses(allCourses: CourseSeed[]) {
  const { db } = getDb(loadEnv().DATABASE_URL);

  let created = 0;
  let skipped = 0;
  let upsertedLessons = 0;

  for (const course of allCourses) {
    const existing = await db
      .select({ id: coursesTable.id })
      .from(coursesTable)
      .where(eq(coursesTable.slug, course.slug))
      .limit(1);

    let courseRow: { id: string };
    if (existing.length > 0) {
      courseRow = existing[0];
      skipped++;
      console.log(`[seed] sync course (exists): ${course.slug}`);
    } else {
      const [row] = await db
        .insert(coursesTable)
        .values({
          slug: course.slug,
          title: course.title,
          tagline: course.tagline,
          description: course.description,
          objectives: course.objectives,
          instructor: course.instructor,
          instructorBio: course.instructorBio,
          durationWeeks: course.durationWeeks,
          skillLevel: course.skillLevel,
          category: course.category,
          languages: course.languages,
          priceCents: course.priceCents,
          currency: course.currency,
          rating: course.rating,
          ratingCount: course.ratingCount,
          tags: course.tags,
          coverImageUrl: course.coverImageUrl,
          previewVideoUrl: course.previewVideoUrl,
          certificationLabel: course.certificationLabel,
          status: "published",
        })
        .returning();
      courseRow = row;
      created++;
    }

    let lessonCounter = 0;
    for (const mod of course.modules) {
      const [moduleRow] = await db
        .insert(modulesTable)
        .values({
          courseId: courseRow.id,
          position: mod.position,
          title: mod.title,
          week: mod.week ?? null,
          hoursEstimate: mod.hoursEstimate ?? null,
          examCoverage: mod.examCoverage ?? null,
          hook: mod.hook,
          objectives: mod.objectives,
        })
        .onConflictDoUpdate({
          target: [modulesTable.courseId, modulesTable.position],
          set: {
            title: mod.title,
            week: mod.week ?? null,
            hoursEstimate: mod.hoursEstimate ?? null,
            examCoverage: mod.examCoverage ?? null,
            hook: mod.hook,
            objectives: mod.objectives,
          },
        })
        .returning();

      const lessons = mod.lessons ?? [];
      for (const lesson of lessons) {
        lessonCounter++;
        const content = lesson.contentFile
          ? await readFile(path.join(DATA_DIR, lesson.contentFile), "utf8")
          : (lesson.content ?? "");
        const [lessonRow] = await db
          .insert(lessonsTable)
          .values({
            courseId: courseRow.id,
            moduleId: moduleRow.id,
            position: lesson.position,
            lessonNumber: lesson.lessonNumber ?? lessonCounter,
            totalLessons: lesson.totalLessons ?? lessons.length,
            title: lesson.title,
            summary: lesson.summary,
            content,
            kind: lesson.kind,
            published: true,
            quizTimeLimitMinutes: lesson.quizConfig?.timeLimitMinutes ?? 0,
            quizPassPercent: lesson.quizConfig?.passPercent ?? 70,
            quizMaxAttempts: lesson.quizConfig?.maxAttempts ?? 0,
            quizAttemptCooldownMinutes: lesson.quizConfig?.attemptCooldownMinutes ?? 0,
            quizShuffleQuestions: lesson.quizConfig?.shuffleQuestions ?? true,
            quizShuffleAnswers: lesson.quizConfig?.shuffleAnswers ?? true,
          })
          .onConflictDoUpdate({
            target: [lessonsTable.courseId, lessonsTable.position],
            set: {
              moduleId: moduleRow.id,
              title: lesson.title,
              summary: lesson.summary,
              content,
              kind: lesson.kind,
              published: true,
              quizTimeLimitMinutes: lesson.quizConfig?.timeLimitMinutes ?? 0,
              quizPassPercent: lesson.quizConfig?.passPercent ?? 70,
              quizMaxAttempts: lesson.quizConfig?.maxAttempts ?? 0,
              quizAttemptCooldownMinutes: lesson.quizConfig?.attemptCooldownMinutes ?? 0,
              quizShuffleQuestions: lesson.quizConfig?.shuffleQuestions ?? true,
              quizShuffleAnswers: lesson.quizConfig?.shuffleAnswers ?? true,
            },
          })
          .returning();
        upsertedLessons++;

        // Quiz questions: delete + re-insert for this lesson so the seed stays
        // authoritative (attempts store their own snapshot, so this is safe).
        if (lesson.quiz?.length) {
          await db.delete(quizQuestionsTable).where(eq(quizQuestionsTable.lessonId, lessonRow.id));
          for (const quiz of lesson.quiz) {
            await db.insert(quizQuestionsTable).values({
              courseId: courseRow.id,
              moduleId: moduleRow.id,
              lessonId: lessonRow.id,
              position: quiz.position,
              prompt: quiz.prompt,
              options: quiz.options,
              correctIndex: quiz.correctIndex,
              explanation: quiz.explanation ?? "",
            });
          }
        }
      }
    }
    if (existing.length === 0) {
      console.log(
        `[seed] created course: ${course.slug} (${course.modules.length} modules, ${lessonCounter} lessons)`,
      );
    }
  }

  console.log(`\n[seed] courses done — created ${created}, synced ${skipped}, lessons upserted ${upsertedLessons}`);
}

type CourseRow = { id: string };

async function seedDemoUser() {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const email = "demo@takwimu.school";
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    console.log("[seed] skip demo user (exists)");
    return;
  }
  await db.insert(usersTable).values({
    email,
    passwordHash: await hashPassword("Takwimu123"),
    firstName: "Demo",
    lastName: "Learner",
    role: "learner",
    emailVerifiedAt: new Date(),
    consentGivenAt: new Date(),
    interests: ["ai-engineering", "generative-ai"],
    experienceLevel: "intermediate",
    wizardStep: 3,
  });
  console.log(`[seed] demo user: ${email} / Takwimu123`);
}

async function seedAdminUser() {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const email = "admin@takwimu.school";
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    console.log("[seed] skip admin user (exists)");
    return;
  }
  await db.insert(usersTable).values({
    email,
    passwordHash: await hashPassword("Takwimu123"),
    firstName: "System",
    lastName: "Administrator",
    role: "admin",
    emailVerifiedAt: new Date(),
    consentGivenAt: new Date(),
    interests: [],
    experienceLevel: "advanced",
    wizardStep: 3,
  });
  console.log(`[seed] admin user: ${email} / Takwimu123`);
}

async function main() {
  const mainCourses = await readJson(path.join(DATA_DIR, "courses.json"));
  const extraCourses = await readJson(path.join(DATA_DIR, "courses-extra.json"));
  await seedCourses([...mainCourses, ...extraCourses]);
  await seedDemoUser();
  await seedAdminUser();
  console.log("\n[seed] done ✔");
}

await main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
})