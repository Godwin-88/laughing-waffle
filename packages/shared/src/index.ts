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
}