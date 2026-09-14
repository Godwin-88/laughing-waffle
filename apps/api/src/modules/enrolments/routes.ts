import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  enrolFree,
  getCourseProgress,
  getEnrolmentContext,
  listMyEnrolments,
  markLessonComplete,
  saveProgress,
} from "./service";
import { notFound } from "../../lib/errors";

const enrolSchema = z.object({ courseSlug: z.string().min(2).max(200) });

const progressSchema = z.object({
  courseSlug: z.string().min(2).max(200),
  lessonId: z.string().uuid(),
  positionMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  completed: z.boolean().optional(),
});

export function registerEnrolmentRoutes(app: FastifyInstance) {
  // ── US-2.2.1 free enrolment ────────────────────────────────
  app.post(
    "/enrolments",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { courseSlug } = enrolSchema.parse(req.body);
      const result = await enrolFree(req.userId, courseSlug);
      return reply.send(result);
    },
  );

  app.get(
    "/enrolments",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const items = await listMyEnrolments(req.userId);
      return reply.send({ items });
    },
  );

  app.get<{ Params: { slug: string } }>("/courses/:slug/enrolment", async (req, reply) => {
    const ctx = await getEnrolmentContext(req.userId ?? null, req.params.slug);
    if (!ctx) throw notFound("Course not found.");
    return reply.send(ctx);
  });

  // ── US-3.1.1 playback position ─────────────────────────────
  app.put(
    "/progress",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = progressSchema.parse(req.body);
      const result = await saveProgress(req.userId, body);
      return reply.send(result);
    },
  );

  app.post<{ Params: { lessonId: string } }>(
    "/progress/lessons/:lessonId/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await markLessonComplete(req.userId, req.params.lessonId);
      return reply.send(result);
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/courses/:slug/progress",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await getCourseProgress(req.userId, req.params.slug);
      if (!result) throw notFound("Course not found.");
      return reply.send(result);
    },
  );
}