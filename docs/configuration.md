# Configuration

Everything sensitive lives only in `.env` / `.env.local` files, **never** in the repository. Tracked templates: `apps/api/.env.example`, `apps/web/.env.example`, root `.env.example`.

## API environment (`apps/api/.env`)

Copy the template and fill values:

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://takwimu:takwimu_dev@localhost:5432/takwimu_lms` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Rate limiting / caching |
| `API_PORT` | `4000` | API listening port |
| `PUBLIC_API_URL` | `http://localhost:4000` | Public base URL (HLS links, mail templates) |
| `WEB_ORIGIN` | `http://localhost:3000` | Allowed CORS origin (cookie credentials) |
| `JWT_SECRET` | *(required, ≥ 32 chars)* | Signs access + refresh tokens. **Rotate in production.** |
| `JWT_ACCESS_TTL` | `15m` | Access-token lifetime |
| `JWT_REFRESH_TTL_DAYS` | `30` | Refresh cookie lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `SMTP_URL` | *(empty → console mailer)* | SendGrid / Amazon SES connection string |
| `SMTP_FROM` | `Takwimu Data School <no-reply@takwimu.school>` | Sender address |
| `STORAGE_DRIVER` | `auto` | `auto` → B2 when keys are present, otherwise `local` |
| `TRANSCODE_WORKER` | `on` | Start the FFmpeg worker at boot (set `off` in read-only nodes) |
| `API_MAX_UPLOAD_BYTES` | `10000000000` (10 GB) | Chunked video upload cap |
| `B2_ENDPOINT` | *(empty)* | B2 S3-compatible endpoint (custom buckets only) |
| `B2_BUCKET_COURSE_ASSETS` | `lms-course-assets` | Private bucket: HLS ladders, sources, VTT, posters |
| `B2_BUCKET_USER_UPLOADS` | `lms-user-uploads` | Private user files (avatars historically; now course-assets) |
| `B2_BUCKET_PUBLIC` | `lms-public` | Public-cacheable objects |
| `B2_KEY_ID` | *(empty)* | B2 application key ID |
| `B2_APP_KEY` | *(empty)* | B2 application key secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(empty)* | Google OIDC SSO |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | *(empty)* | Microsoft OIDC SSO |

## Web environment (`apps/web/.env.local`)

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL your browser uses to reach the API |

## Storage modes

### Local (development default)
- `STORAGE_DRIVER=local` — objects are written under the API's data directory.
- Multipart uploads are reassembled into a single local file per object; parts are PUT directly to the API.
- HLS is served through the `/api/v1/media/hls/…` proxy exactly as in production.

### Backblaze B2 (production)
- Set `B2_KEY_ID`, `B2_APP_KEY`, and set `STORAGE_DRIVER=b2` (or just supply the keys with `auto`).
- Chunked parts use **presigned `UploadPart` URLs**; the browser PUTs directly to B2 and reports completion.
- HLS remains above the proxy so object keys never leak and enrolment gating is enforced.

## Email

- Without `SMTP_URL` the console mailer logs verification links and notifications to stdout — perfect for local dev.
- With `SMTP_URL` (e.g. `smtps://user:pass@host:465`), `nodemailer` sends through SendGrid/SES.

## SSO (OIDC)

Google and Microsoft flows are scaffolded in `apps/api/src/modules/auth/sso.ts`:

1. Provide client ID/secret in `.env` for each provider.
2. Register the callback URL in the provider console:
   `http://localhost:4000/api/v1/auth/sso/:provider/callback`
3. The web app detects enabled providers from `GET /auth/me` (`sso` field) and renders the provider buttons.
4. SSO auto-verifies email and creates/links the account (JIT provisioning); role assignment is a Sprint 9 concern.

## Payments & certificates (Sprint 6)

- `PAYMENTS_MODE=mock` is the default: `POST /checkout/orders` still creates a real pending order, and `POST /checkout/orders/:id/complete` simulates the provider capture (`pending → paid` + enrolment upsert). No credentials required.
- Live mode (`PAYMENTS_MODE=live`) needs provider keys — `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, `MPESA_*` (Daraja STK: consumer key/secret, passkey, shortcode, callback URL) or `PAYPAL_*` (client id/secret/webhook id). Signed webhooks then drive the same confirm path.
- Certificates need only storage (local or B2); PDFs are generated server-side with `pdfkit`.

## Security checklist for production

- `JWT_SECRET` at least 32 random characters, stored in the secret manager, rotated on deploy.
- `COOKIE_SECURE=true`, `NODE_ENV=production`.
- Restrict CORS to the real domain (`WEB_ORIGIN`).
- Configure SMTP so verification links are not printed to logs.
- Run the API behind TLS; keep `TRANSCODE_WORKER` on only on the media worker node.
- Add SSRF/key guards before enabling B2 custom endpoints.