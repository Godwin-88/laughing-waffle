"use client";

import { useEffect, useState } from "react";
import type { DiscussionPost, DiscussionThreadResponse } from "@takwimu/shared";
import { discussionApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const MAX_BODY = 4000;

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.max(1, Math.round(diff / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  lessonId: string;
  courseSlug: string;
  lessonPosition: number;
}

export function DiscussionBoard({ lessonId, courseSlug, lessonPosition }: Props) {
  const { user } = useAuth();
  const [thread, setThread] = useState<DiscussionThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [moderationPending, setModerationPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setThread(await discussionApi.thread(lessonId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the discussion.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [lessonId]);

  if (loading && !thread) {
    return (
      <section className="mt-10 rounded-3xl border border-ink-200 bg-white p-6">
        <h2 className="text-xl font-bold text-ink-900">Course discussion</h2>
        <p className="mt-3 text-sm text-ink-500">Loading the thread…</p>
      </section>
    );
  }

  if (error && !thread) {
    return (
      <section className="mt-10 rounded-3xl border border-ink-200 bg-white p-6">
        <h2 className="text-xl font-bold text-ink-900">Course discussion</h2>
        <p className="mt-3 text-sm text-red-600">{error}</p>
      </section>
    );
  }

const submitRoot = async () => {
    const body = draft.trim();
    if (!body || body.length > MAX_BODY) return;
    setBusy(true);
    try {
      await discussionApi.createPost(lessonId, body);
      setDraft("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (parentId: string) => {
    const body = (replyDrafts[parentId] ?? "").trim();
    if (!body || body.length > MAX_BODY) return;
    setBusy(true);
    try {
      await discussionApi.createPost(lessonId, body, parentId);
      const next = { ...replyDrafts };
      delete next[parentId];
      setReplyDrafts(next);
      setReplyingTo(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reply. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const vote = async (post: DiscussionPost) => {
    try {
      const res = await discussionApi.vote(post.id);
      const next = thread ? { ...thread } : null;
      if (next) {
        const flip = (p: DiscussionPost): DiscussionPost => {
          if (p.id === post.id) {
            return { ...p, upvoteCount: res.upvoteCount, userVoted: res.voted };
          }
          return { ...p, replies: p.replies.map(flip) };
        };
        next.posts = next.posts.map(flip);
        setThread(next);
      }
    } catch {
      /* vote failed silently – thread reloads keep state truthful */
    }
  };

  const moderate = async (post: DiscussionPost, action: "hide" | "unhide" | "delete") => {
    setModerationPending(`${post.id}:${action}`);
    try {
      const hint = action === "delete" ? "Reason for deletion (audit log):" : "Reason for hiding (shown to the author):";
      const reason = window.prompt(hint);
      if (reason === null) return;
      await discussionApi.moderate(post.id, action, reason || undefined);
      if (action === "delete" && thread) {
        const drop = (list: DiscussionPost[]): DiscussionPost[] =>
          list.filter((p) => p.id !== post.id).map((p) => ({ ...p, replies: drop(p.replies) }));
        setThread({ ...thread, posts: drop(thread.posts) });
      } else {
        await reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation failed.");
    } finally {
      setModerationPending(null);
    }
  };
const renderPost = (post: DiscussionPost) => {
    const hidden = post.status === "hidden" && !moderator && post.author.id !== user?.id;
    return (
      <article
        key={post.id}
        className={`rounded-2xl border p-4 ${post.depth > 0 ? "border-ink-100 bg-ink-50" : "border-ink-200 bg-white"}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`font-semibold ${hidden ? "text-ink-400" : "text-ink-800"}`}>{post.author.name}</span>
          {post.author.instructorBadge ? (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-700">
              Instructor
            </span>
          ) : null}
          <span className="text-ink-400">· {relativeTime(post.createdAt)}</span>
          {post.edited ? <span className="text-ink-400">· edited</span> : null}
          {hidden ? <span className="text-ink-400">· hidden</span> : null}
        </div>

        {hidden ? (
          <p className="mt-2 text-sm italic text-ink-500">This post was hidden by a moderator.</p>
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-ink-800">{post.body}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => void vote(post)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              post.userVoted ? "border-brand-600 bg-brand-100 text-brand-700" : "border-ink-200 text-ink-600 hover:border-brand-400"
            }`}
          >
            ▲ {post.upvoteCount}
          </button>

          {!hidden && user && post.depth < 2 ? (
            <button type="button" onClick={() => setReplyingTo(replyingTo === post.id ? null : post.id)} className="text-xs font-semibold text-ink-600 hover:text-brand-700">
              Reply
            </button>
          ) : null}

          {!hidden && user?.id === post.author.id ? (
            <button type="button" onClick={() => void editLocal(post)} className="text-xs font-semibold text-ink-600 hover:text-brand-700">
              Edit
            </button>
          ) : null}

          {moderator && user?.id !== post.author.id ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={moderationPending === `${post.id}:hide`}
                onClick={() => void moderate(post, post.status === "visible" ? "hide" : "unhide")}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700"
              >
                {post.status === "visible" ? "Hide" : "Unhide"}
              </button>
              <button
                type="button"
                disabled={moderationPending === `${post.id}:delete`}
                onClick={() => void moderate(post, "delete")}
                className="text-xs font-semibold text-red-600 hover:text-red-700"
              >
                Delete
              </button>
            </span>
          ) : null}
        </div>

        {post.status === "hidden" && post.moderationReason ? (
          <p className="mt-1 text-xs italic text-ink-500">Reason: {post.moderationReason}</p>
        ) : null}

        {replyingTo === post.id ? (
          <div className="mt-3">
            <textarea
              value={replyDrafts[post.id] ?? ""}
              onChange={(e) => setReplyDrafts({ ...replyDrafts, [post.id]: e.target.value })}
              rows={3}
              maxLength={MAX_BODY}
              placeholder="Write a reply…"
              className="w-full rounded-xl border border-ink-200 p-3 text-sm focus:border-brand-500 focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void submitReply(post.id)} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
                Post reply
              </button>
              <button type="button" onClick={() => setReplyingTo(null)} className="text-sm font-medium text-ink-500 hover:text-ink-700">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {post.replies.length > 0 ? <div className="mt-3 space-y-3">{post.replies.map((r) => renderPost(r))}</div> : null}
      </article>
    );
  };
  const moderator = thread?.moderator ?? false;
const editLocal = async (post: DiscussionPost) => {
    const next = window.prompt("Edit your post:", post.body);
    if (next === null || next.trim() === post.body) return;
    try {
      await discussionApi.editPost(post.id, next);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed.");
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!thread || q.length < 2) return;
    try {
      const res = await discussionApi.search(thread.courseId, q);
      setThread({ ...thread, posts: res.posts, count: res.count, moderator });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  };

  return (
    <section className="mt-10 rounded-3xl border border-ink-200 bg-white p-6" id="discussion">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink-900">Course discussion</h2>
        <a href={`/courses/${courseSlug}/lessons/${lessonPosition}`} className="text-xs font-semibold text-ink-500 hover:text-brand-700">
          Back to lesson →
        </a>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        Ask questions about this lesson, share answers, and upvote helpful replies.
        {moderator ? " You can moderate (hide/delete) posts as an instructor." : ""}
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Search this course's discussion…"
          className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button type="button" onClick={() => void search()} className="rounded-xl bg-ink-800 px-4 text-sm font-semibold text-white hover:bg-ink-900">
          Search
        </button>
        <button type="button" onClick={() => void reload()} className="rounded-xl border border-ink-200 px-3 text-sm font-semibold text-ink-600 hover:border-brand-400">
          Reset
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {user ? (
        <div className="mt-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={MAX_BODY}
            placeholder="Start a discussion about this lesson…"
            className="w-full rounded-xl border border-ink-200 p-3 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void submitRoot()}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Post question
            </button>
            <span className="text-xs text-ink-400">{draft.length}/{MAX_BODY}</span>
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-ink-50 p-3 text-sm text-ink-600">
          <a href="/login" className="font-semibold text-brand-700 underline">Sign in</a> to join the conversation.
        </p>
      )}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {thread?.count ?? 0} {thread?.count === 1 ? "post" : "posts"}
        </p>
        {thread && thread.posts.length > 0 ? (
          <div className="mt-3 space-y-3">{thread.posts.map((p) => renderPost(p))}</div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">No posts yet — be the first to ask a question!</p>
        )}
      </div>
    </section>
  );
}