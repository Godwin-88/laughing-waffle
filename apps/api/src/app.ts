import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastify from "fastify";
import rawBodyPlugin from "fastify-raw-body";
import { registerSamlRoutes } from "./modules/saml/routes";
import { registerBulkEnrolmentRoutes } from "./modules/bulk-enrolment/routes";
import { registerOfflineRoutes } from "./modules/offline/routes";
import type { Env } from "./config/env";
import { loadEnv } from "./config/env";
import { registerErrorHandler } from "./lib/errors";
import authPlugin from "./plugins/auth";
import { registerAuthRoutes } from "./modules/auth/routes";
import { registerCatalogueRoutes } from "./modules/catalogue/routes";
import { registerFilesRoutes } from "./modules/files/routes";
import { registerProfileRoutes } from "./modules/profile/routes";
import { registerEnrolmentRoutes } from "./modules/enrolments/routes";
import { registerVideoRoutes } from "./modules/video/routes";
import { registerMediaRoutes } from "./modules/video/media";
import { registerBuilderRoutes } from "./modules/builder/routes";
import { registerQuizRoutes, registerProgressEventsRoute } from "./modules/quizzes/routes";
import { registerCheckoutRoutes, registerCheckoutWebhooks } from "./modules/checkout/routes";
import { registerCertificateRoutes } from "./modules/certificates/routes";
import { registerGdprRoutes } from "./modules/gdpr/routes";
import { registerAdminRoutes } from "./modules/admin/routes";
import { registerDiscussionRoutes } from "./modules/discussions/routes";
import { registerNotificationRoutes, registerNotificationPreferencesRoute } from "./modules/notifications/routes";
import { installMaintenanceGuard } from "./modules/admin/guard";
import { registerAnalyticsRoutes } from "./modules/analytics/routes";
import { registerOAuthRoutes } from "./modules/oauth/routes";
import { registerOAuthAdminRoutes } from "./modules/oauth/admin-routes";
import { registerPublicApiRoutes } from "./modules/public-api/routes";
import { registerDocsRoutes } from "./modules/public-api/openapi";
import { registerLtiRoutes, registerLtiAdminRoutes } from "./modules/lti/routes";
import { getStorage } from "./storage/storage";

export interface BuildOptions {
  env?: Env;
  logger?: boolean | { level?: string };
}

export async function buildApp(opts: BuildOptions = {}) {
  const env = opts.env ?? loadEnv();
  const app = fastify({
    logger: opts.logger === undefined
      ? { level: env.NODE_ENV === "development" ? "info" : "warn" }
      : opts.logger,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });
  app.decorate("config", env);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'", "https:", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN, env.PUBLIC_API_URL],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 6 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute", global: true, skipOnError: true });

  // Raw HTTP body capture for signed payment webhooks (Stripe/PayPal).
  await app.register(rawBodyPlugin, { field: "rawBody", global: true });

  // Raw byte parsers for chunked video-part PUTs (US-4.1.2 local driver).
  // The browser uploads 5 MB slices with the source MIME type; Fastify has no
  // parser for those by default, so we buffer them here.
  const rawTypes = [
    "application/octet-stream",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/x-msvideo",
  ];
  for (const type of rawTypes) {
    app.addContentTypeParser(type, (req, payload, done) => {
      const chunks: Buffer[] = [];
      payload.on("data", (chunk: Buffer) => chunks.push(chunk));
      payload.on("end", () => done(null, Buffer.concat(chunks)));
      payload.on("error", (err) => done(err as Error));
    });
  }

  await app.register(authPlugin);

  // API v1
  await app.register(
    async (api) => {
      // US-7.1.2 maintenance mode — global 503 for non-admins while enabled.
      installMaintenanceGuard(api);
      await api.register(
        async (v1) => {
          v1.get("/health", async () => ({
            ok: true,
            service: "takwimu-lms-api",
            version: "0.1.0",
            time: new Date().toISOString(),
            storage: getStorage().name,
          }));
          registerAuthRoutes(v1);
          registerProfileRoutes(v1);
          registerCatalogueRoutes(v1);
          registerFilesRoutes(v1);
          registerEnrolmentRoutes(v1);
          registerVideoRoutes(v1);
          registerMediaRoutes(v1);
          registerBuilderRoutes(v1);
          registerQuizRoutes(v1);
          registerProgressEventsRoute(v1);
          registerCheckoutRoutes(v1);
          registerCheckoutWebhooks(v1);
          registerCertificateRoutes(v1);
          registerGdprRoutes(v1);
          registerAdminRoutes(v1);
          registerDiscussionRoutes(v1);
          registerNotificationRoutes(v1);
          // US-10.1.1 one-click unsubscribe (CAN-SPAM / GDPR Art. 21) — the
          // web UI deep-links here as `/settings/notifications?unsubscribe=1`.
          registerNotificationPreferencesRoute(v1);
          // US-9.1.1 — learner analytics dashboard + activity heartbeat.
          registerAnalyticsRoutes(v1);
          // US-8.1.2 — LTI admin (registration CRUD + AGS grade ledger).
          registerLtiAdminRoutes(v1);
          // US-8.1.1 — OAuth 2.0 client-credentials admin management.
          registerOAuthAdminRoutes(v1);
          // US-1.1.3 — SAML 2.0 institutional SSO (public + admin).
          registerSamlRoutes(v1);
          // US-2.2.3 — JSON/CSV bulk enrolment preview + async jobs.
          registerBulkEnrolmentRoutes(v1);
          // US-3.1.2 — device-bound offline lesson downloads.
          registerOfflineRoutes(v1);
        },
        { prefix: "/v1" },
      );
    },
    { prefix: "/api" },
  );

  // ── OAuth 2.0 token endpoint (single, outside the v1 surface) ──
  await app.register(
    async (api) => {
      registerOAuthRoutes(api);
    },
    { prefix: "/api" },
  );

  // ── US-8.1.1 — Public catalogue API (OAuth-protected, rate limited) ──
  await app.register(
    async (api) => {
      installMaintenanceGuard(api);
      await api.register(registerPublicApiRoutes, { prefix: "/public" });
    },
    { prefix: "/api/v1" },
  );

  // ── US-8.1.1 — OpenAPI 3.1 docs at /api/docs.json and /api/docs ──
  await app.register(
    async (api) => {
      registerDocsRoutes(api);
    },
    { prefix: "/api" },
  );

  // ── US-8.1.2 — LTI 1.3 public endpoints (login/jwks/launch/session) ──
  await app.register(
    async (api) => {
      registerLtiRoutes(api);
    },
    { prefix: "/api" },
  );

  registerErrorHandler(app);
  return app;
}

export default buildApp;