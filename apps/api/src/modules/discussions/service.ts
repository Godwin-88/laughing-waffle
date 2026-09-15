import { and, asc, desc, eq, ilike } from "drizzle-orm";
import type {
  CreateDiscussionPostPayload,
  DiscussionPost,
  DiscussionSearchResponse,
  DiscussionThreadResponse,
  ModerateDiscussionPostPayload,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, discussionPosts, discussionVotes, enrolments, lessons, users } from "../../db/schema";
import { emitAnalyticsEvent } from "../../lib/events";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { getConfig } from "../../lib/config";
import { notifyDiscussionReply } from "../notifications/service";

// ─────────────────────────────────────────────────────────────
// US-6.1.1 — Post and reply in course discussions
// • Thread per lesson; top-level + nested replies (<=3 levels)
// • Instructor posts visually distinguished (badge/colour)
// • Upvote system; top-voted reply pinned below the question
// • Learner notified (email + in-app) when their post gets a reply
// • Moderation: admin/instructor hide or delete with logged reason
// • Posts searchable within course context
// ─────────────────────────────────────────────────────────────

export const MAX_BODY_LENGTH = 4000;
/** Root(0) + reply(1) + reply(2) — threads are capped at 3 levels. */
export const MAX_REPLY_DEPTH = 2;

type Role = "learner" | "instructor" | "admin";

/** Narrow a raw JWT `role` claim (string) to the service union. */
function toRole(role: string): Role {
  return role === "admin" || role === "instructor" ? role : "learner";
}

async function assertDiscussionsEnabled() {
  const cfg = await getConfig();
  if (!cfg.features.discussions) {
    throw serviceUnavailable("Discussions are currently disabled on this platform.", "feature_disabled");
  }
}

async function loadLesson(lessonId: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ id: lessons.id, courseId: lessons.courseId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  return rows[0] ?? null;
}

/** Returns true when an admin, the course instructor, or an enrolled learner. */
async function assertThreadAccess(courseId: string, userId: string, role: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  if (role === "admin") return;
  const enrolled = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, courseId)))
    .limit(1);
  if (enrolled.length > 0) return;
  const [course] = await db.select({ instructorId: courses.instructorId }).from(courses).where(eq(courses.id, courseId)).limit(1);
  if (course && course.instructorId === userId) return;
  if (role === "instructor") {
    // An instructor who neither owns nor is enrolled in the course cannot peek.
    throw forbidden("Only learners enrolled in this course, its instructor, or admins can access discussions.");
  }
  throw forbidden("Enrol in this course to join the discussion.");
}

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

interface PostRow {
  id: string;
  courseId: string;
  lessonId: string;
  parentId: string | null;
  depth: number;
  authorId: string;
  body: string;
  upvoteCount: number;
  status: string;
  moderationReason: string | null;
  editedAt: Date | null;
  createdAt: Date;
  authorFirstName: string;
  authorLastName: string;
  authorRole: string;
}

async function isModerator(courseId: string, userId: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [course] = await db.select({ instructorId: courses.instructorId }).from(courses).where(eq(courses.id, courseId)).limit(1);
  return course?.instructorId === userId;
}

function authorName(row: PostRow): string {
  return [row.authorFirstName, row.authorLastName].filter(Boolean).join(" ") || "Learner";
}

function toPost(row: PostRow, viewerVoted: boolean, moderator: boolean): DiscussionPost {
  const role = toRole(row.authorRole);
  return {
    id: row.id,
    courseId: row.courseId,
    lessonId: row.lessonId,
    parentId: row.parentId,
    depth: row.depth,
    author: {
      id: row.authorId,
      name: authorName(row),
      role,
      instructorBadge: role === "instructor" || role === "admin",
    },
    body: row.body,
    upvoteCount: row.upvoteCount,
    userVoted: viewerVoted,
    status: row.status as "visible" | "hidden",
    moderationReason: row.moderationReason,
    edited: row.editedAt !== null,
    createdAt: row.createdAt.toISOString(),
    replies: [],
  };
}

