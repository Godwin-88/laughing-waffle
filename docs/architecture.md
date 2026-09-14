# Architecture

Scope delivered through **Sprint 5** of the master specification, with diagrams for key flows.

## Delivered scope

| Sprint | Features | User stories |
| --- | --- | --- |
| **1 — Foundation & Auth** | Email/password + argon2id, email verification, JWT access + httpOnly refresh rotation, RBAC (`learner`/`instructor`/`admin`), Google/Microsoft SSO scaffolding, rate limiting, Helmet CSP | US-1.1.1, US-1.1.2 |
| **2 — Profiles & Catalogue** | 3-step onboarding wizard, bio, avatar (sharp), ranked tsvector + pg_trgm search, facets, sort, pagination; seeded 3-course catalogue + 12-module AWS AI track | US-1.2.x, US-2.1.x |
| **3 — Enrolment & Video** | Free enrolment, enrolment context, playback-position persistence, HLS lesson player (hls.js), enrolment-gated streaming proxy with Range | US-2.2.1, US-3.1.1 |
| **4 — Builder & Pipeline** | Instructor Studio (course/module/lesson CRUD + publish, ownership-scoped), chunked 5 MB upload (local/B2), FFmpeg HLS worker (360p/720p/1080p), captions & posters | US-4.1.1, US-4.1.2, US-4.1.3 |
| **5 — Quizzes & Progress** | Graded end-of-module quizzes (server-side grading, snapshot attempts, time limit + auto-submit, max attempts + cooldown, shuffle, gradebook), progress engine (text auto-complete on scroll/timer, video ≥90% watched, quiz auto-complete on submission, SSE real-time progress stream) | US-3.2.2, US-5.1.1 |

## Runtime map

```mermaid
flowchart LR
    subgraph Clients
        NEXT["Next.js web client :3000"]
    end

    subgraph Gateway["Fastify API :4000  (prefix /api/v1)"]
        AUTH["auth — US-1.1.x"]
        PROF["profile — US-1.2.x"]
        CAT["catalogue — US-2.1.x"]
        ENR["enrolments — US-2.2.1 / 3.1.1 / 5.1.1"]
        QUIZ["quizzes — US-3.2.2"]
        SSE["SSE /me/progress/events — US-5.1.1"]
        VID["video (upload API)"]
        MEDIA["media (HLS streaming proxy)"]
        BLD["builder — US-4.1.x"]
        AUTH_PLUGIN["auth plugin<br/>(Bearer JWT + DB check)"]
    end

    NEXT --> AUTH_PLUGIN
    NEXT --> AUTH & PROF & CAT & ENR & VID & MEDIA & BLD & QUIZ & SSE

    AUTH & PROF --> PG[("PostgreSQL 16")]
    CAT --> PG
    ENR --> PG
    BLD --> PG
    VID --> PG
    QUIZ --> PG
    MEDIA --> PG
    VID --> TRANSCODER["FFmpeg worker"]
    TRANSCODER --> STORE["Storage<br/>local | B2"]
    MEDIA --> STORE
```

## Authentication & session lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor L as Learner
    participant N as Next.js web
    participant A as Fastify API
    participant P as PostgreSQL

    L->>N: Register (email, password, consent)
    N->>A: POST /auth/register
    A->>P: create user (argon2id hash, status=active)
    A-->>N: "201 { userId, devVerificationUrl } + email sent"
    L->>A: GET /auth/verify-email?token=...
    A->>P: SET email_verified_at = now()
    A-->>L: verified

    L->>N: Login
    N->>A: POST /auth/login
    A->>P: verify hash
    A-->>N: "200 { accessToken (15m JWT) } + refresh cookie set"
    N->>A: GET /auth/me (Bearer)
    A->>P: load user + role
    A-->>N: "200 { user }"
    N-->>L: Dashboard

    Note over N,A: On 401 from any protected call...
    N->>A: POST /auth/refresh (cookie only)
    A-->>N: "200 { accessToken } (silent rotation)"
