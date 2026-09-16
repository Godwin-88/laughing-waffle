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
  type AnyPgColumn,
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
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    forcePasswordResetAt: timestamp("force_password_reset_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    certificatePassPercent: integer("certificate_pass_percent").notNull().default(70),
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

// ─────────────────────────────────────────────────────────────
// Sprint 6 — paid checkout (US-2.2.2) & certificates (US-5.1.2)
// ─────────────────────────────────────────────────────────────

export type OrderProvider = "stripe" | "mpesa" | "paypal" | "mock";
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderReceipt {
  /** Provider fee captured at payment (amount in same currency). */
  providerFeeCents?: number;
  /** Human-readable payment method label, e.g. "Visa ••4242". */
  paymentMethod?: string;
  /** Card/M-Pesa payer identifier captured at payment. */
  last4?: string;
  /** M-Pesa receipt number when the Daraja STK push confirmed. */
  mpesaReceipt?: string;
  /** PayPal capture id when relevant. */
  captureId?: string;
}

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    provider: text("provider").$type<OrderProvider>().notNull(),
    providerSessionId: text("provider_session_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").$type<OrderStatus>().notNull().default("pending"),
    failureReason: text("failure_reason"),
    receipt: jsonb("receipt").$type<OrderReceipt>().notNull().default({}),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("orders_order_number_unique").on(t.orderNumber)],
);

export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    certificateNumber: text("certificate_number").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    instructorName: text("instructor_name").notNull(),
    fileKey: text("file_key").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("certificates_user_course_unique").on(t.userId, t.courseId)],
);
// ─────────────────────────────────────────────────────────────
// Sprint 7 — Admin panel (US-7.1.x) & GDPR (US-7.2.1)
// ─────────────────────────────────────────────────────────────

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
});

export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const configRevisions = pgTable("config_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataRequestType = "export" | "delete";
export type DataRequestStatus =
  | "pending_confirmation"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type DataRequestInitiator = "self" | "admin";

export const dataRequests = pgTable("data_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<DataRequestType>().notNull(),
  status: text("status").$type<DataRequestStatus>().notNull().default("pending_confirmation"),
  initiatedBy: text("initiated_by").$type<DataRequestInitiator>().notNull().default("self"),
  adminId: uuid("admin_id").references(() => users.id, { onDelete: "set null" }),
  tokenHash: text("token_hash"),
  storageKey: text("storage_key"),
  error: text("error"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Sprint 8 — Discussions (US-6.1.1) & Notifications (US-10.1.1)
// Mirrors 0007_discussions_notifications.sql
// ─────────────────────────────────────────────────────────────

export type DiscussionPostStatus = "visible" | "hidden";

export const discussionPosts = pgTable("discussion_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => lessons.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => discussionPosts.id, { onDelete: "cascade" }),
  depth: smallint("depth").notNull().default(0),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  upvoteCount: integer("upvote_count").notNull().default(0),
  status: text("status").$type<DiscussionPostStatus>().notNull().default("visible"),
  moderationReason: text("moderation_reason"),
  moderationBy: uuid("moderation_by").references(() => users.id, { onDelete: "set null" }),
  moderationAt: timestamp("moderation_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discussionVotes = pgTable(
  "discussion_votes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => discussionPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [t.postId, t.userId],
);

export type NotificationTypeValue =
  | "discussion_reply"
  | "assignment_graded"
  | "course_content_added"
  | "certificate_issued"
  | "payment_receipt"
  | "streak_reminder"
  | "instructor_announcement";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<NotificationTypeValue>().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: text("link"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  discussionReply: boolean("discussion_reply").notNull().default(true),
  assignmentGraded: boolean("assignment_graded").notNull().default(true),
  courseContentAdded: boolean("course_content_added").notNull().default(true),
  certificateIssued: boolean("certificate_issued").notNull().default(true),
  paymentReceipt: boolean("payment_receipt").notNull().default(true),
  streakReminder: boolean("streak_reminder").notNull().default(true),
  instructorAnnouncement: boolean("instructor_announcement").notNull().default(true),
  marketing: boolean("marketing").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Sprint 9 — OAuth clients (US-8.1.1) · LTI 1.3 (US-8.1.2)
// ─────────────────────────────────────────────────────────────

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  clientId: text("client_id").notNull().unique(),
  clientSecretHash: text("client_secret_hash").notNull(),
  scopes: text("scopes").notNull().default("catalogue:read"),
  status: text("status").notNull().default("active"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ltiRegistrations = pgTable("lti_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  toolName: text("tool_name").notNull().default(""),
  authLoginUrl: text("auth_login_url"),
  authTokenUrl: text("auth_token_url"),
  jwksUrl: text("jwks_url"),
  platformKeySet: jsonb("platform_key_set").$type<Record<string, unknown>>(),
  agsLineItemUrl: text("ags_line_item_url"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ltiLaunches = pgTable("lti_launches", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .references(() => ltiRegistrations.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  nonce: text("nonce").notNull(),
  messageType: text("message_type").notNull().default("LtiResourceLinkLaunch"),
  targetLinkUri: text("target_link_uri"),
  contextId: text("context_id"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  used: boolean("used").notNull().default(false),
  launchedAt: timestamp("launched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ltiGrades = pgTable("lti_grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .references(() => ltiRegistrations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "set null" }),
  attemptId: uuid("attempt_id"),
  scoreGiven: numeric("score_given", { precision: 6, scale: 2 }).notNull(),
  scoreMaximum: numeric("score_maximum", { precision: 6, scale: 2 }).notNull().default("100"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
});