export async function listThread(
  lessonId: string,
  viewerId: string,
  viewerRole: string,
): Promise<DiscussionThreadResponse> {
  await assertDiscussionsEnabled();
  const lesson = await loadLesson(lessonId);
  if (!lesson) throw notFound("Lesson not found.");
  await assertThreadAccess(lesson.courseId, viewerId, viewerRole);
  const moderator = await isModerator(lesson.courseId, viewerId, viewerRole);

  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      id: discussionPosts.id,
      courseId: discussionPosts.courseId,
      lessonId: discussionPosts.lessonId,
      parentId: discussionPosts.parentId,
      depth: discussionPosts.depth,
      authorId: discussionPosts.authorId,
      body: discussionPosts.body,
      upvoteCount: discussionPosts.upvoteCount,
      status: discussionPosts.status,
      moderationReason: discussionPosts.moderationReason,
      editedAt: discussionPosts.editedAt,
      createdAt: discussionPosts.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorRole: users.role,
    })
    .from(discussionPosts)
    .innerJoin(users, eq(users.id, discussionPosts.authorId))
    .where(eq(discussionPosts.lessonId, lessonId))
    .orderBy(asc(discussionPosts.createdAt));

  const postIds = rows.map((r) => r.id);
  const votes = postIds.length
    ? await db.select({ postId: discussionVotes.postId }).from(discussionVotes).where(eq(discussionVotes.userId, viewerId))
    : [];
  const voted = new Set(votes.map((v) => v.postId));

  const all = rows.map((r) => toPost(r, voted.has(r.id), moderator));
  const visible = all.filter((p) => p.status === "visible" || p.author.id === viewerId || moderator);

  // Build the reply tree parented by post id. Replies are sorted so the
  // highest-voted answer is pinned directly beneath its parent.
  const byParent = new Map<string, DiscussionPost[]>();
  const roots: DiscussionPost[] = [];
  for (const post of visible) {
    if (post.parentId && visible.some((p) => p.id === post.parentId)) {
      const list = byParent.get(post.parentId) ?? [];
      list.push(post);
      byParent.set(post.parentId, list);
    } else {
      roots.push(post);
    }
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => b.upvoteCount - a.upvoteCount || a.createdAt.localeCompare(b.createdAt));
  }
  roots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const post of roots) {
    post.replies = byParent.get(post.id) ?? [];
    for (const reply of post.replies) {
      reply.replies = byParent.get(reply.id) ?? [];
    }
  }

  return { courseId: lesson.courseId, lessonId, count: visible.length, posts: roots, moderator };
}
// ─────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────

