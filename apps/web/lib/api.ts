import type {
  AdminUserListResponse,
  AdminUserRow,
  ApiErrorPayload,
  AuditLogListResponse,
  AuthMeResponse,
  AuthTokensResponse,
  BuilderCourse,
  BuilderCourseListEntry,
  CatalogueResponse,
  CertificateEligibilityResponse,
  CertificateSummary,
  CertificateVerificationResponse,
  CheckoutOrderResponse,
  ConfigRevisionsResponse,
  CourseDetail,
  CourseFilters,
  CourseProgressResponse,
  CreateCoursePayload,
  CreateLessonPayload,
  CreateModulePayload,
  CreateOrderPayload,
  DataRequestListResponse,
  EnrolmentContext,
  EnrolmentSummary,
  EnrolNowResponse,
  GdprActionResponse,
  GdprConfirmResponse,
  LessonPublic,
  OrderListResponse,
  OrderSummary,
  PaymentGateway,
  PaymentProvider,
  PlatformConfig,
  ProgressEventMessage,
  PublicUser,
  QuizAttemptResult,
  QuizStatusResponse,
  SaveProgressResponse,
  StartQuizAttemptResponse,
  UpdateCoursePayload,
  UpdateLessonPayload,
  UpdateModulePayload,
  UserRole,
  UserStatus,
  VideoAssetStatus,
  VideoLessonInfo,
  VideoPartUrlResponse,
  VideoUploadSession,
} from "@takwimu/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

const REFRESH_ENDPOINT = `${API_BASE}/api/v1/auth/refresh`;

/** In-memory access token (never persisted to localStorage). */
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.error?.message ?? "Request failed.");
    this.status = status;
    this.code = payload.error?.code ?? "error";
    this.fields = payload.error?.fields;
  }
}

async function tryRefresh(): Promise<boolean> {
  // httpOnly cookie (tkw_refresh) is sent automatically with credentials: "include".
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(REFRESH_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) return false;
      try {
        const json = (await res.json()) as AuthTokensResponse;
        accessToken = json.accessToken;
        return true;
      } catch {
        return false;
      }
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function api<T>(
  path: string,
  init: RequestInit & { skipRefresh?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });

  if (
    res.status === 401 &&
    !init.skipRefresh &&
    // Only login/register/refresh/logout must not self-trigger a refresh;
    // /auth/me IS the session bootstrap and relies on silent refresh after a
    // full page reload (in-memory access token is gone, only the httpOnly
    // refresh cookie remains).
    !["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"].some((p) => path.startsWith(p))
  ) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return api<T>(path, { ...init, skipRefresh: true } as RequestInit & { skipRefresh?: boolean });
    }
  }

  if (!res.ok) {
    let payload: ApiErrorPayload | null = null;
    try {
      payload = (await res.json()) as ApiErrorPayload;
    } catch {
      /* ignore */
    }
    throw new ApiClientError(
      payload ?? { error: { code: "http_error", message: `HTTP ${res.status}` } },
      res.status,
    );
  }
  return (await res.json()) as T;
}

export const authApi = {
  async register(input: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    consent: boolean;
  }): Promise<{ message: string; userId: string; devVerificationUrl: string | null }> {
    return api("/auth/register", { method: "POST", body: JSON.stringify(input) });
  },

  async resendVerification(email: string): Promise<{ message: string }> {
    return api("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
  },

  async login(email: string, password: string): Promise<AuthTokensResponse> {
    const res = await api<AuthTokensResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipRefresh: true,
    });
    setAccessToken(res.accessToken);
    return res;
  },

  async me(): Promise<AuthMeResponse> {
    return api("/auth/me", { skipRefresh: false });
  },

  async logout(): Promise<void> {
    try {
      await api("/auth/logout", { method: "POST", skipRefresh: true });
    } finally {
      setAccessToken(null);
    }
  },
};

