import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { enrolments, lessons } from "../../db/schema";
import { forbidden, notFound } from "../../lib/errors";
import { getStorage, mediaContentType } from "../../storage/storage";

/**
 * US-3.1.1 — same-origin HLS streaming proxy.
 *
 * The course builder stores HLS output under a private "course-assets" bucket
 * (B2 in prod / local disk in dev). Instead of handing learners raw B2 URLs
 * (which would leak object keys and bypass access control), the player talks
 * to /api/v1/media/hls/:courseId/:lessonId/* and we:
 *   1. gate on enrolment, and
 *   2. stream manifest + segments with proper Range support for .ts.
 */
export function registerMediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { courseId: string; lessonId: string; rest: string } }>(
    "/media/hls/:courseId/:lessonId/*",
    async (req, reply) => {
      const { courseId, lessonId } = req.params;
      const relPath = req.params.rest ?? "";

      if (req.userId) {
        const { db } = getDb(loadEnv().DATABASE_URL);
        const enrolled = await db
          .select({ id: enrolments.id })
          .from(enrolments)
          .where(and(eq(enrolments.userId, req.userId), eq(enrolments.courseId, courseId)))
          .limit(1);
        if (enrolled.length === 0) throw forbidden("Enrol in the course to watch this video.");
      } else {
        throw forbidden("Log in and enrol to watch this video.");
      }

      const { db } = getDb(loadEnv().DATABASE_URL);
      const [lesson] = await db
        .select({ hlsPrefix: lessons.hlsPrefix })
        .from(lessons)
        .where(and(eq(lessons.id, lessonId), eq(lessons.courseId, courseId)))
        .limit(1);
      if (!lesson?.hlsPrefix) throw notFound("Video not available.");

      const storage = getStorage();
      const fullKey = `${lesson.hlsPrefix}/${relPath}`;
      const contentType = mediaContentType(relPath);

      const rangeHeader = req.headers.range;
      if (rangeHeader && relPath.endsWith(".ts")) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (m) {
          const start = Number(m[1]);
          const end = m[2] ? Number(m[2]) : undefined;
          const size = await storage.objectSize(fullKey, "course-assets");
          if (size === 0) throw notFound("Segment not found.");
          const to = Math.min(end ?? size - 1, size - 1);
          if (start > to) {
            return reply.status(416).headers({ "Content-Range": `bytes */${size}` }).send();
          }
          const part = await storage.readObjectRange(fullKey, "course-assets", start, to);
          if (!part) throw notFound("Segment not found.");
          return reply
            .status(206)
            .headers({
              "Content-Type": contentType,
              "Content-Length": part.data.byteLength,
              "Content-Range": `bytes ${start}-${to}/${size}`,
              "Accept-Ranges": "bytes",
              "Cache-Control": "public, max-age=86400",
            })
            .send(part.data);
        }
      }

      const obj = await storage.readObject(fullKey, "course-assets");
      if (!obj) throw notFound("Object not found.");
      const cache = relPath.endsWith(".ts") ? "public, max-age=86400" : "no-store";
      return reply
        .headers({
          "Content-Type": contentType,
          "Content-Length": obj.data.byteLength,
          "Accept-Ranges": "bytes",
          "Cache-Control": cache,
        })
        .send(obj.data);
    },
  );
}