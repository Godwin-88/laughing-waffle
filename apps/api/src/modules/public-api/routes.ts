import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { oauthClients } from "../../db/schema";
import { forbidden, tooManyRequests, unauthorized } from "../../lib/errors";
import { checkClientRateLimit } from "../../lib/rate-limit";
import { verifyM2mToken } from "../oauth/service";
import { catalogueSearch, getCourseDetail } from "../catalogue/service";

/**
 * US-8.1.1 — External course catalogue API.
 * OAuth 2.0 client-credentials protected, per-key rate limited
 * (1,000 req/hour default → 429 + Retry-After), field selection supported.
 */

export const PUBLIC_FIELDS = [
  "id",
  "slug",
  "title",
  "tagline",
  "description",
  "instructor",
  "durationWeeks",
  "skillLevel",
  "category",
  "languages",
  "priceCents",
  "currency",
  "rating",
  "ratingCount",
  "tags",
  "coverImageUrl",
  "certificationLabel",
  "enrolled",
] as const;

const querySchema = z.object({
  q: z.string().max(200).optional(),
  categories: z.string().optional(),
  levels: z.string().optional(),
  durations: z.string().optional(),
  price: z.enum(["free", "paid", "all"]).optional().default("all"),
  languages: z.string().optional(),
  ratingMin: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(["rating", "newest", "price_asc", "price_desc", "relevance"]).optional().default("newest"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).optional().default(12),
  fields: z.string().optional(),
});

function csv(value?: string): string[] {
  return value?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
}

function splitFields(raw?: string): string[] {
  if (!raw) return [];
  const allowed = new Set<string>(PUBLIC_FIELDS);
  return csv(raw).filter((f) => allowed.has(f));
}

function project<T extends object>(obj: T, fields: string[]): Partial<T> {
  if (fields.length === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) out[f] = (obj as Record<string, unknown>)[f];
  }
  return out as Partial<T>;
}

async function authPublicApiHook(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    throw unauthorized("OAuth2 client-credentials token required.", "unauthorized");
  }
  let clientId: string;
  let scope: string;
  try {
    const claims = await verifyM2mToken(header.slice(7));
    clientId = claims.clientId;
    scope = claims.scope;
  } catch {
    throw unauthorized("Invalid or expired OAuth token.", "unauthorized");
  }
  if (!scope.split(" ").some((s) => s === "catalogue:read" || s === "catalogue:*")) {
    throw forbidden("Scope does not include catalogue:read.", "insufficient_scope");
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [client] = await db
    .select({ status: oauthClients.status })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!client || client.status !== "active") {
    throw unauthorized("OAuth client has been revoked.", "unauthorized");
  }
}

async function rateLimitPublicApiHook(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return;
  try {
    const claims = await verifyM2mToken(header.slice(7));
    const limit = loadEnv().PUBLIC_API_RATE_LIMIT_PER_HOUR;
    const decision = await checkClientRateLimit(claims.clientId, limit);
    if (!decision.allowed) {
      throw tooManyRequests(
        `Rate limit of ${limit} requests/hour exceeded. Retry after ${decision.retryAfterSeconds}s.`,
        "rate_limit_exceeded",
        { "Retry-After": String(decision.retryAfterSeconds) },
      );
    }
  } catch {
    return;
  }
}

export function registerPublicApiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authPublicApiHook);
  app.addHook("preHandler", rateLimitPublicApiHook);

  app.get<{ Querystring: Record<string, unknown> }>("/courses", async (req, reply) => {
    const raw = querySchema.parse(req.query);
    const fields = splitFields(raw.fields);
    const result = await catalogueSearch({
      q: raw.q || null,
      categories: csv(raw.categories),
      levels: csv(raw.levels),
      durations: csv(raw.durations),
      price: raw.price,
      languages: csv(raw.languages),
      ratingMin: raw.ratingMin ?? 0,
      sort: raw.sort,
      page: raw.page,
      pageSize: raw.pageSize,
      userId: null,
    });
    return reply.send({
      ...result,
      items: result.items.map((c) => project(c as unknown as Record<string, unknown>, fields)),
    });
  });

  app.get<{ Params: { slug: string }; Querystring: { fields?: string } }>(
    "/courses/:slug",
    async (req, reply) => {
      const fields = splitFields(req.query.fields);
      const detail = await getCourseDetail(req.params.slug, null);
      if (!detail) return reply.code(404).send({ error: "not_found", message: "Course not found." });
      const course: Record<string, unknown> = { ...detail, syllabus: undefined };
      return reply.send({ course: project(course, fields) });
    },
  );
}
