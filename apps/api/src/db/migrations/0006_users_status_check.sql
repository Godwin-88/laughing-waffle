-- ─────────────────────────────────────────────────────────────
-- 0006 — Sprint 7 follow-up: extend users.status CHECK constraint
-- The original 0001 constraint only allowed ('active','disabled'),
-- but Sprint 7 adds 'suspended' (admin moderation, US-7.1.1) and
-- 'deleted' (GDPR anonymisation, US-7.2.1). Relax the check.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users DROP CONSTRAINT users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'disabled', 'suspended', 'deleted'));