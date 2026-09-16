-- ─────────────────────────────────────────────────────────────
-- Sprint 9 — OAuth 2.0 client credentials (US-8.1.1),
--             LTI 1.3 Tool Provider (US-8.1.2),
--             learner analytics source data (US-9.1.1)
-- ─────────────────────────────────────────────────────────────

-- OAuth 2.0 machine-to-machine clients for the external catalogue API.
-- Secrets are stored hashed; `client_id` is the public identifier.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  client_id          text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  scopes             text NOT NULL DEFAULT 'catalogue:read',
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','revoked')),
  last_used_at       timestamptz,
  created_by         uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients (client_id);

-- LTI 1.3 registrations — each platform (Canvas, Moodle, Blackboard, …) is one row.
CREATE TABLE IF NOT EXISTS lti_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer            text NOT NULL,              -- platform issuer URL
  client_id         text NOT NULL,              -- client id the platform uses for us
  tool_name         text NOT NULL DEFAULT '',
  auth_login_url    text,                       -- platform OIDC login initiation
  auth_token_url    text,                       -- platform OIDC token endpoint (AGS)
  jwks_url          text,                       -- platform public keyset
  platform_key_set  jsonb,                      -- optional pasted JWKS
  ags_line_item_url text,                       -- AGS line-item collection URL
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, client_id)
);

-- OIDC login-initiation → launch sessions (state/nonce bound per click).
CREATE TABLE IF NOT EXISTS lti_launches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES lti_registrations (id) ON DELETE CASCADE,
  state           text NOT NULL,
  nonce           text NOT NULL,
  message_type    text NOT NULL DEFAULT 'LtiResourceLinkLaunch',
  target_link_uri text,
  context_id      text,
  user_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  course_id       uuid REFERENCES courses (id) ON DELETE SET NULL,
  lesson_id       uuid REFERENCES lessons (id) ON DELETE SET NULL,
  used            boolean NOT NULL DEFAULT false,
  launched_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX IF NOT EXISTS idx_lti_launches_state ON lti_launches (state);
CREATE INDEX IF NOT EXISTS idx_lti_launches_reg    ON lti_launches (registration_id);

-- AGS grade passback ledger (tool → platform within 60s of quiz submission).
CREATE TABLE IF NOT EXISTS lti_grades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES lti_registrations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id       uuid REFERENCES courses (id) ON DELETE SET NULL,
  lesson_id       uuid REFERENCES lessons (id) ON DELETE SET NULL,
  attempt_id      uuid,
  score_given     numeric(6,2) NOT NULL,
  score_maximum   numeric(6,2) NOT NULL DEFAULT 100,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','pushed','failed')),
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  pushed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lti_grades_user    ON lti_grades (user_id);
CREATE INDEX IF NOT EXISTS idx_lti_grades_reg     ON lti_grades (registration_id);
CREATE INDEX IF NOT EXISTS idx_lti_grades_status  ON lti_grades (status, created_at);