export async function createPost(
  userId: string,
  role: string,
  lessonId: string,
  payload: CreateDiscussionPostPayload,
): Promise<DiscussionPost> {
  await assertDiscussionsEnabled();
  const lesson = await loadLesson(lessonId);
  if (!lesson) throw notFound("Lesson not found.");
  await assertThreadAccess(lesson.courseId, userId, role);
  const body = (payload.body ?? "").trim();
  if (body.length === 0) throw badRequest("A post cannot be empty.");
  if (body.length > MAX_BODY_LENGTH) throw badRequest(`Posts are limited to ${MAX_BODY_LENGTH} characters.`);

  const { db } = getDb(loadEnv().DATABASE_URL);
  let depth = 0;
  let ancestorIds: string[] = [];
  if (payload.parentId) {
    const [parent] = await db
      .select()
      .from(discussionPosts)
      .where(and(eq(discussionPosts.id, payload.parentId), eq(discussionPosts.lessonId, lessonId)))
      .limit(1);
    if (!parent) throw badRequest("The parent post is not in this lesson's thread.");
    const parentLimit = MAX_REPLY_DEPTH; // root(0) + reply(1) + reply(2) — max 3 levels
    if (parent.depth >= parentLimit) throw badRequest("Threads are limited to 3 levels deep.");
    depth = parent.depth + 1;
    // Notify the whole reply-chain owner (root author + intermediate replier).
    const chain = await db
      .select({ authorId: discussionPosts.authorId, parentId: discussionPosts.parentId })
      .from(discussionPosts)
      .where(eq(discussionPosts.id, parent.id));
    const seen = new Set<string>();
    let cursor: { authorId: string; parentId: string | null } | undefined = chain[0];
    while (cursor && !seen.has(cursor.authorId)) {
      seen.add(cursor.authorId);
      ancestorIds.push(cursor.authorId);
      if (!cursor.parentId) break;
      const [next] = await db
        .select({ authorId: discussionPosts.authorId, parentId: discussionPosts.parentId })
        .from(discussionPosts)
        .where(eq(discussionPosts.id, cursor.parentId))
        .limit(1);
      cursor = next;
    }
  }

  const [inserted] = await db
    .insert(discussionPosts)
    .values({ courseId: lesson.courseId, lessonId, parentId: payload.parentId ?? null, depth, authorId: userId, body })
    .returning();

  emitAnalyticsEvent({
    eventName: "discussion_post_created",
    userId,
    courseId: lesson.courseId,
    lessonId,
    payload: { depth, parentId: payload.parentId ?? null },
  });

  // US-6.1.1 — learner notified (email + in-app) when their post receives a reply.
  if (ancestorIds.length > 0 && depth > 0) {
    const [course] = await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, lesson.courseId)).limit(1);
    const [lessonRow] = await db
      .select({ position: lessons.position, title: lessons.title })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    await notifyDiscussionReply({
      recipientIds: [...new Set(ancestorIds)],
      replierId: userId,
      postBody: body,
      courseSlug: course?.slug ?? "",
      lessonPosition: lessonRow?.position ?? 1,
      lessonTitle: lessonRow?.title ?? "",
    });
  }

  const [authorRow] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    id: inserted.id,
    courseId: lesson.courseId,
    lessonId,
    parentId: payload.parentId ?? null,
    depth,
    author: {
      id: userId,
      name: [authorRow?.firstName, authorRow?.lastName].filter(Boolean).join(" ") || "Learner",
      role: (authorRow?.role ?? "learner") as Role,
      instructorBadge: authorRow?.role === "instructor" || authorRow?.role === "admin",
    },
    body,
    upvoteCount: 0,
    userVoted: false,
    status: "visible",
    moderationReason: null,
    edited: false,
    createdAt: inserted.createdAt.toISOString(),
    replies: [],
  };
}
export async function toggleVote(
  userId: string,
  postId: string,
): Promise<{ postId: string; upvoteCount: number; voted: boolean }> {
  await assertDiscussionsEnabled();
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [post] = await db.select().from(discussionPosts).where(eq(discussionPosts.id, postId)).limit(1);
  if (!post) throw notFound("Post not found.");
  if (post.status !== "visible" && post.authorId !== userId) throw forbidden("You can only vote on visible posts.");

  const [existing] = await db
    .select()
    .from(discussionVotes)
    .where(and(eq(discussionVotes.postId, postId), eq(discussionVotes.userId, userId)))
    .limit(1);

  if (existing) {
    await db
      .delete(discussionVotes)
      .where(and(eq(discussionVotes.postId, postId), eq(discussionVotes.userId, userId)));
    const next = Math.max(0, (post.upvoteCount ?? 0) - 1);
    await db.update(discussionPosts).set({ upvoteCount: next }).where(eq(discussionPosts.id, postId));
    return { postId, upvoteCount: next, voted: false };
  }

  await db.insert(discussionVotes).values({ postId, userId });
  const next = (post.upvoteCount ?? 0) + 1;
  await db.update(discussionPosts).set({ upvoteCount: next }).where(eq(discussionPosts.id, postId));
  emitAnalyticsEvent({
    eventName: "discussion_post_upvoted",
    userId,
    courseId: post.courseId,
    lessonId: post.lessonId,
    payload: { postId },
  });
  return { postId, upvoteCount: next, voted: true };
}
export async function editPost(userId: string, postId: string, body: string): Promise<DiscussionPost> {
  await assertDiscussionsEnabled();
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [post] = await db.select().from(discussionPosts).where(eq(discussionPosts.id, postId)).limit(1);
  if (!post) throw notFound("Post not found.");
  if (post.authorId !== userId) throw forbidden("Only the author can edit this post.");
  const trimmed = body.trim();
  if (trimmed.length === 0) throw badRequest("A post cannot be empty.");
  if (trimmed.length > MAX_BODY_LENGTH) throw badRequest(`Posts are limited to ${MAX_BODY_LENGTH} characters.`);
  await db.update(discussionPosts).set({ body: trimmed, editedAt: new Date() }).where(eq(discussionPosts.id, postId));

  const [authorRow] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    id: post.id,
    courseId: post.courseId,
    lessonId: post.lessonId,
    parentId: post.parentId,
    depth: post.depth,
    author: {
      id: userId,
      name: [authorRow?.firstName, authorRow?.lastName].filter(Boolean).join(" ") || "Learner",
      role: (authorRow?.role ?? "learner") as Role,
      instructorBadge: authorRow?.role === "instructor" || authorRow?.role === "admin",
    },
    body: trimmed,
    upvoteCount: post.upvoteCount ?? 0,
    userVoted: false,
    status: post.status as "visible" | "hidden",
    moderationReason: post.moderationReason,
    edited: true,
    createdAt: post.createdAt.toISOString(),
    replies: [],
  };
}
/**
 * US-6.1.1 moderation — admin or course instructor may hide/unhide/delete any
 * post; the reason is logged (audit trail) alongside the action.
 */
