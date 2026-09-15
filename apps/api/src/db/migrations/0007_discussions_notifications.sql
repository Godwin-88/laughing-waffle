-- ─────────────────────────────────────────────────────────────
-- 0007 — Sprint 8: Course discussions (US-6.1.1) & Notifications (US-10.1.1)
-- ─────────────────────────────────────────────────────────────

-- Per-lesson discussion threads (US-6.1.1). Top-level posts (depth 0) get
-- up to depth 2 replies -> max 3 levels deep, enforced in the service.
CREATE TABLE discussion_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id          uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id          uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  parent_id          uuid REFERENCES discussion_posts(id) ON DELETE CASCADE,
  depth              smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  author_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body               text NOT NULL,
  upvote_count       integer NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  moderation_reason  text,
  moderation_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  moderation_at      timestamptz,
  edited_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discussion_posts_lesson_idx ON discussion_posts (lesson_id, created_at DESC);
CREATE INDEX discussion_posts_course_idx ON discussion_posts (course_id, created_at DESC);

-- Upvotes (US-6.1.1) — one row per (post, user); the service toggles.
CREATE TABLE discussion_votes (
  post_id    uuid NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- In-app notifications (US-10.1.1) — bell badge, last 20 in the dropdown.
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  link          text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Per-type notification preferences (US-10.1.1) — one row per user, defaults on.
CREATE TABLE notification_preferences (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discussion_reply        boolean NOT NULL DEFAULT true,
  assignment_graded       boolean NOT NULL DEFAULT true,
  course_content_added    boolean NOT NULL DEFAULT true,
  certificate_issued      boolean NOT NULL DEFAULT true,
  payment_receipt         boolean NOT NULL DEFAULT true,
  streak_reminder         boolean NOT NULL DEFAULT true,
  instructor_announcement boolean NOT NULL DEFAULT true,
  marketing              boolean NOT NULL DEFAULT true,
  updated_at              timestamptz NOT NULL DEFAULT now()
);