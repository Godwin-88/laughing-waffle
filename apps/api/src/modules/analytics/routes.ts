import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest } from "../../lib/errors";
import { getLearnerAnalytics, recordActivityHeartbeat } from "./service";

const heartbeatSchema = z.object({
  kind: z.enum(["lesson", "video", "quiz", "discussion"]),
  courseId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  seconds: z.coerce.number().min(0).max(3600),
});

/** US-9.1.1 — learner analytics dashboard (auth-gated). */
export function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get("/analytics/dashboard", { preHandler: [app.authenticate] }, async (req) => {
    return getLearnerAnalytics(req.userId);
  });

  app.post<{ Body: unknown }>("/analytics/heartbeat", { preHandler: [app.authenticate] }, async (req) => {
    const body = heartbeatSchema.parse(req.body ?? {});
    if (body.seconds <= 0) throw badRequest("seconds must be greater than zero.");
    return recordActivityHeartbeat({
      userId: req.userId,
      kind: body.kind,
      courseId: body.courseId ?? null,
      lessonId: body.lessonId ?? null,
      seconds: body.seconds,
    });
  });
}