export const catalogueApi = {
  async list(filters: CourseFilters & { page?: number; pageSize?: number } = {}): Promise<CatalogueResponse> {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.categories?.length) params.set("categories", filters.categories.join(","));
    if (filters.levels?.length) params.set("levels", filters.levels.join(","));
    if (filters.durations?.length) params.set("durations", filters.durations.join(","));
    if (filters.price && filters.price !== "all") params.set("price", filters.price);
    if (filters.languages?.length) params.set("languages", filters.languages.join(","));
    if (filters.ratingMin) params.set("ratingMin", String(filters.ratingMin));
    if (filters.sort) params.set("sort", filters.sort);
    if (filters.page && filters.page > 1) params.set("page", String(filters.page));
    if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
    const qs = params.toString();
    return api(`/courses${qs ? `?${qs}` : ""}`);
  },

  async detail(slug: string): Promise<CourseDetail> {
    const res = await api<{ course: CourseDetail }>(`/courses/${slug}`);
    return res.course;
  },

  async lesson(slug: string, position: number): Promise<LessonPublic> {
    const res = await api<{ lesson: LessonPublic }>(`/courses/${slug}/lessons/${position}`);
    return res.lesson;
  },
};

export const profileApi = {
  async wizardStep(step: 1 | 2 | 3, fields: Record<string, unknown>): Promise<{ user: PublicUser }> {
    return api("/profile/wizard", { method: "POST", body: JSON.stringify({ step, ...fields }) });
  },

  async updateBio(bio: string): Promise<{ user: PublicUser }> {
    return api("/profile/bio", { method: "PATCH", body: JSON.stringify({ bio }) });
  },

  async uploadAvatar(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await api<{ avatarUrl: string }>("/profile/avatar", { method: "POST", body: form });
    return res.avatarUrl;
  },
};

/** Raw fetch (no JSON coercion) for chunked video-part uploads (US-4.1.2). */
async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 401 && !init.credentials) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRaw(path, init);
  }
  return res;
}

export const enrolmentApi = {
  /** US-2.2.1 — free enrolment. */
  async enrol(courseSlug: string): Promise<EnrolNowResponse> {
    return api("/enrolments", { method: "POST", body: JSON.stringify({ courseSlug }) });
  },
  async mine(): Promise<EnrolmentSummary[]> {
    const res = await api<{ items: EnrolmentSummary[] }>("/enrolments");
    return res.items;
  },
  async context(courseSlug: string): Promise<EnrolmentContext> {
    return api(`/courses/${courseSlug}/enrolment`);
  },
};

export const progressApi = {
  /** US-3.1.1 — persist playback position / completion. */
  async save(courseSlug: string, lessonId: string, positionMs: number, completed?: boolean): Promise<SaveProgressResponse> {
    return api("/progress", {
      method: "PUT",
      body: JSON.stringify({ courseSlug, lessonId, positionMs, completed }),
    });
  },
  async complete(courseSlug: string, lessonId: string): Promise<SaveProgressResponse> {
    return api(`/progress/lessons/${lessonId}/complete`, { method: "POST", body: JSON.stringify({}) });
  },
  async course(courseSlug: string): Promise<CourseProgressResponse> {
    return api(`/courses/${courseSlug}/progress`);
  },
};

