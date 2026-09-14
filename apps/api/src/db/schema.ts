import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// NOTE: table definitions mirror apps/api/src/db/migrations/0001_init.sql.
// Drizzle is used for typed queries only — schema ownership lives in SQL
// migrations so FTS/trgm/trigger behaviour stays explicit.

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    role: text("role").notNull().default("learner"),
    avatarKey: text("avatar_key"),
    bio: text("bio").notNull().default(""),
    status: text("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
    ssoProvider: text("sso_provider"),
    ssoSubject: text("sso_subject"),
    interests: jsonb("interests").$type<string[]>().notNull().default([]),
    experienceLevel: text("experience_level"),
    wizardStep: integer("wizard_step").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    tagline: text("tagline").notNull().default(""),
    description: text("description").notNull().default(""),
    objectives: jsonb("objectives").$type<string[]>().notNull().default([]),
    instructor: text("instructor").notNull().default(""),
    instructorBio: text("instructor_bio").notNull().default(""),
    instructorId: uuid("instructor_id").references(() => users.id),
    durationWeeks: integer("duration_weeks").notNull().default(0),
    skillLevel: text("skill_level").notNull().default("beginner"),
    category: text("category").notNull().default("technology"),
    languages: jsonb("languages").$type<string[]>().notNull().default(["English"]),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    rating: doublePrecision("rating").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    coverImageUrl: text("cover_image_url"),
    previewVideoUrl: text("preview_video_url"),
    certificationLabel: text("certification_label"),
    searchTsv: text("search_tsv"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("courses_slug_unique").on(t.slug)],
);
export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  week: integer("week"),
  hoursEstimate: integer("hours_estimate"),
  examCoverage: text("exam_coverage"),
  hook: text("hook").notNull().default(""),
  objectives: jsonb("objectives").$type<string[]>().notNull().default([]),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  lessonNumber: integer("lesson_number"),
  totalLessons: integer("total_lessons"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull().default({}),
  published: boolean("published").notNull().default(false),
  kind: text("kind").notNull().default("text"),
  videoStatus: text("video_status").notNull().default("none"),
  videoSourceKey: text("video_source_key"),
  hlsPrefix: text("hls_prefix"),
  videoDurationSeconds: integer("video_duration_seconds"),
  videoPosterKey: text("video_poster_key"),
  captionsKey: text("captions_key"),
  // ── Sprint 5 graded quiz config (US-3.2.2) ──────────────────
  quizTimeLimitMinutes: integer("quiz_time_limit_minutes").notNull().default(0),
  quizPassPercent: integer("quiz_pass_percent").notNull().default(70),
  quizMaxAttempts: integer("quiz_max_attempts").notNull().default(0),
  quizAttemptCooldownMinutes: integer("quiz_attempt_cooldown_minutes").notNull().default(0),
  quizShuffleQuestions: boolean("quiz_shuffle_questions").notNull().default(true),
  quizShuffleAnswers: boolean("quiz_shuffle_answers").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizQuestions = pgTable("quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctIndex: integer("correct_index").notNull(),
  explanation: text("explanation").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enrolments = pgTable(
  "enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("enrolled"),
    pricePaidCents: integer("price_paid_cents").notNull().default(0),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("enrolments_user_course_unique").on(t.userId, t.courseId)],
);

export const progress = pgTable("lesson_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  completed: boolean("completed").notNull().default(false),
  lastPositionMs: integer("last_position_ms").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    questionsSnapshot: jsonb("questions_snapshot")
      .$type<GradedQuestionSnapshot[]>()
      .notNull()
      .default([]),
    answers: jsonb("answers")
      .$type<Array<{ questionId: string; selectedIndex: number }>>()
      .notNull()
      .default([]),
    score: numeric("score", { precision: 6, scale: 2 }).notNull().default("0"),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull().default("0"),
    percent: numeric("percent", { precision: 6, scale: 2 }).notNull().default("0"),
    passed: boolean("passed").notNull().default(false),
    autoSubmitted: boolean("auto_submitted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quiz_attempts_user_lesson_attempt").on(t.userId, t.lessonId, t.attemptNumber)],
);

export const gradebook = pgTable(
  "gradebook",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull().default("quiz"),
    attemptId: uuid("attempt_id").references(() => quizAttempts.id, { onDelete: "set null" }),
    score: numeric("score", { precision: 6, scale: 2 }).notNull().default("0"),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }).notNull().default("0"),
    percent: numeric("percent", { precision: 6, scale: 2 }).notNull().default("0"),
    passed: boolean("passed").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gradebook_user_lesson_item").on(t.userId, t.lessonId, t.itemType)],
);

export interface GradedQuestionSnapshot {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const courseReviews = pgTable("course_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rating: smallint("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoAssets = pgTable("video_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => lessons.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceFilename: text("source_filename").notNull(),
  sourceContentType: text("source_content_type").notNull().default("video/mp4"),
  sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }).notNull().default(0),
  sourceKey: text("source_key").notNull(),
  uploadId: text("upload_id"),
  parts: jsonb("parts")
    .$type<Array<{ partNumber: number; etag: string | null; size: number }>>()
    .notNull()
    .default([]),
  uploadedBytes: bigint("uploaded_bytes", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("uploading"),
  hlsPrefix: text("hls_prefix"),
  durationSeconds: integer("duration_seconds"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transcodeJobs = pgTable("transcode_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => videoAssets.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventName: text("event_name").notNull(),
  userId: uuid("user_id"),
  courseId: uuid("course_id"),
  lessonId: uuid("lesson_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});