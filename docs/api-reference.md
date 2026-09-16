# API Reference

Base URL: `http://localhost:4000/api/v1` (configurable via `PUBLIC_API_URL`).

**Authentication**

- Access tokens are sent as `Authorization: Bearer <accessToken>`.
- Refresh uses the `httpOnly` cookie `tkw_refresh` — the web client calls `POST /auth/refresh` automatically on 401.
- Errors follow a consistent shape: `{ statusCode, code, error, message, fields? }`.

## Auth — Sprint 1

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | — | Register `{firstName, lastName, email, password, consent}`; returns `userId` + `devVerificationUrl` |
| `POST` | `/auth/verify-email` | — | Verify with the emailed token |
| `POST` | `/auth/resend-verification` | — | Resend verification email |
| `POST` | `/auth/login` | — | Returns `{ accessToken, refreshToken? }` and sets refresh cookie |
| `POST` | `/auth/refresh` | cookie | Rotates the refresh cookie and returns a new access token |
| `POST` | `/auth/logout` | cookie | Clears the session cookie |
| `GET` | `/auth/me` | bearer | Returns `{ user, sso }` (profile + enabled providers) |
| `GET` | `/auth/sso/:provider` | — | Start OIDC authorisation (Google / Microsoft) |
| `GET` | `/auth/sso/:provider/callback` | — | OIDC callback → redirect to web |

## Profile — Sprint 2

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/profile/wizard` | bearer | Advance onboarding step with `{step, interests?, experienceLevel?, …}` |
| `PATCH` | `/profile/bio` | bearer | Update bio |
| `POST` | `/profile/avatar` | bearer | Multipart `file` upload → sharp-resized `avatarUrl` |

## Catalogue — Sprint 2 (public read)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/courses` | optional | Search + facets. Query: `q`, `categories`, `levels`, `durations`, `price`, `languages`, `ratingMin`, `sort`, `page`, `pageSize` |
| `GET` | `/courses/:slug` | optional | Course detail incl. modules, objectives, rating; `enrolled`/`progressPercent` when authenticated |
| `GET` | `/courses/:slug/lessons/:position` | optional | Lesson content + quiz; `video` payload (gated) when the lesson is a video |

## Enrolments — Sprint 3

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/enrolments` | bearer | Free enrol by `{courseSlug}`; paid courses require checkout (Sprint 6) |
| `GET` | `/enrolments` | bearer | My enrolments + progress summaries (response: `{ items }`) |
| `GET` | `/courses/:slug/enrolment` | optional | `{enrolled, progressPercent, firstLessonPosition, lastLessonPosition, nextLessonPosition}` |

## Progress — Sprint 3 · completion rules updated in Sprint 5 (US-5.1.1)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `PUT` | `/progress` | bearer | Save `{courseSlug, lessonId, positionMs, completed?}` (video auto-completes at ≥90% watched); publishes SSE event |
| `POST` | `/progress/lessons/:lessonId/complete` | bearer | Mark a lesson complete (text auto-complete on scroll-to-bottom OR 60s on page) |
| `GET` | `/courses/:slug/progress` | bearer | Lesson-by-lesson progress list + course percent |
| `GET` | `/me/progress/events` | bearer **or `?token=`** | SSE stream — `lesson-completed`, `position-saved`, `watch-threshold` events (US-5.1.1) |

Completion rules (persisted in `lesson_progress`, survives session expiry):

- **Video** → complete when max position ≥ 90% of duration (non-contiguous ok).
- **Text** → complete on scroll-to-bottom OR 60 seconds on page (fires once).
- **Quiz / assignment** → complete on submission (gradebook write).

## Graded quizzes — Sprint 5 (US-3.2.2)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/courses/:slug/lessons/:position/quiz/status` | bearer + enrolled | `{config, questionCount, attemptsUsed, bestAttempt, latestAttempt, canAttempt, cooldownRemainingSeconds, maxAttemptsReached}` |
| `POST` | `/courses/:slug/lessons/:position/quiz/attempts` | bearer + enrolled | Start an attempt → `{attemptId, attemptNumber, status, expiresAt, questions[]}` — questions shuffled, **answers masked** |
| `POST` | `/courses/:slug/lessons/:position/quiz/attempts/:attemptId/submit` | bearer + enrolled | Submit `{answers: [{questionId, selectedIndex}]}` → `{score, maxScore, percent, passed, gradebook, questions[] w/ explanations}` |

