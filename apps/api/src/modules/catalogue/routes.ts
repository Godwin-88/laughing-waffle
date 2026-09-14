import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { catalogueSearch, getCourseDetail, getLessonByPosition } from "./service";
import { notFound } from "../../lib/errors";

const querySchema = z.object({
  q: z.string().max(200).optional().default(""),
  categories: z.string().optional(),
  levels: z.string().optional(),
  durations: z.string().optional(),
  price: z.enum(["free", "paid", "all"]).optional().default("all"),
  languages: z.string().optional(),
  ratingMin: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(["rating", "newest", "price_asc", "price_desc", "relevance"]).optional().default("newest"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).optional().default(12),
});

function csv(value?: string): string[] {
  return value?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
}

export function registerCatalogueRoutes(app: FastifyInstance) {
  app.get("/courses", async (req, reply) => {
    const q = querySchema.parse(req.query);
    const result = await catalogueSearch({
      q: q.q || null,
      categories: csv(q.categories),
      levels: csv(q.levels),
      durations: csv(q.durations),
      price: q.price,
      languages: csv(q.languages),
      ratingMin: q.ratingMin ?? 0,
      sort: q.sort,
      page: q.page,
      pageSize: q.pageSize,
      userId: req.userId,
    });
    return reply.send(result);
  });

  app.get<{ Params: { slug: string } }>("/courses/:slug", async (req, reply) => {
    const detail = await getCourseDetail(req.params.slug, req.userId);
    if (!detail) throw notFound("Course not found.");
    return reply.send({ course: detail });
  });

  app.get<{ Params: { slug: string; position: string } }>(
    "/courses/:slug/lessons/:position",
    async (req, reply) => {
      const position = Number(req.params.position);
      const lesson = await getLessonByPosition(req.params.slug, position, req.userId ?? null);
      if (!lesson) throw notFound("Lesson not found.");
      return reply.send({ lesson });
    },
  );
}