/**
 * @takwimu/shared — contracts shared between the Fastify API and the Next.js
 * web client. Kept dependency-free and importable as TypeScript source
 * (`exports["."] = "./src/index.ts"`), so both apps consume the same types
 * and validation constants.
 */

// ─────────────────────────────────────────────────────────────
// Validation constants (Sprint 1 — US-1.1.1, US-1.2.2)
// ─────────────────────────────────────────────────────────────

export const PASSWORD_MIN_LENGTH = 8;
export const BIO_MAX_LENGTH = 500;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Spec: password min 8 chars, 1 uppercase, 1 number. */
export function isStrongPassword(password: string): boolean {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export function passwordError(): string {
  return "Password must be at least 8 characters and include one uppercase letter and one number.";
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─────────────────────────────────────────────────────────────
// Taxonomy (Sprint 2 — US-1.2.1 profile wizard step 2)
// ─────────────────────────────────────────────────────────────

export const INTEREST_OPTIONS = [
  { value: "data-science", label: "Data Science" },
  { value: "ai-engineering", label: "AI Engineering" },
  { value: "generative-ai", label: "Generative AI" },
  { value: "machine-learning", label: "Machine Learning" },
  { value: "cloud-aws", label: "Cloud & AWS" },
  { value: "software-engineering", label: "Software Engineering" },
  { value: "ai-agents", label: "AI Agents & Products" },
  { value: "financial-engineering", label: "Financial Engineering" },
] as const;

export type InterestValue = (typeof INTEREST_OPTIONS)[number]["value"];

export interface InterestOption {
  value: InterestValue;
  label: string;
}

// ─────────────────────────────────────────────────────────────
// Core enums
// ─────────────────────────────────────────────────────────────

export type SkillLevel = "beginner" | "intermediate" | "advanced";
export type UserRole = "learner" | "instructor" | "admin";
export type CourseStatus = "draft" | "published" | "archived";
export type LessonKind = "text" | "video" | "notebook" | "lab" | "quiz";
export type VideoStatus =
  | "none"
  | "uploading"
  | "queued"
  | "transcoding"
  | "ready"
  | "failed";

// ─────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  bio: string;
  emailVerified: boolean;
  interests: InterestValue[];
  experienceLevel: SkillLevel | null;
  wizardStep: number; // 0..3
  profileCompleteness: number; // 0..100
  createdAt: string;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  instructor: string;
  durationWeeks: number;
  skillLevel: SkillLevel;
  category: string;
  languages: string[];
  priceCents: number;
  currency: string;
  rating: number;
  ratingCount: number;
  tags: string[];
  coverImageUrl: string | null;
  certificationLabel: string | null;
  progressPercent: number | null; // set when the viewer is enrolled
  enrolled: boolean;
}

export interface ModuleSummary {
  id: string;
  courseId: string;
  position: number;
  title: string;
  week: number | null;
  hoursEstimate: number | null;
  examCoverage: string | null;
  hook: string;
  objectives: string[];
  lessonCount: number;
}

export interface CourseDetail extends CourseSummary {
  objectives: string[];
  instructorBio: string;
  previewVideoUrl: string | null;
  modules: ModuleSummary[];
  related: CourseSummary[];
}

export interface QuizQuestion {
  id: string;
  lessonId: string | null;
  position: number;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface Paginated<T> {
  items: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface CourseFilters {
  q?: string;
  categories?: string[];
  levels?: SkillLevel[];
  durations?: string[]; // "1-4", "5-8", "9-12", "13+"
  price?: "free" | "paid" | "all";
  languages?: string[];
  ratingMin?: number;
  sort?: "rating" | "newest" | "price_asc" | "price_desc" | "relevance";
  page?: number;
  pageSize?: number;
}

export interface AuthMeResponse {
  user: PublicUser;
  sso: { google: boolean; microsoft: boolean };
  recommendations: CourseSummary[];
}

export interface CatalogueResponse extends Paginated<CourseSummary> {
  facets: {
    categories: Facet[];
    levels: Facet[];
    languages: Facet[];
    durationBands: Facet[];
  };
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

// ─────────────────────────────────────────────────────────────
// Payloads
// ─────────────────────────────────────────────────────────────

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  consent: boolean; // GDPR consent checkbox (required)
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ProfileWizardStepPayload {
  step: 1 | 2 | 3;
  firstName?: string;
  lastName?: string;
  interests?: InterestValue[];
  experienceLevel?: SkillLevel;
}

export interface AuthTokensResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  user: PublicUser;
  devVerificationUrl?: string | null; // development-only convenience
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface LessonPublic {
  id: string;
  courseId: string;
  moduleId: string | null;
  position: number;
  lessonNumber: number | null;
  totalLessons: number | null;
  title: string;
  summary: string;
  content: string;
  kind: LessonKind;
  quizQuestions: QuizQuestion[];
  /** Present when the lesson is a graded quiz (`kind === "quiz"`); answers are never exposed. */
  quizConfig: QuizConfig | null;
  /** Present when `kind === "video"`; manifest is gated on enrolment. */
  video: VideoLessonInfo | null;
}

export interface VideoQualityTier {
  height: number;
  width: number;
  bandwidth: number; // bps advertised in the master playlist
  playlistPath: string; // relative to the HLS prefix
}

export interface VideoLessonInfo {
  status: VideoStatus;
  durationSeconds: number | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  /** Master HLS playlist URL — only returned to enrolled learners. */
  hlsManifestUrl: string | null;
  tiers: VideoQualityTier[];
  savedPositionMs: number | null;
  error: string | null;
  uploadedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
// Sprint 3 — enrolment & progress (US-2.2.1, US-3.1.1)
// ─────────────────────────────────────────────────────────────

export interface EnrolNowResponse {
  enrolmentId: string;
  alreadyEnrolled: boolean;
  redirect: { courseSlug: string; lessonPosition: number } | null;
}

export interface EnrolmentSummary {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseCoverImageUrl: string | null;
  courseCategory: string;
  instructor: string;
  enrolledAt: string;
  status: string;
  pricePaidCents: number;
  progressPercent: number;
  firstLessonPosition: number | null;
  lastLessonPosition: number | null;
}

export interface EnrolmentContext {
  enrolled: boolean;
  progressPercent: number;
  firstLessonPosition: number | null;
  lastLessonPosition: number | null;
  nextLessonPosition: number | null;
}

export interface LessonProgressRow {
  lessonId: string;
  position: number;
  title: string;
  completed: boolean;
  lastPositionMs: number;
  updatedAt: string | null;
}

export interface CourseProgressResponse {
  courseSlug: string;
  enrolled: boolean;
  percent: number;
  completedLessons: number;
  totalLessons: number;
  lessons: LessonProgressRow[];
}

export interface SaveProgressResponse {
  lessonId: string;
  courseSlug: string;
  completed: boolean;
  positionMs: number;
  coursePercent: number;
}

// ─────────────────────────────────────────────────────────────
// Sprint 4 — course builder & video upload (US-4.1.x)
// ─────────────────────────────────────────────────────────────

export interface BuilderLessonSummary {
  id: string;
  moduleId: string | null;
  position: number;
  title: string;
  summary: string;
  kind: LessonKind;
  published: boolean;
  videoStatus: VideoStatus;
  videoDurationSeconds: number | null;
  updatedAt: string | null;
}

export interface BuilderModuleSummary {
  id: string;
  courseId: string;
  position: number;
  title: string;
  week: number | null;
  hoursEstimate: number | null;
  examCoverage: string | null;
  hook: string;
  objectives: string[];
  lessons: BuilderLessonSummary[];
}

export interface BuilderCourse {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  objectives: string[];
  instructor: string;
  durationWeeks: number;
  skillLevel: SkillLevel;
  category: string;
  priceCents: number;
  currency: string;
  certificationLabel: string | null;
  status: CourseStatus;
  previewVideoUrl: string | null;
  modules: BuilderModuleSummary[];
}

export interface BuilderCourseListEntry {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  status: CourseStatus;
  category: string;
  priceCents: number;
  moduleCount: number;
  lessonCount: number;
  publishedLessonCount: number;
  updatedAt: string | null;
}

export interface CreateCoursePayload {
  title: string;
  tagline?: string;
  category: string;
  skillLevel: SkillLevel;
  durationWeeks?: number;
  priceCents?: number;
}

export interface UpdateCoursePayload {
  title?: string;
  tagline?: string;
  description?: string;
  objectives?: string[];
  category?: string;
  skillLevel?: SkillLevel;
  durationWeeks?: number;
  priceCents?: number;
  certificationLabel?: string | null;
  previewVideoUrl?: string | null;
}

export interface CreateModulePayload {
  title: string;
  week?: number | null;
  hoursEstimate?: number | null;
  examCoverage?: string | null;
  hook?: string;
  objectives?: string[];
}

export interface UpdateModulePayload {
  title?: string;
  week?: number | null;
  hoursEstimate?: number | null;
  examCoverage?: string | null;
  hook?: string;
  objectives?: string[];
}

export interface CreateLessonPayload {
  moduleId?: string | null;
  title: string;
  summary?: string;
  kind?: LessonKind;
  content?: string;
  published?: boolean;
}

export interface UpdateLessonPayload {
  title?: string;
  summary?: string;
  content?: string;
  contentJson?: Record<string, unknown>;
  kind?: LessonKind;
  published?: boolean;
}

export interface VideoUploadSession {
  assetId: string;
  lessonId: string;
  partSizeBytes: number;
  partCount: number;
  driver: "local" | "b2";
  /** When `driver === "b2"`, PUT part bytes to this URL (presigned UploadPart). */
  putMethod: "url" | "api";
  sourceKey: string;
}

export interface VideoPartUrlResponse {
  url: string;
  partNumber: number;
}

export interface VideoAssetStatus {
  assetId: string;
  status: VideoStatus;
  uploadedBytes: number;
  sourceSizeBytes: number;
  durationSeconds: number | null;
  error: string | null;
  jobState: "queued" | "processing" | "done" | "failed" | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
// Sprint 5 — graded quizzes (US-3.2.2) & progress engine (US-5.1.1)
// ─────────────────────────────────────────────────────────────

/** Quiz configuration persisted on the lesson row (US-3.2.2). */
export interface QuizConfig {
  /** 0 = no time limit, otherwise one of 15 / 30 / 60 / 90 / 120 minutes. */
  timeLimitMinutes: number;
  /** Pass threshold 0–100 (default 70). */
  passPercent: number;
  /** 0 = unlimited attempts. */
  maxAttempts: number;
  /** Minutes to wait between attempts (0 = none). */
  attemptCooldownMinutes: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
}

/** Question as presented to the learner on attempt start — answers masked. */
export interface GradedQuizQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface QuizAttemptReference {
  attemptId: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "expired";
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  autoSubmitted: boolean;
  startedAt: string;
  expiresAt: string | null;
  submittedAt: string | null;
}

/** POST /courses/:slug/lessons/:position/quiz/attempts */
export interface StartQuizAttemptResponse extends QuizAttemptReference {
  questions: GradedQuizQuestion[];
}

/** POST /courses/:slug/lessons/:position/quiz/attempts/:id/submit */
export interface QuizSubmissionPayload {
  answers: Array<{ questionId: string; selectedIndex: number }>;
}

export interface QuizQuestionResult {
  questionId: string;
  prompt: string;
  options: string[];
  selectedIndex: number | null;
  correctIndex: number;
  explanation: string;
  correct: boolean;
}

/** Result of a graded quiz attempt, written to the gradebook immediately. */
export interface QuizAttemptResult extends QuizAttemptReference {
  gradebook: {
    itemType: "quiz";
    score: number;
    maxScore: number;
    percent: number;
    passed: boolean;
    submittedAt: string;
  };
  /** Per-question breakdown with explanations (shown on the results page). */
  questions: QuizQuestionResult[];
}

/** GET /courses/:slug/lessons/:position/quiz/status — pre-attempt context. */
export interface QuizStatusResponse {
  lessonId: string;
  courseSlug: string;
  lessonPosition: number;
  title: string;
  config: QuizConfig;
  questionCount: number;
  attemptsUsed: number;
  bestAttempt: QuizAttemptReference | null;
  latestAttempt: QuizAttemptReference | null;
  canAttempt: boolean;
  /** Seconds until the learner may start the next attempt (0 = ready). */
  cooldownRemainingSeconds: number;
  maxAttemptsReached: boolean;
}

// ── Progress engine (US-5.1.1) ────────────────────────────────

export interface TextLessonCompletionSignal {
  lessonId: string;
  courseSlug: string;
  /** "timer" (60 s on page) or "scroll" (reached bottom of the article). */
  signal: "timer" | "scroll";
}

/** Server-Sent Event pushed over GET /me/progress/events. */
export interface ProgressEventMessage {
  event: "lesson-completed" | "position-saved" | "watch-threshold" | "course-completed" | "certificate-issued";
  courseSlug: string;
  lessonId: string;
  completed: boolean;
  positionMs: number;
  coursePercent: number;
  lessonTitle: string;
  at: string;
}

// ─────────────────────────────────────────────────────────────
// Sprint 6 — paid checkout (US-2.2.2) & certificates (US-5.1.2)
// ─────────────────────────────────────────────────────────────

export type PaymentProvider = "stripe" | "mpesa" | "paypal" | "mock";
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderReceipt {
  providerFeeCents?: number;
  paymentMethod?: string;
  last4?: string;
  mpesaReceipt?: string;
  captureId?: string;
}

/** Receipt line returned to the learner (US-2.2.2 "Receipt stored under Orders"). */
export interface OrderSummary {
  id: string;
  orderNumber: string;
  courseSlug: string;
  courseTitle: string;
  provider: PaymentProvider;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  failureReason: string | null;
  receipt: OrderReceipt;
  paidAt: string | null;
  createdAt: string;
}

/** POST /checkout/orders — initialise a checkout for a paid course. */
export interface CreateOrderPayload {
  courseSlug: string;
  provider: PaymentProvider;
  /** Stripe: token/PaymentMethod id (card details handled by Stripe.js, PCI-DSS). */
  paymentToken?: string;
  /** M-Pesa: required. E.164 number, e.g. 254712345678. */
  phoneNumber?: string;
}

/**
 * Provider-specific client payload returned by POST /checkout/orders.
 * The web client finishes the payment off-platform, then polls
 * GET /checkout/orders/:id until status moves out of "pending".
 */
export interface CheckoutOrderResponse {
  order: OrderSummary;
  mode: "mock" | "live";
  client: {
    /** Stripe PaymentIntent client_secret (card requires Stripe.js confirm). */
    clientSecret?: string;
    /** M-Pesa: Daraja CheckoutRequestID for STK push confirmation polling. */
    mpesaCheckoutRequestId?: string;
    /** M-Pesa phone the STK push was sent to (masked). */
    mpesaPhone?: string;
    /** PayPal: open this URL in a pop-up/new tab to approve and capture. */
    paypalApproveUrl?: string;
  };
  /** True when the order is already paid (idempotent re-checkout). */
  paid: boolean;
}

export interface OrderListResponse {
  items: OrderSummary[];
}

export interface PaymentWebhookResult {
  received: boolean;
  orderId?: string;
  status?: OrderStatus;
}

// ── Certificates (US-5.1.2) ─────────────────────────────────

export interface CertificateSummary {
  id: string;
  certificateNumber: string;
  courseSlug: string;
  courseTitle: string;
  instructorName: string;
  issuedAt: string;
  /** Download URL (presigned when the storage driver supports it). */
  downloadUrl: string;
  /** Public verification URL: platform.com/verify/{certificateNumber}. */
  verifyUrl: string;
  /** LinkedIn "Add to Profile" deep link (certification section). */
  linkedinUrl: string;
}

export interface CertificateEligibilityResponse {
  courseSlug: string;
  enrolled: boolean;
  requiredLessons: number;
  completedLessons: number;
  percent: number;
  quizPercent: number | null;
  quizPassRequired: number;
  quizzesPassed: boolean;
  eligible: boolean;
  issued: boolean;
  certificate: CertificateSummary | null;
}

/** Public response from GET /verify/:certificateNumber (no auth). */
export interface CertificateVerificationResponse {
  valid: boolean;
  certificateNumber: string;
  learnerName: string;
  courseTitle: string;
  instructorName: string;
  issuedOn: string;
  platformName: string;
}

// ─────────────────────────────────────────────────────────────
// Sprint 7 — Admin panel (US-7.1.x) & GDPR (US-7.2.1)
// ─────────────────────────────────────────────────────────────

export type UserStatus = "active" | "suspended";
export type PaymentGateway = "stripe" | "mpesa" | "paypal";
export type FeatureFlagName = "discussions" | "certificates" | "offlineDownload";

/** US-7.1.1 — one row in the admin user management table. */
export interface AdminUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  enrolmentCount: number;
}

export interface AdminUserListFilters {
  search?: string;
  role?: UserRole;
  status?: UserStatus | "pending_verification";
}

export interface AdminUserListResponse {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** US-7.1.1 — audit-log row (actor, action, target, timestamp). */
export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  items: AuditLogEntry[];
  total: number;
}

/** US-7.1.2 — platform config surface editable from the admin UI. */
export interface PlatformConfig {
  platform: {
    name: string;
    logoKey: string | null;
    primaryColor: string;
    defaultLanguage: string;
    timezone: string;
  };
  email: {
    fromName: string;
    fromAddress: string;
  };
  maintenance: {
    enabled: boolean;
    message: string;
  };
  payments: {
    enabledGateways: PaymentGateway[];
  };
  features: {
    discussions: boolean;
    certificates: boolean;
    offlineDownload: boolean;
  };
}

export interface ConfigRevision {
  id: string;
  snapshot: PlatformConfig;
  actorName: string | null;
  appliedAt: string;
}

export interface ConfigRevisionsResponse {
  items: ConfigRevision[];
}

export type DataRequestType = "export" | "delete";
export type DataRequestStatus =
  | "pending_confirmation"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type DataRequestInitiator = "self" | "admin";

/** US-7.2.1 — GDPR request summary (learner view + admin view). */
export interface DataRequestSummary {
  id: string;
  type: DataRequestType;
  status: DataRequestStatus;
  initiatedBy: DataRequestInitiator;
  requestedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  downloadUrl: string | null;
  error: string | null;
}

export interface DataRequestListResponse {
  items: DataRequestSummary[];
}

export interface GdprActionResponse {
  request: DataRequestSummary;
  message: string;
}

export interface GdprConfirmResponse {
  status: DataRequestStatus;
  message: string;
  /** Present when an admin triggered the request on behalf of a learner. */
  administeredFor?: string | null;
}