```

## Video pipeline (upload → HLS → watch)

```mermaid
sequenceDiagram
    autonumber
    actor I as Instructor
    participant S as Studio (web)
    participant A as Fastify API
    participant ST as Storage (local | B2)
    participant W as FFmpeg worker
    participant L as Learner (hls.js)

    I->>S: Pick a video file
    S->>A: "POST /instructor/lessons/:id/uploads {filename, sizeBytes}"
    A->>A: "create video_asset + multipart session, lesson -> kind=video"
    A-->>S: "session { assetId, partSizeBytes=5MB, partCount, driver }"

    loop For each 5 MB part
        S->>A: "GET/PUT /instructor/videos/:assetId/parts/:n"
        A->>ST: writePart()
        A-->>S: "ok"
    end

    S->>A: POST /instructor/videos/:assetId/complete
    A->>A: "completeMultipartUpload, video_asset status=queued"
    A->>W: queueTranscodeForAsset (idempotent)
    A-->>S: "status: queued"

    W->>ST: readObject(source)
    W->>W: "ffprobe -> duration/resolution"
    W->>W: "transcode 360p/720p/1080p, write HLS segments + master playlist"
    W->>ST: "upload HLS ladder to private course-assets bucket"
    W->>A: "mark video_asset + lesson ready, email instructor"
    A-->>L: "GET /api/v1/media/hls/:courseId/:lessonId/index.m3u8"

    L->>A: Request manifest or segment (session cookie)
    A->>A: "gate: enrolled? lesson has hlsPrefix?"
    A-->>L: "200 HLS content (Range for .ts) or 403 / 404"
    L->>L: "hls.js loads master, picks ladder rung, plays"
    Note over L: Resume at savedPositionMs,<br/>progress autosaved every 5 s,<br/>auto-complete at >=90% duration
```

## Graded quiz flow (US-3.2.2)

```mermaid
sequenceDiagram
    autonumber
    actor L as Learner
    participant N as Next.js web
    participant A as Fastify API
    participant P as PostgreSQL

    L->>N: Open module-quiz lesson
    N->>A: GET /courses/:slug/lessons/:position/quiz/status (Bearer)
    A->>P: attempts + best grade + cooldown
    A-->>N: "200 { config, questionCount, attemptsUsed, bestAttempt, canAttempt }"

    L->>N: Start quiz
    N->>A: POST .../quiz/attempts
    A->>P: finaliseExpiredAttempts (auto-submit stale)
    A->>P: insert quiz_attempt (status=in_progress, expires_at, snapshot)
    A-->>N: "200 { attemptId, expiresAt, questions[] } (options shuffled, answers masked)"

    Note over N: Countdown timer vs expiresAt, auto-submits at 0
    L->>N: Answer all questions
    N->>A: POST .../attempts/:id/submit { answers }
    A->>A: gradeQuizSnapshot (server-side, vs snapshot)
    A->>P: gradebook upsert (score, percent, passed, submitted_at)
    A->>P: lesson_progress completed=true
    A-->>N: "200 { score, percent, passed, gradebook, per-question results + explanations }"
    A--)N: SSE "lesson-completed { coursePercent }"
