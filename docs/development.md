# Development Guide

## Project layout

```
lms-platform/
├── apps/
│   ├── api/                      # Fastify 5 API (TypeScript, ESM)
│   │   ├── scripts/migrate.ts    # idempotent SQL migration runner
│   │   └── src/
│   │       ├── config/           # env loading/validation
│   │       ├── db/               # schema.ts (Drizzle), migrations/*.sql, client.ts
│   │       ├── lib/              # errors, tokens, password, users, events, slug
│   │       ├── mail/             # mailer interface: console + SMTP transports
│   │       ├── modules/          # auth · profile · catalogue · files
│   │       │                     #   enrolments · video · builder
│   │       ├── plugins/          # fastify auth plugin (JWT + DB check)
│   │       ├── storage/          # storage interface: local + Backblaze B2
│   │       └── seed/             # run.ts + data (syllabus, courses.json, …)
│   ├── web/                      # Next.js 15 App Router client
│   │   ├── app/                  # / · /courses · /dashboard · /studio · auth…
│   │   ├── components/           # Header · CourseCard · VideoPlayer
│   │   │                         #   EnrollCard · MarkCompleteButton · …
│   │   └── lib/                  # api.ts client, auth-context
│   └── shared/                   # @takwimu/shared (workspace `*`)
├── packages/shared/              # DTOs, validation constants, types
├── docs/                         # architecture, configuration, API, development
├── docker-compose.yml            # Postgres 16 + Redis 7
└── README.md
```

## Commands (workspace root)

| Command | What it does |
| --- | --- |
| `npm install` | Installs all workspaces from the lockfile |
| `npm run db:up` / `db:down` | Start/stop Postgres + Redis containers |
| `npm run db:migrate` | Apply pending SQL migrations (`apps/api/scripts/migrate.ts`) |
| `npm run db:seed` | Seed catalogue, syllabus and demo account |
| `npm run dev` | Run API (`:4000`) + Web (`:3000`) concurrently |
| `npm run dev:api` / `dev:web` | Run a single service |
| `npm run typecheck` | Type-check all workspaces |
| `npm test` | API unit tests (vitest) |
| `npm run build` | Production build of the web app |

## Migrations

- SQL files: `apps/api/src/db/migrations/000N_*.sql`, applied in order and recorded by filename.
- **Never edit an applied migration** — add a new file instead.
- Keep `apps/api/src/db/schema.ts` in sync with the SQL so Drizzle queries type-check.

## Seed data

`apps/api/src/seed/run.ts` ingests:
- `seed/data/courses.json` + `courses-extra.json` — course catalogue rows
- `seed/data/aws-ai-certification-syllabus.md` — the 12-module AWS AI track
- `seed/data/takwimu-data-school.md` — school copy for pages
- `seed/data/what-is-an-ai-engineer.md` — the first WIP lesson (with Quick-Check quiz)

Demo account created at seed time: `demo@takwimu.school` / `Takwimu123`, plus a free course
("Prompt Engineering for Analysts") if you exercise the builder flow locally.

## Adding a module / API area

1. Create `apps/api/src/modules/<name>/service.ts` (business logic) + `routes.ts` (Fastify router).
2. Register the router in `apps/api/src/app.ts` inside the `/api/v1` prefix.
3. Add DTOs to `packages/shared/src/index.ts`; consume them from web `lib/api.ts`.
4. Add a migration if the schema changes; run `npm run db:migrate`.
5. Typecheck + test, then run the seeded smoke flows through the UI.

## Frontend conventions

- App Router with `"use client"` for interactive components; server components for catalogue reads.
- Auth state comes from `apps/web/lib/auth-context.tsx` (`useAuth()` → `user`, `loading`, `logout`).
- All API access goes through `apps/web/lib/api.ts` which handles silent token refresh.
- Styling: Tailwind CSS v4 with `brand`/`ink`/`accent` theme tokens; **Raleway** is the platform font (loaded in `app/layout.tsx` / `globals.css`).

## Testing

