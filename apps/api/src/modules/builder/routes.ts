import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addLesson,
  addModule,
  createCourse,
  deleteLesson,
  deleteModule,
  getBuilderCourse,
  listMyBuilderCourses,
  publishCourse,
  updateCourse,
  updateLesson,
  updateModule,
} from "./service";

const createCourseSchema = z.object({
  title: z.string().min(3).max(200),
  tagline: z.string().max(400).optional(),
  category: z.string().min(1).max(80),
  skillLevel: z.enum(["beginner", "intermediate", "advanced"]),
  durationWeeks: z.number().int().min(0).max(104).optional(),
  priceCents: z.number().int().min(0).max(10_000_000).optional(),
});

const updateCourseSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    tagline: z.string().max(400).optional(),
    description: z.string().max(20_000).optional(),
    objectives: z.array(z.string()).max(50).optional(),
    category: z.string().min(1).max(80).optional(),
    skillLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    durationWeeks: z.number().int().min(0).max(104).optional(),
    priceCents: z.number().int().min(0).max(10_000_000).optional(),
    certificationLabel: z.string().max(120).nullable().optional(),
    previewVideoUrl: z.string().max(500).nullable().optional(),
  })
  .partial();

const moduleSchema = z.object({
  title: z.string().min(1).max(200),
  week: z.number().int().min(1).max(52).nullable().optional(),
  hoursEstimate: z.number().int().min(0).max(200).nullable().optional(),
  examCoverage: z.string().max(120).nullable().optional(),
  hook: z.string().max(2000).optional(),
  objectives: z.array(z.string()).max(50).optional(),
});

const lessonSchema = z.object({
  moduleId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).optional(),
  kind: z.enum(["text", "video", "notebook", "lab", "quiz"]).optional(),
  content: z.string().max(200_000).optional(),
  published: z.boolean().optional(),
});

const updateLessonSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    summary: z.string().max(1000).optional(),
    content: z.string().max(200_000).optional(),
    contentJson: z.record(z.unknown()).optional(),
    kind: z.enum(["text", "video", "notebook", "lab", "quiz"]).optional(),
    published: z.boolean().optional(),
  })
  .partial();

export function registerBuilderRoutes(app: FastifyInstance) {
  // ── US-4.1.1 course builder workspace ─────────────────────
  app.get(
    "/instructor/courses",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send({ items: await listMyBuilderCourses(req.userId, req.userRole) });
    },
  );

  app.post(
    "/instructor/courses",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = createCourseSchema.parse(req.body);
      const created = await createCourse(req.userId, req.userRole, payload);
      return reply.code(201).send(created);
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/instructor/courses/:slug",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send(await getBuilderCourse(req.userId, req.userRole, req.params.slug));
    },
  );

  app.patch<{ Params: { slug: string } }>(
    "/instructor/courses/:slug",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = updateCourseSchema.parse(req.body);
      return reply.send(await updateCourse(req.userId, req.userRole, req.params.slug, payload));
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/instructor/courses/:slug/publish",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send(await publishCourse(req.userId, req.userRole, req.params.slug));
    },
  );

  // ── Modules ────────────────────────────────────────────────
  app.post<{ Params: { slug: string } }>(
    "/instructor/courses/:slug/modules",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = moduleSchema.parse(req.body);
      return reply.send(await addModule(req.userId, req.userRole, req.params.slug, payload));
    },
  );

  app.patch<{ Params: { moduleId: string } }>(
    "/instructor/modules/:moduleId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = moduleSchema.partial().parse(req.body);
      return reply.send(await updateModule(req.userId, req.userRole, req.params.moduleId, payload));
    },
  );

  app.delete<{ Params: { moduleId: string } }>(
    "/instructor/modules/:moduleId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      await deleteModule(req.userId, req.userRole, req.params.moduleId);
      return reply.send({ ok: true });
    },
  );

  // ── Lessons ────────────────────────────────────────────────
  app.post<{ Params: { slug: string } }>(
    "/instructor/courses/:slug/lessons",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = lessonSchema.parse(req.body);
      return reply.send(await addLesson(req.userId, req.userRole, req.params.slug, payload));
    },
  );

  app.patch<{ Params: { lessonId: string } }>(
    "/instructor/lessons/:lessonId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = updateLessonSchema.parse(req.body);
      return reply.send(await updateLesson(req.userId, req.userRole, req.params.lessonId, payload));
    },
  );

  app.delete<{ Params: { lessonId: string } }>(
    "/instructor/lessons/:lessonId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      await deleteLesson(req.userId, req.userRole, req.params.lessonId);
      return reply.send({ ok: true });
    },
  );
}