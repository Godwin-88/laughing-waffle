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
| `POST` | `/enrolments` | bearer | Free enrol by `{courseSlug}`; paid courses rejected until Sprint 6 |
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