```bash
npm run typecheck   # strict TS across api + web
npm test            # vitest: lib unit tests (12 passing)
```

Verified live, end-to-end, in local dev:
1. register → verify → login → refresh (401 self-heal)
2. catalogue search, facets, lesson reader + Quick-Check
3. free enrolment → progress save → resume link in Dashboard
4. Studio: create course → add module/lesson → publish → appears in `/courses`
5. chunked upload → transcode worker → `GET /media/hls/…` gating (200 enrolled / 403 anonymous)

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing required environment variable` | Copy `.env.example` to `.env` / `.env.local` (see `docs/configuration.md`) |
| API won't start; DB refused | `npm run db:up` and wait for `healthy` state |
| `port already in use` | `ss -tlnp | grep -E ':(4000|3000)'` and stop the previous process |
| Migration says "already applied" | Check `apps/api/src/db/migrations` name against the DB `migrations` table |
| Video stays `queued` | Verify `TRANSCODE_WORKER=on` and that `ffmpeg-static` resolved `ffmpegPath` |
| Video `failed` | Open the asset status endpoint — probe errors surface the ffmpeg stderr tail |
| Transcode on a headless server | `ffmpeg-static` bundles a static binary; no system ffmpeg required |
| Paid course won't enrol | Buy now → `/checkout/:id`; with `PAYMENTS_MODE=mock` click *Pay (simulated)*. If the "payment did not confirm" error persists, check `orders.status` in the DB (mock completion flips `pending → paid` and upserts the enrolment) |
| Admin page returns 403 | Confirm the account `role=admin` in `users` (seeded `admin@takwimu.school` / `Takwimu123`). Non-admins get 403 on every `/admin/*` route |
| Maintenance banner everywhere | The platform config still has `maintenance.enabled=true` — open `/admin/settings` (admins bypass the 503) and disable it, or restore a previous revision |
| GDPR delete fails (503) | The export/delete worker surfaced a processing error — check `data_requests.error` in the DB; the most common cause is a DB CHECK-constraint violation (e.g. `users_status_check`), fixed by migration 0006 |
| GDPR ZIP download 404 | Only the owning learner (or an admin) may download; requests older than their `expires_at` are invalid |
| Discussion says 403 | You must be enrolled in the course (or be its instructor / admin). Seed demo learner is enrolled in the AWS track |
| No in-app notifications | Preferences may be all-off, or the type is disabled — check `GET /notifications/preferences` and the bell dropdown's Mark-all path |
| Reply notification missing | Replies notify the post author only if their `discussionReply` preference is on; the one-click unsubscribe link sets *all* types false (re-enable in Settings → Notifications) |
| Instructor can't moderate | The course must have `instructor_id` set — `npm run db:seed` now links every seeded course to `ina@takwimu.dev` |
| Public API 401 | The `client_id`/`client_secret` pair isn't active (revoked rotates invalidate tokens). Create a key in `/admin/api-clients`, then `POST /api/oauth/token` with `grant_type=client_credentials` |
| Public API 429 | Hit the hourly per-key limit — wait for the window shown in `Retry-After`, or raise `PUBLIC_API_RATE_LIMIT_PER_HOUR` |
| `/api/docs.json` 404 | The docs module registers under `/api`; check `registerDocsRoutes` is still wired in `apps/api/src/app.ts` |
| LTI launch "no keys" | Verify the platform registration's `jwksUrl`/`platformKeySetJson` reachable; key rotation regenerates `apps/api/.data/lti-jwks.json` |
| Analytics dashboard 401 | `/analytics/*` requires a signed-in learner — heartbeats are only meaningful for active accounts |

## Deployment sketch

- **API**: build `apps/api`, run `npm start` behind TLS; Postgres/Redis managed; `TRANSCODE_WORKER=on` on a media-capable node.
- **Web**: `npm run build` + `npm start` (or static export) behind the CDN.
- **Storage**: B2 buckets (`B2_BUCKET_*`), keys in the secret manager.
- **Videos**: keep the source + HLS ladder in the private `course-assets` bucket; only the API proxy serves them.