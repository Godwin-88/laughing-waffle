# Architecture

Scope delivered through **Sprint 7** of the master specification, with diagrams for key flows.

## Delivered scope

| Sprint | Features | User stories |
| --- | --- | --- |
| **1 — Foundation & Auth** | Email/password + argon2id, email verification, JWT access + httpOnly refresh rotation, RBAC (`learner`/`instructor`/`admin`), Google/Microsoft SSO scaffolding, rate limiting, Helmet CSP | US-1.1.1, US-1.1.2 |
| **2 — Profiles & Catalogue** | 3-step onboarding wizard, bio, avatar (sharp), ranked tsvector + pg_trgm search, facets, sort, pagination; seeded 3-course catalogue + 12-module AWS AI track | US-1.2.x, US-2.1.x |
| **3 — Enrolment & Video** | Free enrolment, enrolment context, playback-position persistence, HLS lesson player (hls.js), enrolment-gated streaming proxy with Range | US-2.2.1, US-3.1.1 |
| **4 — Builder & Pipeline** | Instructor Studio (course/module/lesson CRUD + publish, ownership-scoped), chunked 5 MB upload (local/B2), FFmpeg HLS worker (360p/720p/1080p), captions & posters | US-4.1.1, US-4.1.2, US-4.1.3 |
| **5 — Quizzes & Progress** | Graded end-of-module quizzes (server-side grading, snapshot attempts, time limit + auto-submit, max attempts + cooldown, shuffle, gradebook), progress engine (text auto-complete on scroll/timer, video ≥90% watched, quiz auto-complete on submission, SSE real-time progress stream) | US-3.2.2, US-5.1.1 |
| **6 — Checkout & Payments** | Paid orders (Stripe / M-Pesa Daraja STK / PayPal adapters plug into one server-side confirm path), mock-mode end-to-end payments, order numbers + receipts (`TDS-…`), confirmation polling, and the certificate programme (eligibility gate = all lessons + passed quizzes → idempotent issue → PDF via pdfkit → public verification + LinkedIn deep link) | US-2.2.2, US-5.1.2 |
| **7 — Admin & GDPR** | Admin panel: user management (search/filter, role & status changes with last-active tracking, bulk suspend, force password reset, CSV export, audit log per action) + platform configuration (branding, email sender, maintenance mode → global 503, payment-gateway toggles enforced at checkout, feature flags e.g. certificates, revision snapshots + rollback, Redis-backed 60s propagation). GDPR (US-7.2.1): self-service export (ZIP: profile, enrolments, progress, quiz attempts, gradebook, orders, certificates, analytics) and delete (PII scrub, `deleted` status, row retained for stats), email-confirmed opaque tokens, admin-on-behalf flows with export-prerequisite | US-7.1.x, US-7.2.1 |

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
        ORD["checkout — US-2.2.2<br/>orders, confirm, webhooks"]
        CERT["certificates — US-5.1.2<br/>eligibility, issue, verify"]
        ADM["admin — US-7.1.x<br/>users, config, audit"]
        GDPR["gdpr — US-7.2.1<br/>export, delete, confirm"]
        AUTH_PLUGIN["auth plugin<br/>(Bearer JWT + DB check)"]
    end

    NEXT --> AUTH_PLUGIN
    NEXT --> AUTH & PROF & CAT & ENR & VID & MEDIA & BLD & QUIZ & SSE & ORD & CERT & ADM & GDPR

    AUTH & PROF --> PG[("PostgreSQL 16")]
    CAT --> PG
    ENR --> PG
    BLD --> PG
    VID --> PG
    QUIZ --> PG
    MEDIA --> PG
    ORD --> PG
    CERT --> PG
    CERT --> STORE
    ADM --> PG
    GDPR --> PG
    GDPR --> STORE
    ADM --> REDIS[("Redis 7<br/>config cache, 60s TTL")]
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

## Paid checkout & certificates (US-2.2.2, US-5.1.2)