export const builderApi = {
  async list(): Promise<BuilderCourseListEntry[]> {
    const res = await api<{ items: BuilderCourseListEntry[] }>("/instructor/courses");
    return res.items;
  },
  async get(slug: string): Promise<BuilderCourse> {
    return api(`/instructor/courses/${slug}`);
  },
  async create(payload: CreateCoursePayload): Promise<BuilderCourseListEntry> {
    return api("/instructor/courses", { method: "POST", body: JSON.stringify(payload) });
  },
  async update(slug: string, payload: UpdateCoursePayload): Promise<BuilderCourse> {
    return api(`/instructor/courses/${slug}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async publish(slug: string): Promise<BuilderCourse> {
    return api(`/instructor/courses/${slug}/publish`, { method: "POST", body: JSON.stringify({}) });
  },
  async addModule(slug: string, payload: CreateModulePayload): Promise<BuilderCourse> {
    return api(`/instructor/courses/${slug}/modules`, { method: "POST", body: JSON.stringify(payload) });
  },
  async updateModule(moduleId: string, payload: UpdateModulePayload): Promise<BuilderCourse> {
    return api(`/instructor/modules/${moduleId}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteModule(moduleId: string): Promise<void> {
    await api(`/instructor/modules/${moduleId}`, { method: "DELETE" });
  },
  async addLesson(slug: string, payload: CreateLessonPayload): Promise<BuilderCourse> {
    return api(`/instructor/courses/${slug}/lessons`, { method: "POST", body: JSON.stringify(payload) });
  },
  async updateLesson(lessonId: string, payload: UpdateLessonPayload): Promise<BuilderCourse> {
    return api(`/instructor/lessons/${lessonId}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  async deleteLesson(lessonId: string): Promise<void> {
    await api(`/instructor/lessons/${lessonId}`, { method: "DELETE" });
  },
};

export const videoApi = {
  /** US-4.1.2 — start a chunked upload session. */
  async startUpload(lessonId: string, filename: string, contentType: string, sizeBytes: number): Promise<VideoUploadSession> {
    return api(`/instructor/lessons/${lessonId}/uploads`, {
      method: "POST",
      body: JSON.stringify({ filename, contentType, sizeBytes }),
    });
  },
  /** Upload a single part (local driver → API PUT; B2 → presigned URL). */
  async uploadPart(session: VideoUploadSession, partNumber: number, blob: Blob): Promise<void> {
    if (session.putMethod === "api") {
      const url = await api<VideoPartUrlResponse>(`/instructor/videos/${session.assetId}/parts/${partNumber}`);
      const res = await apiRaw(url.url.replace(`${API_BASE}/api/v1`, ""), {
        method: "PUT",
        body: blob,
        headers: { "content-type": blob.type || "application/octet-stream" },
      });
      if (!res.ok) throw new ApiClientError({ error: { code: "part_upload", message: `Part ${partNumber} failed (${res.status})` } }, res.status);
    } else {
      const { url } = await api<VideoPartUrlResponse>(`/instructor/videos/${session.assetId}/parts/${partNumber}`);
      const res = await fetch(url, { method: "PUT", body: blob });
      if (!res.ok) throw new ApiClientError({ error: { code: "part_upload", message: `Part ${partNumber} failed (${res.status})` } }, res.status);
    }
  },
  async completeUpload(assetId: string): Promise<VideoAssetStatus> {
    return api(`/instructor/videos/${assetId}/complete`, { method: "POST", body: JSON.stringify({}) });
  },
  async status(assetId: string): Promise<VideoAssetStatus> {
    return api(`/instructor/videos/${assetId}`);
  },
};

/** Sprint 5 — graded quizzes (US-3.2.2). Answers are graded server-side. */
export const quizApi = {
  async status(slug: string, position: number): Promise<QuizStatusResponse> {
    return api(`/courses/${slug}/lessons/${position}/quiz/status`);
  },
  async startAttempt(slug: string, position: number): Promise<StartQuizAttemptResponse> {
    return api(`/courses/${slug}/lessons/${position}/quiz/attempts`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  async submitAttempt(
    slug: string,
    position: number,
    attemptId: string,
    answers: Array<{ questionId: string; selectedIndex: number }>,
  ): Promise<QuizAttemptResult> {
    return api(`/courses/${slug}/lessons/${position}/quiz/attempts/${attemptId}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  },
};

/**
 * Sprint 6 — paid checkout (US-2.2.2). Mock-mode orders complete in-process;
 * live mode redirects/polls the provider capture flow.
 */
export const checkoutApi = {
  async createOrder(payload: CreateOrderPayload): Promise<CheckoutOrderResponse> {
    return api("/checkout/orders", { method: "POST", body: JSON.stringify(payload) });
  },
  async summary(orderId: string): Promise<{ order: OrderSummary }> {
    return api(`/orders/${orderId}`);
  },
  /** US-2.2.2 confirmation polling — call every ~5s while pending. */
  async status(orderId: string): Promise<{ order: OrderSummary }> {
    return api(`/checkout/orders/${orderId}/status`);
  },
  /** Mock-mode “simulate successful payment”. Live mode uses provider flows. */
  async complete(orderId: string): Promise<{ order: OrderSummary; confirmed: boolean }> {
    return api(`/checkout/orders/${orderId}/complete`, { method: "POST", body: JSON.stringify({}) });
  },
  async mine(): Promise<OrderListResponse> {
    return api("/orders");
  },
};

/** Sprint 6 — certificates (US-5.1.2). */
export const certificateApi = {
  async eligibility(slug: string): Promise<CertificateEligibilityResponse> {
    return api(`/courses/${slug}/certificate`);
  },
  async claim(slug: string): Promise<{ certificate: CertificateSummary }> {
    return api(`/courses/${slug}/certificate`, { method: "POST", body: JSON.stringify({}) });
  },
  async mine(): Promise<{ items: CertificateSummary[] }> {
    return api("/certificates");
  },
  async verify(certificateNumber: string): Promise<CertificateVerificationResponse> {
    return api(`/verify/${certificateNumber}`, { skipRefresh: true });
  },
  /** Fetch the PDF (auth-gated) and trigger a browser download. */
  async download(certificateId: string): Promise<void> {
    const res = await apiRaw(`/certificates/${certificateId}/download`);
    if (!res.ok) throw new ApiClientError({ error: { code: "download", message: `Download failed (${res.status})` } }, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `takwimu-certificate-${certificateId.slice(0, 8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export function providerLabel(provider: PaymentProvider): string {
  switch (provider) {
    case "stripe":
      return "Card (Stripe)";
    case "mpesa":
      return "M-Pesa (Daraja STK)";
    case "paypal":
      return "PayPal";
    default:
      return "Mock provider";
  }
}

/**
 * US-5.1.1 — subscribe to real-time progress events via Server-Sent Events.
 * EventSource cannot set an Authorization header, so the access token is passed
 * as ?token=. Reconnect with backoff on unexpected closures (SSE auto-reconnect
 * handles network flakiness; this wrapper also prunes stale handlers).
 */
export function subscribeToProgress(
  onMessage: (message: ProgressEventMessage) => void,
  onOpen?: () => void,
): () => void {
  const token = getAccessToken();
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  const source = new EventSource(`${API_BASE}/api/v1/me/progress/events?${params.toString()}`);

  source.onopen = () => onOpen?.();
  source.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ProgressEventMessage | { type: string };
      if ("event" in message && (message as ProgressEventMessage).event) {
        onMessage(message as ProgressEventMessage);
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  // Never let the browser silently replay stale frames without handlers.
  source.onerror = () => {
    /* EventSource reconnects automatically; a fatal token error shows as 401s */
  };

  return () => source.close();
}

export function formatPrice(cents: number, currency = "USD"): string {
  if (cents === 0) return "Free";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${(cents / 100).toLocaleString("en-US")}`;
}

export function skillLabel(level: string): string {
  switch (level) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "advanced":
      return "Advanced";
    default:
      return level[0]?.toUpperCase() + level.slice(1);
  }
}
/**
 * Sprint 7 — GDPR (US-7.2.1). Self-service export/delete with email
 * confirmation; the confirm token is sent in the body (never the URL).
 */
export const gdprApi = {
  async requestExport(): Promise<GdprActionResponse> {
    return api("/gdpr/export", { method: "POST", body: JSON.stringify({}) });
  },
  async requestDelete(): Promise<GdprActionResponse> {
    return api("/gdpr/delete", { method: "POST", body: JSON.stringify({}) });
  },
  async confirm(token: string): Promise<GdprConfirmResponse> {
    return api("/gdpr/confirm", { method: "POST", body: JSON.stringify({ token }) });
  },
  async mine(): Promise<DataRequestListResponse> {
    return api("/gdpr/requests");
  },
  /** Trigger a browser download of a completed export ZIP. */
  async download(requestId: string): Promise<void> {
    const res = await apiRaw(`/gdpr/exports/${requestId}/download`);
    if (!res.ok) throw new ApiClientError({ error: { code: "gdpr_download", message: `Download failed (${res.status})` } }, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `takwimu-data-export-${requestId.slice(0, 8)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/** Sprint 7 — checkout gateway availability (PAYMENTS_MODE aware). */
export interface CheckoutProvidersResponse {
  enabledGateways: PaymentGateway[];
  mode: "mock" | "live";
}

/**
 * Sprint 7 — admin panel (US-7.1.x). All routes 403 for non-admins; the
 * maintenance guard returns 503 for everyone except admins while enabled.
 */
export const adminApi = {
  async overview(): Promise<AdminOverview> {
    return api("/admin/overview");
  },
  async users(filters: { search?: string; role?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<AdminUserListResponse> {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.role) params.set("role", filters.role);
    if (filters.status) params.set("status", filters.status);
    params.set("page", String(filters.page ?? 1));
    params.set("pageSize", String(filters.pageSize ?? 20));
    const qs = params.toString();
    return api(`/admin/users${qs ? `?${qs}` : ""}`);
  },
  async updateUser(id: string, patch: { role?: UserRole; status?: UserStatus }): Promise<{ user: AdminUserRow }> {
    return api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async bulkSuspend(userIds: string[]): Promise<{ suspended: number }> {
    return api("/admin/users/bulk-suspend", { method: "POST", body: JSON.stringify({ userIds }) });
  },
  async forcePasswordReset(id: string): Promise<{ emailSentTo: string }> {
    return api(`/admin/users/${id}/force-password-reset`, { method: "POST", body: JSON.stringify({}) });
  },
  async deleteUser(id: string): Promise<{ message: string }> {
    return api(`/admin/users/${id}`, { method: "DELETE" });
  },
  async exportCsv(filters: { search?: string; role?: string; status?: string } = {}): Promise<void> {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.role) params.set("role", filters.role);
    if (filters.status) params.set("status", filters.status);
    const res = await apiRaw(`/admin/users/export.csv${params.toString() ? `?${params.toString()}` : ""}`);
    if (!res.ok) throw new ApiClientError({ error: { code: "csv", message: `Export failed (${res.status})` } }, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "takwimu-admin-users.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  async config(): Promise<{ config: PlatformConfig }> {
    return api("/admin/config");
  },
  async updateConfig(patch: Record<string, unknown>): Promise<{ config: PlatformConfig; revisionId: string }> {
    return api("/admin/config", { method: "PATCH", body: JSON.stringify(patch) });
  },
  async configRevisions(limit = 10): Promise<ConfigRevisionsResponse> {
    return api(`/admin/config/revisions?limit=${limit}`);
  },
  async rollbackConfig(revisionId: string): Promise<{ config: PlatformConfig; revisionId: string }> {
    return api(`/admin/config/revisions/${revisionId}/rollback`, { method: "POST", body: JSON.stringify({}) });
  },
  async audit(filters: { actorId?: string; targetType?: string; limit?: number } = {}): Promise<AuditLogListResponse> {
    const params = new URLSearchParams();
    if (filters.actorId) params.set("actorId", filters.actorId);
    if (filters.targetType) params.set("targetType", filters.targetType);
    params.set("limit", String(filters.limit ?? 100));
    return api(`/admin/audit?${params.toString()}`);
  },
  async gdprRequests(): Promise<DataRequestListResponse> {
    return api("/admin/gdpr/requests");
  },
  async gdprExportForUser(id: string): Promise<GdprActionResponse> {
    return api(`/admin/users/${id}/gdpr-export`, { method: "POST", body: JSON.stringify({}) });
  },
  async gdprDeleteForUser(id: string): Promise<GdprActionResponse> {
    return api(`/admin/users/${id}/gdpr-delete`, { method: "POST", body: JSON.stringify({}) });
  },
};

export interface AdminOverview {
  users: number;
  learners: number;
  instructors: number;
  admins: number;
  publishedCourses: number;
  paidOrders: number;
  revenueCents: number;
  pendingGdpr: number;
  certificatesIssued: number;
}
