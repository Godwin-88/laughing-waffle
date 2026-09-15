import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AnnouncementPayload, AnnouncementResult, MarkNotificationsReadPayload } from "@takwimu/shared";
import { eq } from "drizzle-orm";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses } from "../../db/schema";
import { forbidden, notFound } from "../../lib/errors";
import {
  getPreferences,
  listNotifications,
  markRead,
  notifyAnnouncement,
  unreadCount,
  updatePreferences,
} from "./service";

// ─────────────────────────────────────────────────────────────
// US-10.1.1 — In-app + email notifications API
// ─────────────────────────────────────────────────────────────

const Z_PREFS = z
  .object({
    discussionReply: z.boolean().optional(),
    assignmentGraded: z.boolean().optional(),
    courseContentAdded: z.boolean().optional(),
    certificateIssued: z.boolean().optional(),
    paymentReceipt: z.boolean().optional(),
    streakReminder: z.boolean().optional(),
    instructorAnnouncement: z.boolean().optional(),
    marketing: z.boolean().optional(),
  })
  .strict();

export function registerNotificationRoutes(app: FastifyInstance) {
  app.get("/notifications", { preHandler: [app.authenticate] }, async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return listNotifications(req.userId, limit);
  });

  app.get("/notifications/unread-count", { preHandler: [app.authenticate] }, async (req) => unreadCount(req.userId));

  app.post("/notifications/read", { preHandler: [app.authenticate] }, async (req) => {
    const body = z
      .object({ ids: z.array(z.string().uuid()).optional() })
      .parse(req.body) as MarkNotificationsReadPayload;
    return markRead(req.userId, body.ids);
  });

  app.post("/notifications/read-all", { preHandler: [app.authenticate] }, async (req) => markRead(req.userId));

  app.get("/notifications/preferences", { preHandler: [app.authenticate] }, async (req) => ({
    preferences: await getPreferences(req.userId),
  }));

  app.patch("/notifications/preferences", { preHandler: [app.authenticate] }, async (req) => {
    const patch = Z_PREFS.parse(req.body);
    return { preferences: await updatePreferences(req.userId, patch) };
  });

  // Instructor/admin → all enrolled learners (US-10.1.1 “instructor announcement”).
  app.post<{ Params: { slug: string } }>(
    "/courses/:slug/announcements",
    { preHandler: [app.authenticate] },
    async (req) => {
      const payload = z
        .object({ title: z.string().min(3).max(120), body: z.string().min(1).max(2000), link: z.string().max(255).optional() })
        .parse(req.body) as AnnouncementPayload;
      const { db } = getDb(loadEnv().DATABASE_URL);
      const [course] = await db.select().from(courses).where(eq(courses.slug, req.params.slug)).limit(1);
      if (!course) throw notFound("Course not found.");
      if (course.instructorId !== req.userId && req.userRole !== "admin") {
        throw forbidden("Only the course instructor (or an admin) can send announcements.");
      }
      await notifyAnnouncement({
        courseId: course.id,
        courseSlug: course.slug,
        authorId: req.userId,
        title: payload.title,
        body: payload.body,
        link: payload.link,
      });
      return { sent: 1 } as AnnouncementResult;
    },
  );
}

export function registerNotificationPreferencesRoute(app: FastifyInstance) {
  app.get("/notifications/unsubscribe", async (req, reply) => {
    const userId = (req.query as { userId?: string }).userId;
    if (!userId) throw notFound("Missing user id.");
    await updatePreferences(userId, {
      discussionReply: false,
      assignmentGraded: false,
      courseContentAdded: false,
      certificateIssued: false,
      paymentReceipt: false,
      streakReminder: false,
      instructorAnnouncement: false,
      marketing: false,
    });
    return reply.status(200).send({ unsubscribed: true });
  });
}