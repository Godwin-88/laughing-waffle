-- 0001_init.sql — Takwimu LMS initial schema (Sprint 1–2 foundation)
-- Postgres 16+ features used: gen_random_uuid (built-in in 13+),
-- tsvector triggers, pg_trgm trigram indexes for fuzzy catalogue search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  role               text NOT NULL DEFAULT 'learner'
                       CHECK (role IN ('learner', 'instructor', 'admin')),
  avatar_key         text,
  bio                text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'disabled')),
  email_verified_at  timestamptz,
  consent_given_at   timestamptz,
  sso_provider       text,
  sso_subject        text,
  interests          jsonb NOT NULL DEFAULT '[]',
  experience_level   text CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  wizard_step        integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_experience ON users (experience_level);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens (user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- courses (Epic 2 catalogue)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS courses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,
  title               text NOT NULL,
  tagline             text NOT NULL DEFAULT '',
  description         text NOT NULL DEFAULT '',
  objectives          jsonb NOT NULL DEFAULT '[]',
  instructor          text NOT NULL DEFAULT '',
  instructor_bio      text NOT NULL DEFAULT '',
  duration_weeks      integer NOT NULL DEFAULT 0,
  skill_level         text NOT NULL DEFAULT 'beginner'
                        CHECK (skill_level IN ('beginner', 'intermediate', 'advanced')),
  category            text NOT NULL DEFAULT 'technology',
  languages           jsonb NOT NULL DEFAULT '["English"]',
  price_cents         integer NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'USD',
  rating              double precision NOT NULL DEFAULT 0,
  rating_count        integer NOT NULL DEFAULT 0,
  tags                jsonb NOT NULL DEFAULT '[]',
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
  cover_image_url     text,
  preview_video_url   text,
  certification_label text,
  search_tsv          tsvector,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_category ON courses (category);
CREATE INDEX IF NOT EXISTS idx_courses_level   ON courses (skill_level);
CREATE INDEX IF NOT EXISTS idx_courses_price   ON courses (price_cents);
CREATE INDEX IF NOT EXISTS idx_courses_status  ON courses (status);
CREATE INDEX IF NOT EXISTS idx_courses_search  ON courses USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS idx_courses_title_trgm  ON courses USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_courses_desc_trgm   ON courses USING gin (description gin_trgm_ops);

CREATE OR REPLACE FUNCTION course_search_tsv() RETURNS trigger AS $$
DECLARE
  d text := (SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(COALESCE(NEW.tags, '[]'::jsonb)) x);
  o text := (SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(COALESCE(NEW.objectives, '[]'::jsonb)) x);
BEGIN
  NEW.search_tsv := setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A')
      || setweight(to_tsvector('simple', COALESCE(NEW.tagline, '') || ' ' || COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.instructor, '')), 'B')
      || setweight(to_tsvector('simple', COALESCE(d, '') || ' ' || COALESCE(o, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_courses_search_tsv ON courses;
CREATE TRIGGER trg_courses_search_tsv BEFORE INSERT OR UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION course_search_tsv();
-- ─────────────────────────────────────────────────────────────
-- modules / lessons (syllabus structure — Epic 2/3)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS modules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position       integer NOT NULL,
  title          text NOT NULL,
  week           integer,
  hours_estimate integer,
  exam_coverage  text,
  hook           text NOT NULL DEFAULT '',
  objectives     jsonb NOT NULL DEFAULT '[]',
  content        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid REFERENCES modules (id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  lesson_number integer,
  total_lessons integer,
  title         text NOT NULL,
  summary       text NOT NULL DEFAULT '',
  content       text NOT NULL DEFAULT '',
  kind          text NOT NULL DEFAULT 'text'
                  CHECK (kind IN ('text', 'video', 'notebook', 'lab', 'quiz')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  module_id     uuid REFERENCES modules (id) ON DELETE CASCADE,
  lesson_id     uuid REFERENCES lessons (id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  prompt        text NOT NULL,
  options       jsonb NOT NULL,
  correct_index integer NOT NULL,
  explanation   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- enrolments (Sprint 3 API — schema foundation now)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS enrolments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id        uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'enrolled'
                     CHECK (status IN ('enrolled', 'completed', 'cancelled')),
  price_paid_cents integer NOT NULL DEFAULT 0,
  enrolled_at      timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (user_id, course_id)
);

-- ─────────────────────────────────────────────────────────────
-- progress (US-3.1.x foundation)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id        uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  module_id        uuid REFERENCES modules (id) ON DELETE CASCADE,
  lesson_id        uuid REFERENCES lessons (id) ON DELETE CASCADE,
  completed        boolean NOT NULL DEFAULT false,
  last_position_ms integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

-- ─────────────────────────────────────────────────────────────
-- course reviews (US-2.1.3 aggregate/individual reviews)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS course_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_course ON course_reviews (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens (user_id);