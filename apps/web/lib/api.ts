import type {
  ApiErrorPayload,
  AuthMeResponse,
  AuthTokensResponse,
  CatalogueResponse,
  CourseDetail,
  CourseFilters,
  LessonPublic,
  PublicUser,
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

  if (res.status === 401 && !init.skipRefresh && !path.startsWith("/auth/")) {
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