Rules: time limit in `{0,15,30,60,90,120}` mins with server-side auto-submit of stale attempts; max attempts + optional cooldown; randomised question/answer order (configurable per quiz); grade written to the `gradebook` immediately on submission; quiz submission auto-completes the lesson.

## Video upload — Sprint 4 (instructor)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/instructor/lessons/:lessonId/uploads` | bearer + owner | Create multipart session `{filename, contentType?, sizeBytes}` → `{assetId, partSizeBytes, partCount, driver, putMethod}` |
| `GET` | `/instructor/videos/:assetId/parts/:partNumber` | bearer + owner | Resolve part URL (B2 presigned) |
| `PUT` | `/instructor/videos/:assetId/parts/:partNumber` | bearer + owner | Local driver: upload the raw part body (≤ 5 MB) |
| `POST` | `/instructor/videos/:assetId/complete` | bearer + owner | Complete multipart → queues transcode; returns status |
| `GET` | `/instructor/videos/:assetId` | bearer + owner | Upload / transcode status incl. `jobState` |
| `POST` | `/instructor/lessons/:lessonId/captions` | bearer + owner | Attach VTT captions |
| `POST` | `/instructor/lessons/:lessonId/poster` | bearer + owner | Attach poster image |

## Media (HLS streaming) — Sprint 3–4

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/media/hls/:courseId/:lessonId/*` | enrolment-gated | Manifest, `.m3u8`, `.ts` segments and `captions.vtt`; supports `Range` requests |

403 when the viewer is not enrolled; lesson must be `ready`.

## Course builder — Sprint 4 (instructor)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/instructor/courses` | bearer + instructor | My courses + counts |
| `POST` | `/instructor/courses` | bearer + instructor | Create (returns course entry) |
| `GET` | `/instructor/courses/:slug` | bearer + owner | Full builder workspace |
| `PATCH` | `/instructor/courses/:slug` | bearer + owner | Update title/tagline/description/objectives/pricing |
| `POST` | `/instructor/courses/:slug/publish` | bearer + owner | Publish (make public) |
| `POST` | `/instructor/courses/:slug/modules` | bearer + owner | Add module |
| `PATCH` | `/instructor/modules/:moduleId` | bearer + owner | Update module |
| `DELETE` | `/instructor/modules/:moduleId` | bearer + owner | Delete module (lessons → unassigned) |
| `POST` | `/instructor/courses/:slug/lessons` | bearer + owner | Add lesson |
| `PATCH` | `/instructor/lessons/:lessonId` | bearer + owner | Update lesson (incl. `kind`, `content`) |
| `DELETE` | `/instructor/lessons/:lessonId` | bearer + owner | Delete lesson |

Ownership rules: only the course `instructorId` (or `admin`) may manage a course, module, lesson or upload.

## Checkout & orders — Sprint 6 (US-2.2.2)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/checkout/orders` | bearer | Create order for a paid course: `{courseSlug, provider}` → `{order, mode, client}` |
| `GET` | `/orders` | bearer | My orders + receipts (`{ items }`) |
| `GET` | `/orders/:orderId` | bearer | Order summary (owner only) |
| `GET` | `/checkout/orders/:orderId/status` | bearer | Confirmation polling — refreshes pending provider state (M-Pesa STK cadence ~10 s) |
| `POST` | `/checkout/orders/:orderId/complete` | bearer | **Mock mode only** — simulate a successful capture |
| `POST` | `/checkout/webhooks/stripe` | signed | Stripe webhook (`payment_intent.succeeded`), HMAC-verified |
| `POST` | `/checkout/webhooks/mpesa` | — | Daraja STK callback (ResultCode 0 → confirm) |
| `POST` | `/checkout/webhooks/paypal` | signed | PayPal webhook capture confirmation |

## Certificates — Sprint 6 (US-5.1.2)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/certificates` | bearer | My certificates (`{ items }`) |
| `GET` | `/certificates/:certificateId` | bearer | Certificate detail (owner only) |
| `GET` | `/certificates/:certificateId/download` | bearer | Certificate PDF (application/pdf attachment) |
| `GET` | `/courses/:slug/certificate` | bearer | Eligibility: `{eligible, percent, quizPercent, quizzesPassed, issued, certificate}` |
| `POST` | `/courses/:slug/certificate` | bearer | Claim (idempotent issue) → `201 { certificate }` |
| `GET` | `/verify/:certificateNumber` | — | Public verification payload |

Claim sequence: all lessons completed **and** course quizzes passed (≥ `quizPassRequired`) → eligible; issuing stores a unique `TDS-CERT-…` number, writes the PDF to storage and returns `{downloadUrl, verifyUrl, linkedinUrl}`.

## Admin — Sprint 7 (US-7.1.x)

Every `/admin/*` route requires `role=admin` (route-level guard on top of Bearer auth); non-admins get `403`. Admin actions append rows to the audit log.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/admin/overview` | bearer + admin | Platform stats: users by role, published courses, paid orders, revenue, pending GDPR, certificates |
| `GET` | `/admin/users` | bearer + admin | List/search (`search`), filter (`role`, `status` incl. `pending_verification`), paginate (`page`, `pageSize`) |
| `PATCH` | `/admin/users/:id` | bearer + admin | Change `{role, status}` — self-demotion & last-admin guards, admin must be demoted before suspension |
| `POST` | `/admin/users/bulk-suspend` | bearer + admin | Bulk suspend up to 500 users (`{userIds}`), never self, never admins |
| `POST` | `/admin/users/:id/force-password-reset` | bearer + admin | Mint reset token + email link |
| `DELETE` | `/admin/users/:id` | bearer + admin | GDPR-delete (requires a completed export first → 409 otherwise) |
| `GET` | `/admin/users/export.csv` | bearer + admin | Streaming CSV of filtered users |
| `GET` | `/admin/config` | bearer + admin | Current `PlatformConfig` |
| `PATCH` | `/admin/config` | bearer + admin | Partial patch (branding/email/maintenance/payments/features) → `{config, revisionId}`; propagates within 60 s |
| `GET` | `/admin/config/revisions?limit=` | bearer + admin | Last N full-config snapshots |
| `POST` | `/admin/config/revisions/:id/rollback` | bearer + admin | Restore a snapshot as the active config |
| `GET` | `/admin/audit?actorId=&targetType=&limit=` | bearer + admin | Append-only audit trail |
| `GET` | `/admin/gdpr/requests` | bearer + admin | All GDPR requests across the platform |
| `POST` | `/admin/users/:id/gdpr-export` | bearer + admin | Trigger an export on a learner's behalf (email-confirmed) |
| `POST` | `/admin/users/:id/gdpr-delete` | bearer + admin | Trigger deletion on a learner's behalf (email-confirmed) |

Enforcement notes: **maintenance mode** → all non-admin requests get `503` (auth/health excluded so admins can log in and disable); **payment-gateway toggles** → `POST /checkout/orders` returns `400 provider_disabled` for a disabled provider; **feature flags** → e.g. `features.certificates=false` makes `POST /courses/:slug/certificate` return `400`.

## GDPR — Sprint 7 (US-7.2.1)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/gdpr/export` | bearer | Request a data export → email confirmation code |
| `POST` | `/gdpr/delete` | bearer | Request account deletion → email confirmation code |
| `POST` | `/gdpr/confirm` | bearer | Confirm with `{token}` → export ZIP generated or account anonymised |
| `GET` | `/gdpr/requests` | bearer | My requests with statuses + `downloadUrl` |
| `GET` | `/gdpr/exports/:requestId/download` | bearer (owner) | Download the completed ZIP (`application/zip`) |

Request lifecycle: `pending_confirmation` → (confirm with single-use hashed token, 24 h expiry) → `processing` → `completed` (ZIP or anonymise) | `failed` | `cancelled`. Deletion keeps the user row (PII scrubbed, `status=deleted`, email → `deleted-…@privacy.takwimu.school`) so aggregate statistics survive; the request row is retained 30 days.

## Discussions — Sprint 8 (US-6.1.1)

Access rule: only **enrolled learners**, the **course instructor**, or **admins** may read/post in a lesson's thread (403 otherwise). Replies are capped at depth 2.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/discussions/lessons/:lessonId` | bearer + enrolled/owner | Thread: `{courseId, lessonId, count, posts[] (nested replies, userVoted), moderator}` |
| `POST` | `/discussions/lessons/:lessonId/posts` | bearer + enrolled/owner | Create post `{body (≤4000), parentId?}` → `201 DiscussionPost`; reply triggers a `discussion_reply` notification to the parent author |
| `POST` | `/discussions/posts/:id/vote` | bearer + enrolled/owner | Toggle upvote → `{postId, upvoteCount, voted}` |
| `PATCH` | `/discussions/posts/:id` | bearer + author | Edit own post `{body}` (marks edited) |
| `POST` | `/discussions/posts/:id/moderation` | bearer + instructor/admin | `{action: hide\|unhide\|delete, reason?}` — hidden posts stay visible to author + moderators; delete removes the subtree |
| `GET` | `/discussions/courses/:courseId/search?q=` | bearer + enrolled/owner | Flat ILIKE search across visible top-level posts (min 2 chars) |

## Notifications — Sprint 8 (US-10.1.1)

Types: `discussion_reply`, `assignment_graded`, `course_content_added`, `certificate_issued`, `payment_receipt`, `streak_reminder`, `instructor_announcement` — each independently toggleable (plus a master `marketing` flag).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/notifications?limit=` | bearer | In-app list (newest first) + unread count |
| `GET` | `/notifications/unread-count` | bearer | `{unread}` |
| `POST` | `/notifications/read` | bearer | Mark `{ids}` read (omitting ids marks all) |
| `POST` | `/notifications/read-all` | bearer | Mark every notification read |
| `GET` | `/notifications/preferences` | bearer | Current 8 toggles |
| `PATCH` | `/notifications/preferences` | bearer | Partial toggle patch (strict-validated) |
| `POST` | `/courses/:slug/announcements` | bearer + instructor/admin | Broadcast `{title, body, link?}` to every enrolled learner |
| `GET` | `/notifications/unsubscribe?userId=` | — (link in email) | One-click CAN-SPAM unsubscribe: disables all 8 email channels |

Emails embed a per-type unsubscribe link; the in-app bell polls every 60 s and on open.

## Public catalogue API — Sprint 9 (US-8.1.1)

Machine-to-machine access protected by OAuth 2.0 **client-credentials**. The token endpoint sits outside the versioned surface; the public catalogue resource itself is served under `/api/v1/public`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/oauth/token` | client_id + client_secret | Exchange for `{access_token, token_type: Bearer, expires_in: 3600, scope}` (HS256, aud `takwimu:public-api`) |
| `GET` | `/api/v1/public/courses` | `Bearer` (scope `catalogue:read`) | Ranked search, filters, sort, pagination; `fields=slug,title,…` projects a whitelisted subset |
| `GET` | `/api/v1/public/courses/:slug` | `Bearer` | Course detail sans syllabus (`fields` supported) |
| `GET` | `/api/docs.json` / `/api/docs` | — | OpenAPI 3.1 spec + rendered docs page |

All public endpoints honour the per-key hourly rate limit (default 1,000 req/h, Redis or in-memory bucket) → `429` with `Retry-After` on breach, and return OAuth-style `{error, error_description}` bodies on auth failure. Admin key management lives under `/oauth/clients` (US-7.1-style admin guard): `GET/POST`, `POST /:clientId/rotate`, `POST /:clientId/revoke`.

## LTI 1.3 tool provider — Sprint 9 (US-8.1.2)

Public launch surface (versionless, under `/api`); registration & grade ledger management under `/api/v1`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/lti/login` | platform query params | OIDC login initiation → 302 to platform auth endpoint (launch row with state/nonce) |
| `POST` | `/api/lti/launch` | signed `id_token` + state | Verify RS256 against the platform JWKS, resolve learner, upsert enrolment, return HTML auto-post form carrying a one-time launch ticket |
| `POST` | `/api/lti/session` | launch ticket (≤60 s) | Exchange ticket → normal refresh cookie + access token + `targetUrl` for the SPA |
| `GET` | `/api/lti/jwks` | — | Our tool public key set (RS256, `kid` pinned to the env keypair) |
| `GET/POST` | `/api/v1/lti/registrations` | admin | List / register an LMS platform (issuer, clientId, OIDC auth + token + JWKS + AGS URLs, optional pasted key-set JSON) |
| `PATCH/DELETE` | `/api/v1/lti/registrations/:id` | admin | Activate/pause, edit URLs, delete |
| `GET` | `/api/v1/lti/registrations/:id/grades` · `/api/v1/lti/grades` | admin | AGS grade-passback ledger (`pending`/`pushed`/`failed` + error) |

## Learner analytics — Sprint 9 (US-9.1.1)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/analytics/dashboard` | bearer | KPI strip (enrolled, completed, hours week/total, streak, certificates), 90-day heatmap, in-progress courses, recommendations |
| `POST` | `/analytics/heartbeat` | bearer | `{kind: lesson\|video\|quiz\|discussion, courseId?, lessonId?, seconds}` → updates `last_active_at`, inserts an analytics event, returns `{ok, streakDays}` |

## Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | — | `{ok, service, version, time, storage}` |

---

Example error payload:

```json
{
  "statusCode": 403,
  "code": "forbidden",
  "error": "Forbidden",
  "message": "Enrol in the course to watch this video."
}
```