export async function moderatePost(
  moderatorId: string,
  role: string,
  postId: string,
  payload: ModerateDiscussionPostPayload,
): Promise<{ ok: true; action: string }> {
  await assertDiscussionsEnabled();
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [post] = await db.select().from(discussionPosts).where(eq(discussionPosts.id, postId)).limit(1);
  if (!post) throw notFound("Post not found.");
  if (!(await isModerator(post.courseId, moderatorId, role))) {
    throw forbidden("Only an admin or the course instructor can moderate this post.");
  }
  const action = payload.action;
  switch (action) {
    case "hide": {
      if (!payload.reason?.trim()) throw badRequest("A moderation reason is required.");
      await db
        .update(discussionPosts)
        .set({ status: "hidden", moderationReason: payload.reason.trim(), moderationBy: moderatorId, moderationAt: new Date() })
        .where(eq(discussionPosts.id, postId));
      break;
    }
    case "unhide": {
      await db
        .update(discussionPosts)
        .set({ status: "visible", moderationReason: null, moderationBy: null, moderationAt: null })
        .where(eq(discussionPosts.id, postId));
      break;
    }
    case "delete": {
      if (!payload.reason?.trim()) throw badRequest("A moderation reason is required.");
      await db.delete(discussionPosts).where(eq(discussionPosts.id, postId));
      break;
    }
  }
  await recordAudit({
    actorId: moderatorId,
    action: `discussion_post.${action}`,
    targetType: "discussion_post",
    targetId: postId,
    details: { reason: payload.reason ?? null, courseId: post.courseId, lessonId: post.lessonId },
  });
  return { ok: true, action };
}
/** US-6.1.1 — posts searchable within course context (enrolled/staff only). */
export async function searchPosts(
  courseId: string,
  viewerId: string,
  viewerRole: string,
  query: string,
): Promise<DiscussionSearchResponse> {
  await assertDiscussionsEnabled();
  await assertThreadAccess(courseId, viewerId, viewerRole);
  const q = query.trim();
  if (!q) return { courseId, count: 0, posts: [] };
  const { db } = getDb(loadEnv().DATABASE_URL);
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: discussionPosts.id,
      courseId: discussionPosts.courseId,
      lessonId: discussionPosts.lessonId,
      parentId: discussionPosts.parentId,
      depth: discussionPosts.depth,
      authorId: discussionPosts.authorId,
      body: discussionPosts.body,
      upvoteCount: discussionPosts.upvoteCount,
      status: discussionPosts.status,
      moderationReason: discussionPosts.moderationReason,
      editedAt: discussionPosts.editedAt,
      createdAt: discussionPosts.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorRole: users.role,
    })
    .from(discussionPosts)
    .innerJoin(users, eq(users.id, discussionPosts.authorId))
    .where(
      and(
        eq(discussionPosts.courseId, courseId),
        eq(discussionPosts.status, "visible"),
        ilike(discussionPosts.body, pattern),
      ),
    )
    .orderBy(desc(discussionPosts.createdAt))
    .limit(30);
  const postIds = rows.map((r) => r.id);
  const votes = postIds.length
    ? await db.select({ postId: discussionVotes.postId }).from(discussionVotes).where(eq(discussionVotes.userId, viewerId))
    : [];
  const voted = new Set(votes.map((v) => v.postId));
  const moderator = await isModerator(courseId, viewerId, viewerRole);
  const posts = rows.map((r) => toPost(r, voted.has(r.id), moderator));
  return { courseId, count: posts.length, posts };
}
