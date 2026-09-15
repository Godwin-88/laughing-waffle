-- ─────────────────────────────────────────────────────────────
-- 0005 — Sprint 7: Admin panel (US-7.1.x) & GDPR (US-7.2.1)
-- ─────────────────────────────────────────────────────────────

-- Last-activity stamping for the admin user list (US-7.1.1 "last active"),
-- admin-initiated forced password reset flag, and GDPR deletion audit trail.
ALTER TABLE users
  ADD COLUMN last_active_at timestamptz,
  ADD COLUMN force_password_reset_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX users_last_active_idx ON users (last_active_at DESC NULLS LAST);

-- Audit log — one row per admin action (or GDPR self-service action):
-- actor, action, target, timestamp (US-7.1.1 "Audit log entry created for
-- every admin action"). Appended, never updated.
CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action       text NOT NULL,            -- e.g. user.role_changed, user.suspended
  target_type  text NOT NULL,            -- user | config | certificate | ...
  target_id    uuid,
  details      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- One-time password-reset tokens (US-7.1.1 "force password reset").
-- The admin action mints a token and emails a reset link; the token is
-- single-use, hashed at rest, and expires.
CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL   -- admin who forced it, if any
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);

-- Platform configuration (US-7.1.2) — admin-editable without a deploy.
-- Dot-notation keys ("platform.name", "features.certificates") with JSONB
-- values; defaults live in code. Source of truth is this table; Redis caches
-- it for the <=60s propagation window.
CREATE TABLE system_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Versioned configuration — full snapshot per change; the admin UI lists the
-- last 10 and can roll back (US-7.1.2 "Configuration versioned").
CREATE TABLE config_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot     jsonb NOT NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  applied_at   timestamptz NOT NULL DEFAULT now()
);

-- GDPR / data-subject requests (US-7.2.1). Deletion requests are retained
-- 30 days after completion (expires_at) for audit.
CREATE TABLE data_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('export', 'delete')),
  status           text NOT NULL DEFAULT 'pending_confirmation'
                   CHECK (status IN ('pending_confirmation', 'processing', 'completed', 'failed', 'cancelled')),
  initiated_by     text NOT NULL DEFAULT 'self' CHECK (initiated_by IN ('self', 'admin')),
  admin_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  token_hash       text,
  storage_key      text,                 -- gdpr-exports ZIP object key
  error            text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz,
  completed_at     timestamptz,
  expires_at       timestamptz,          -- deletion audit retention end (+30 days)
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_requests_user_idx ON data_requests (user_id, requested_at DESC);
CREATE INDEX data_requests_status_idx ON data_requests (status, requested_at DESC);