```

## Data model

```mermaid
erDiagram
    USERS ||--o{ ENROLMENTS : enrols
    USERS ||--o{ PROGRESS : tracks
    USERS ||--o{ QUIZ_ATTEMPTS : takes
    USERS ||--o{ GRADEBOOK : owns
    USERS ||--o{ COURSE_REVIEWS : writes
    USERS ||--o{ VIDEO_ASSETS : uploads
    USERS ||--o{ ANALYTICS_EVENTS : emits

    COURSES ||--o{ MODULES : contains
    COURSES ||--o{ LESSONS : contains
    COURSES ||--o{ ENROLMENTS : has
    COURSES ||--o{ COURSE_REVIEWS : receives
    COURSES ||--o{ QUIZ_QUESTIONS : associated
    COURSES ||--o{ QUIZ_ATTEMPTS : scoped
    COURSES ||--o{ VIDEO_ASSETS : owns
    COURSES ||--o{ ANALYTICS_EVENTS : scoped

    MODULES ||--o{ LESSONS : groups
    MODULES ||--o{ QUIZ_QUESTIONS : scopes

    LESSONS ||--o{ PROGRESS : measured
    LESSONS ||--o{ QUIZ_QUESTIONS : "quick-check + graded"
    LESSONS ||--o{ QUIZ_ATTEMPTS : snapshots
    LESSONS ||--o{ GRADEBOOK : grades
    LESSONS ||--o{ VIDEO_ASSETS : "video source(s)"

    VIDEO_ASSETS ||--o{ TRANSCODE_JOBS : "queues"

    USERS {
        uuid id PK
        text email UK
        text first_name
        text last_name
        text role "learner|instructor|admin"
        text status "active|disabled"
        timestamptz email_verified_at
        timestamptz consent_given_at
        text sso_provider
        text sso_subject
        jsonb interests
        text experience_level
        int wizard_step
    }
    COURSES {
        uuid id PK
        uuid instructor_id FK "to USERS"
        text slug UK
        text title
        text category
        int price_cents
        text status "draft|published|archived"
        jsonb objectives
        tsvector search_tsv
    }
    MODULES {
        uuid id PK
        uuid course_id FK
        int position
        text title
        int week
        int hours_estimate
        text exam_coverage
        jsonb objectives
    }
    LESSONS {
        uuid id PK
        uuid course_id FK
        uuid module_id FK "nullable"
        int position
        text title
        text kind "text|video|notebook|lab|quiz"
        boolean published
        text video_status "none|uploading|queued|transcoding|ready|failed"
        text hls_prefix
        int video_duration_seconds
        text video_poster_key
        text captions_key
        jsonb content_json
    }
    ENROLMENTS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        text status
        int price_paid_cents
        timestamptz enrolled_at
        text unique_user_course "UK(user_id, course_id)"
    }
    PROGRESS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        uuid lesson_id FK
        boolean completed
        int last_position_ms
        timestamptz updated_at
        text unique_user_lesson "UK(user_id, lesson_id)"
    }
    QUIZ_ATTEMPTS {
        uuid id PK
        uuid user_id FK
        uuid course_id FK
        uuid lesson_id FK
        int attempt_number
        text status "in_progress|submitted|expired"
        timestamptz started_at
        timestamptz expires_at
        jsonb questions_snapshot "shuffled, answers masked"
        jsonb answers
        int score
        int max_score
        numeric percent
        boolean passed
        boolean auto_submitted
    }
    GRADEBOOK {
        uuid id PK
        uuid user_id FK
        uuid lesson_id FK
        text item_type "quiz"
        int score
        int max_score
        numeric percent
        boolean passed
        timestamptz submitted_at
        text unique_user_item "UK(user_id, lesson_id)"
    }
    VIDEO_ASSETS {
        uuid id PK
        uuid course_id FK
        uuid lesson_id FK
        uuid user_id FK "instructor"
        text source_key
        text upload_id
        jsonb parts
        int source_size_bytes
        text status "uploading|queued|processing|ready|failed"
        text hls_prefix
        int duration_seconds
    }
    TRANSCODE_JOBS {
        uuid id PK
        uuid asset_id FK
        text state "queued|processing|done|failed"
        int attempts
        text error
    }
    ANALYTICS_EVENTS {
        uuid id PK
        text event_name
        uuid user_id FK
        uuid course_id FK
        uuid lesson_id FK
        jsonb payload
    }
```
## Enrolment & progress lifecycle

```mermaid
flowchart LR
    A["Learner opens course page"] --> B{Authenticated?}
    B -- No --> C["Enrol CTA -> /login?next=..."]
    B -- Yes --> D["POST /enrolments {courseSlug}"]
    D --> E{Price > 0?}
    E -- Yes --> F["Paid checkout (Sprint 6 not built) -> blocked"]
    E -- No --> G["Insert enrolment (unique user+course)"]
    G --> H["Redirect to first lesson"]
    H --> I{"Lesson kind?"}
    I -- video --> K["hls.js player; autosave every 5 s"]
    K --> K2{max position >= 90% duration?}
    K2 -- Yes --> M["completed=true (US-5.1.1)"]
    K2 -- No --> L2["watch-threshold SSE event"]
    I -- text --> T["auto-complete on scroll-to-bottom OR 60s on page"]
    T --> M
    I -- quiz --> Q["auto-complete on submission (gradebook write)"]
    Q --> M
    M --> N["lesson_progress upsert (survives session expiry)"]
    N --> N2["SSE lesson-completed { coursePercent }"]
    N2 --> O["Dashboard My Learning bar updates in real time"]
```

## Delivery roadmap (master spec)

```mermaid
gantt
    title Takwimu LMS delivery
    dateFormat  YYYY-MM-DD
    axisFormat  S%n
    section Sprint 1
    Auth, SSO metadata, DB schema     :s1, 2026-09-01, 7d
    section Sprint 2
    Learner profile, catalogue        :s2, after s1, 7d
    section Sprint 3
    Enrolment, progress, video lesson :s3, after s2, 7d
    section Sprint 4
    Course builder, video pipeline    :s4, after s3, 7d
    section Sprint 5
    Graded quizzes & progress engine  :s5, after s4, 7d
    section Sprint 6
    Checkout & payments               :s6, after s5, 7d
    section Sprint 7
    Assessments & certificates        :s7, after s6, 7d
    section Sprint 8
    Analytics & instructor console    :s8, after s7, 7d
    section Sprint 9
    Admin, compliance, migrations     :s9, after s8, 7d
    section Sprint 10
    Hardening, observability, launch  :s10, after s9, 7d
```

**Done:** Sprints 1–5 · **Next:** Sprint 6 (paid checkout — currently blocks paid enrolment on priced courses), 7–10.
```