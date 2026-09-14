-- 0002_enrolment_video_builder.sql — Takwimu LMS Sprint 3–4
-- Enrolment & access control (US-2.2.1), video lesson player (US-3.1.1),
-- course builder (US-4.1.1), video upload + transcoding (US-4.1.2),
-- in-app analytics events (US-2.2.1 «course_enrolled» pipeline).

-- Progress upserts target (user_id, lesson_id) → back it with a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS progress_user_lesson_unique
  ON progress (user_id, lesson_id);

-- Courses: owning instructor (Sprint 4 workspace).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS instructor_id uuid REFERENCES users (id);
CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses (instructor_id);

-- Lessons: per-lesson publishing, rich-text JSON (US-4.1.3), video pipeline fields.
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS published               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_json            jsonb    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS video_status            text     NOT NULL DEFAULT 'none'
                        CHECK (video_status IN ('none','uploading','queued','transcoding','ready','failed')),
  ADD COLUMN IF NOT EXISTS video_source_key        text,
  ADD COLUMN IF NOT EXISTS hls_prefix              text,
  ADD COLUMN IF NOT EXISTS video_duration_seconds  integer,
  ADD COLUMN IF NOT EXISTS video_poster_key        text,
  ADD COLUMN IF NOT EXISTS captions_key            text;

-- Seeded lessons were all publicly visible; keep them published.
UPDATE lessons SET published = true WHERE published = false;

-- ─────────────────────────────────────────────────────────────
-- video assets — upload + transcode pipeline (US-3.1.1 / US-4.1.2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id           uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  lesson_id           uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_filename     text NOT NULL,
  source_content_type text NOT NULL DEFAULT 'video/mp4',
  source_size_bytes   bigint NOT NULL DEFAULT 0,
  source_key          text NOT NULL,
  upload_id           text,
  parts               jsonb NOT NULL DEFAULT '[]',
  uploaded_bytes      bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'uploading'
                        CHECK (status IN ('uploading','queued','transcoding','ready','failed','cancelled')),
  hls_prefix          text,
  duration_seconds    integer,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_assets_lesson ON video_assets (lesson_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_user   ON video_assets (user_id);

DROP TRIGGER IF EXISTS trg_video_assets_updated_at ON video_assets;
CREATE TRIGGER trg_video_assets_updated_at BEFORE UPDATE ON video_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- transcode jobs — FFmpeg worker queue (US-4.1.2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcode_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid NOT NULL REFERENCES video_assets (id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','processing','done','failed')),
  attempts    integer NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_transcode_jobs_state ON transcode_jobs (state, created_at);

-- ─────────────────────────────────────────────────────────────
-- analytics events — learner-instructor activity pipeline
-- (course_enrolled, lesson_viewed, video_transcoded, …)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  user_id    uuid,
  course_id  uuid,
  lesson_id  uuid,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user      ON analytics_events (user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_course    ON analytics_events (course_id);