```mermaid
sequenceDiagram
    autonumber
    actor L as Learner
    participant N as Next.js web
    participant A as Fastify API
    participant P as PostgreSQL
    participant PR as Provider (Stripe / M-Pesa / PayPal)

    L->>N: Buy now on course page
    N->>A: POST /checkout/orders { courseSlug, provider }
    A->>P: insert orders (pending) + generate orderNumber
    A->>PR: createPayment (intent / STK push / capture)
    A-->>N: "200 { order, mode: mock|live, client }"
    N->>L: /checkout/:orderId (provider selector + amount due)

    alt mock mode (dev default)
        L->>N: Pay (simulated)
        N->>A: POST /checkout/orders/:id/complete
        A->>P: orders → paid + receipt + enrolments upsert
        A-->>N: "200 { order.status: paid }"
    else live mode
        L->>PR: Confirm with provider (Stripe.js / PayPal / STK)
        PR-->>A: webhook (signed) / STK callback
        A->>P: orders → paid + receipt + enrolments upsert
        N->>A: GET /checkout/orders/:id/status (poll, ~5 s)
        A-->>N: "200 { order.status }"
    end

    Note over L: 100% lessons + passed quizzes
    L->>N: Claim certificate
    N->>A: GET /courses/:slug/certificate (eligibility)
    A-->>N: "200 { eligible }"
    N->>A: POST /courses/:slug/certificate (idempotent)
    A->>P: insert certificates (TDS-CERT-…, unique number)
    A->>A: buildCertificatePdf (pdfkit) → storage
    A-->>N: "201 { certificate: { downloadUrl, verifyUrl, linkedinUrl } }"
    L->>N: Download PDF / share to LinkedIn
    N->>A: GET /certificates/:id/download (Bearer)
    A->>A: stream stored PDF
    A-->>L: application/pdf attachment
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
        text status "active|disabled|suspended|deleted"
        timestamptz email_verified_at
        timestamptz consent_given_at
        timestamptz last_active_at
        timestamptz force_password_reset_at
        timestamptz deleted_at
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
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK "USERS.id"
        text action
        text target_type
        uuid target_id
        jsonb details
        timestamptz created_at
    }
    PASSWORD_RESET_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash "hashed at rest"
        timestamptz expires_at
        timestamptz used_at
        timestamptz created_at
        uuid created_by FK "admin who forced it"
    }
    SYSTEM_CONFIG {
        text key PK
        jsonb value
        uuid updated_by FK
        timestamptz updated_at
    }
    CONFIG_REVISIONS {
        uuid id PK
        jsonb snapshot "full config snapshot"
        uuid actor_id FK
        timestamptz applied_at
    }
    DATA_REQUESTS {
        uuid id PK
        uuid user_id FK
        text type "export|delete"
        text status "pending_confirmation|processing|completed|failed|cancelled"
        text initiated_by "self|admin"
        uuid admin_id FK
        text token_hash "hashed, single-use"
        text storage_key "export ZIP"
        timestamptz requested_at
        timestamptz confirmed_at
        timestamptz completed_at
        timestamptz expires_at
    }
```
## Enrolment & progress lifecycle

```mermaid
flowchart LR
    A["Learner opens course page"] --> B{Authenticated?}
    B -- No --> C["Enrol CTA -> /login?next=..."]
    B -- Yes --> D["POST /enrolments {courseSlug}"]
    D --> E{Price > 0?}
    E -- Yes --> F["POST /checkout/orders -> redirect to /checkout/:orderId<br/>mock/live; webhook or poll confirm (Sprint 6)"]
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

## GDPR & admin flows (Sprint 7)

```mermaid
sequenceDiagram
    autonumber
    actor L as Learner
    actor A as Admin
    participant N as Next.js web
    participant API as Fastify API
    participant P as PostgreSQL
    participant ST as Storage (local | B2)

    Note over L,API: US-7.2.1 self-service export
    L->>N: Settings → Privacy & data → Request export
    N->>API: POST /gdpr/export
    API->>P: insert data_requests (pending_confirmation, token_hash)
    API-->>L: email with one-time confirm code
    L->>API: POST /gdpr/confirm { token }
    API->>P: status → processing, consume token
    API->>P: read profile/enrolments/progress/quiz/orders/certs
    API->>ST: write gdpr-exports/:id.zip
    API->>P: status → completed + storage_key
    L->>API: GET /gdpr/exports/:id/download
    API-->>L: application/zip (PK)

    Note over A,API: US-7.1.1 admin user management + audit
    A->>API: PATCH /admin/users/:id { role | status }
    API->>API: requireAdminRole guard (route-level)
    API->>P: update + INSERT audit_logs (user.role_changed / user.suspended)
    A->>API: GET /admin/audit
    API-->>A: append-only trail

    Note over A,API: US-7.1.2 platform configuration
    A->>API: PATCH /admin/config { maintenance/payments/features }
    API->>P: snapshot → config_revisions + upsert system_config
    API->>API: invalidate Redis cache (60s TTL propagation)
    A->>API: POST /admin/config/revisions/:id/rollback
    API->>P: snapshot current + restore chosen snapshot
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
    Admin panel & GDPR                :s7, after s6, 7d
    section Sprint 8
    Discussions & notifications       :s8, after s7, 7d
    section Sprint 9
    LTI 1.3, API, analytics           :s9, after s8, 7d
    section Sprint 10
    SAML SSO, bulk enrolment, offline :s10, after s9, 7d
```

**Done:** Sprints 1–7 · **Next:** Sprint 8 (Discussions US-6.1.1 & Notifications US-10.1.1).
