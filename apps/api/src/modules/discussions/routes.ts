import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CreateDiscussionPostPayload, ModerateDiscussionPostPayload } from "@takwimu/shared";
import {
  createPost,
  editPost,
  listThread,
  moderatePost,
  searchPosts,
  toggleVote,
} from "./service";

// ─────────────────────────────────────────────────────────────
// US-6.1.1 — Course discussion forum API
// ─────────────────────────────────────────────────────────────

const createPostSchema = z
  .object({
    body: z.string().min(1).max(4000),
    parentId: z.string().uuid().optional(),
  })
  .strict();

const editPostSchema = z
  .object({ body: z.string().min(1).max(4000) })
  .strict();

const moderateSchema = z
  .object({
    action: z.enum(["hide", "unhide", "delete"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export function registerDiscussionRoutes(app: FastifyInstance) {
  // ── Thread (posts + nested replies, top-voted reply pinned) ──
  app.get<{ Params: { lessonId: string } }>(
    "/discussions/lessons/:lessonId",
    { preHandler: [app.authenticate] },
    async (req) => listThread(req.params.lessonId, req.userId, req.userRole),
  );

  app.post<{ Params: { lessonId: string } }>(
    "/discussions/lessons/:lessonId/posts",
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = createPostSchema.parse(req.body) as CreateDiscussionPostPayload;
      return createPost(req.userId, req.userRole, req.params.lessonId, body);
    },
  );

  app.post<{ Params: { postId: string } }>(
    "/discussions/posts/:postId/vote",
    { preHandler: [app.authenticate] },
    async (req) => toggleVote(req.userId, req.params.postId),
  );

  app.patch<{ Params: { postId: string } }>(
    "/discussions/posts/:postId",
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = editPostSchema.parse(req.body);
      return editPost(req.userId, req.params.postId, body.body);
    },
  );

  // US-6.1.1 moderation — admin/instructor only; reason logged (service).
  app.post<{ Params: { postId: string } }>(
    "/discussions/posts/:postId/moderation",
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = moderateSchema.parse(req.body) as ModerateDiscussionPostPayload;
      return moderatePost(req.userId, req.userRole, req.params.postId, body);
    },
  );

  // Posts searchable within course context.
  app.get<{ Params: { courseId: string } }>(
    "/discussions/courses/:courseId/search",
    { preHandler: [app.authenticate] },
    async (req) => {
      const { q } = req.query as { q?: string };
      return searchPosts(req.params.courseId, req.userId, req.userRole, q ?? "");
    },
  );
}