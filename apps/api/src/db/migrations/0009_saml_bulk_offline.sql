-- ─────────────────────────────────────────────────────────────
-- Sprint 10 — SAML SSO (US-1.1.3),
--             Admin bulk enrolment (US-2.2.3),
--             Offline lesson downloads (US-3.1.2)
-- ─────────────────────────────────────────────────────────────

-- Enrolment expiry: bulk-enrolment cohorts may carry an expiry date, and
-- offline downloads expire when the enrolment does (whichever is sooner
-- than the 30-day download window).
ALTER TABLE enrolments ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_enrolments_expires ON enrolments (user_id, course_id) WHERE expires_at IS NOT NULL;

-- SAML 2.0 identity providers (enterprise SSO).
-- Admin uploads IdP metadata XML (Settings → SSO); the assertion
-- consumer provisions users on first sign-in (JIT) and maps the
-- `lms_role` attribute to the platform role.
CREATE TABLE IF NOT EXISTS saml_providers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text NOT NULL,
  metadata_xml        text NOT NULL DEFAULT '',
  issuer              text,
  entity_id           text,
  sso_url             text,
  x509_cert           text,
  lms_role_attribute  text NOT NULL DEFAULT 'lms_role',
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused')),
  created_by          uuid REFERENCES users (id),
  last_refresh_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saml_providers_status ON saml_providers (status);

-- Bulk enrolment jobs — the validation report lives on the job row
-- so the admin sees valid/invalid counts before and after commit.
CREATE TABLE IF NOT EXISTS bulk_enrolment_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      uuid NOT NULL REFERENCES users (id),
  course_id     uuid NOT NULL REFERENCES courses (id),
  filename      text NOT NULL DEFAULT 'upload.csv',
  total_rows    integer NOT NULL DEFAULT 0,
  valid_rows    integer NOT NULL DEFAULT 0,
  invalid_rows  integer NOT NULL DEFAULT 0,
  enrolled_rows integer NOT NULL DEFAULT 0,
  skipped_rows  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed')),
  report        jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_admin ON bulk_enrolment_jobs (admin_id);

CREATE TABLE IF NOT EXISTS bulk_enrolment_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES bulk_enrolment_jobs (id) ON DELETE CASCADE,
  email        text NOT NULL,
  course_id    uuid NOT NULL REFERENCES courses (id),
  cohort_name  text,
  expiry_date  timestamptz,
  status       text NOT NULL DEFAULT 'invalid'
                 CHECK (status IN ('valid','invalid','enrolled','skipped')),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulk_rows_job ON bulk_enrolment_rows (job_id);

-- Offline lesson downloads — AES-256-GCM encrypted at rest; the content
-- key is wrapped with a device-bound key (HKDF(device_id, server secret))
-- so a download is unusable outside the originating device.
CREATE TABLE IF NOT EXISTS offline_downloads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id         uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  enrolment_id      uuid REFERENCES enrolments (id) ON DELETE SET NULL,
  device_id         text NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','processing','ready','expired','revoked','failed')),
  progress          integer NOT NULL DEFAULT 0,
  file_key          text,
  content_sha       text,
  key_wrapped       jsonb,
  size_bytes        integer NOT NULL DEFAULT 0,
  error             text,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  last_accessed_at  timestamptz,
  cancelled_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_offline_user ON offline_downloads (user_id);