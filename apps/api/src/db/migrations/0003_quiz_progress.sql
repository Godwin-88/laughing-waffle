-- 0003_quiz_progress.sql — Takwimu LMS Sprint 5
-- Graded quizzes (US-3.2.2) + progress engine (US-5.1.1).
--
-- Changes:
--   1. Rename the progress table to `lesson_progress` to match the master spec
--      (US-5.1.1 "Completion status persisted in PostgreSQL lesson_progress table").
--   2. Quiz configuration columns on lessons (time limit, pass %, attempts,
--      cooldown, shuffling) for graded quizzes (US-3.2.2).
--   3. quiz_attempts — per-attempt snapshot + answers + grade, so answers are
--      never exposed client-side before submission (US-3.2.2, US-3.2.1).
--   4. gradebook — one row per (user, lesson); written immediately on submission.
--   5. modules (course_id, position) unique so seed upserts stay deterministic.

-- ─────────────────────────────────────────────────────────────
-- 1. lesson_progress (US-5.1.1 — spec table name)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE progress RENAME TO lesson_progress;
ALTER INDEX IF EXISTS progress_user_lesson_unique RENAME TO lesson_progress_user_lesson_unique;

-- ─────────────────────────────────────────────────────────────
-- 2. quiz configuration on lessons (US-3.2.2)
--    time limit: 0 = none, otherwise 15/30/60/90/120 minutes.
--    max attempts: 0 = unlimited.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS quiz_time_limit_minutes    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_pass_percent          integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS quiz_max_attempts          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_attempt_cooldown_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiz_shuffle_questions     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quiz_shuffle_answers       boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────
-- 3. quiz_attempts — one row per learner attempt (US-3.2.2)
--    questions_snapshot stores the shuffled question set as presented,
--    answers the submitted answer indices (graded server-side).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id            uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  lesson_id            uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  attempt_number       integer NOT NULL,
  status               text NOT NULL DEFAULT 'in_progress'
                          CHECK (status IN ('in_progress', 'submitted', 'expired')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  submitted_at         timestamptz,
  questions_snapshot   jsonb NOT NULL DEFAULT '[]',
  answers              jsonb NOT NULL DEFAULT '[]',
  score                numeric(6, 2) NOT NULL DEFAULT 0,
  max_score            numeric(6, 2) NOT NULL DEFAULT 0,
  percent              numeric(6, 2) NOT NULL DEFAULT 0,
  passed               boolean NOT NULL DEFAULT false,
  auto_submitted       boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user        ON quiz_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lesson      ON quiz_attempts (lesson_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_lesson ON quiz_attempts (user_id, lesson_id, status);

-- ─────────────────────────────────────────────────────────────
-- 4. gradebook — latest grade per (user, lesson) (US-3.2.2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gradebook (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  item_type    text NOT NULL DEFAULT 'quiz'
                   CHECK (item_type IN ('quiz', 'assignment')),
  attempt_id   uuid REFERENCES quiz_attempts (id) ON DELETE SET NULL,
  score        numeric(6, 2) NOT NULL DEFAULT 0,
  max_score    numeric(6, 2) NOT NULL DEFAULT 0,
  percent      numeric(6, 2) NOT NULL DEFAULT 0,
  passed       boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_gradebook_user_course ON gradebook (user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_gradebook_lesson      ON gradebook (lesson_id);

-- ─────────────────────────────────────────────────────────────
-- 5. deterministic module upserts (course, position)
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_course_position
  ON modules (course_id, position);