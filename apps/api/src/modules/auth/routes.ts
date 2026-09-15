import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import {
  getMe,
  issueSessionPair,
  login as loginService,
  logout as logoutService,
  refresh as refreshService,
  REFRESH_COOKIE,
  register as registerService,
  resetPasswordWithToken,
  verifyEmail as verifyEmailService,
  type AuthSuccess,
  type SessionMeta,
} from "./service";
import { findOrCreateSsoUser, ssoAuthorizationUrl, ssoExchangeCode, type SsoProvider } from "./sso";

const registerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  consent: z.boolean(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  password: z.string().min(8).max(200),
});

function sessionMeta(req: FastifyRequest): SessionMeta {
  return {
    userAgent: req.headers["user-agent"]?.slice(0, 400) ?? null,
    ip: req.ip ?? null,
  };
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  const env = loadEnv();
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 3600,
  });
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.setCookie(REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: loadEnv().COOKIE_SECURE,
    path: "/api/v1/auth",
    maxAge: 0,
  });
}

function sendSession(reply: FastifyReply, session: AuthSuccess) {
  setRefreshCookie(reply, session.refreshToken);
  return reply.send({
    accessToken: session.accessToken,
    tokenType: session.tokenType,
    expiresInSeconds: session.expiresInSeconds,
    user: session.user,
  });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const result = await registerService(body);
    return reply
      .status(201)
      .send({ message: "Account created. Check your inbox to verify your email.", ...result });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const session = await loginService(body.email, body.password, sessionMeta(req));
    return sendSession(reply, session);
  });

  app.post("/auth/refresh", async (req, reply) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? null;
    const session = await refreshService(refreshToken, sessionMeta(req));
    return sendSession(reply, session);
  });

  app.post("/auth/logout", async (req, reply) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? null;
    await logoutService(refreshToken);
    clearRefreshCookie(reply);
    return reply.send({ success: true });
  });

  app.post<{ Body: unknown }>("/auth/reset-password", async (req, reply) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await resetPasswordWithToken(token, password);
    return reply.send({ success: true, message: "Password updated. You can sign in with your new password." });
  });

  app.get<{ Querystring: { token?: string } }>("/auth/verify-email", async (req, reply) => {
    const token = req.query.token;
    if (!token) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Missing verification token.", fields: { token: "required" } },
      });
    }
    await verifyEmailService(token);
    const env = loadEnv();
    return reply.redirect(`${env.WEB_ORIGIN}/verify-email?success=1`, 302);
  });

  app.get("/auth/me", { preHandler: [app.authenticate] }, async (req) => {
    return getMe(req.userId);
  });

  registerSsoRoutes(app);
}

// ── SSO (US-1.1.2) ───────────────────────────────────────────
const SSO_STATE_COOKIE = "tkw_sso_state";
const SSO_REDIRECT_COOKIE = "tkw_sso_redirect";

function registerSsoRoutes(app: FastifyInstance) {
  app.get<{ Params: { provider: string }; Querystring: { next?: string } }>(
    "/auth/sso/:provider",
    async (req, reply) => {
      const provider = req.params.provider as SsoProvider;
      if (provider !== "google" && provider !== "microsoft") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Unknown SSO provider." },
        });
      }
      const env = loadEnv();
      const state = crypto.randomUUID();
      const redirectTo = req.query.next ?? env.WEB_ORIGIN;
      reply.setCookie(SSO_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE,
        path: "/api/v1/auth",
        maxAge: 600,
      });
      reply.setCookie(SSO_REDIRECT_COOKIE, redirectTo, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE,
        path: "/api/v1/auth",
        maxAge: 600,
      });
      const url = await ssoAuthorizationUrl(provider, {
        state,
        redirectUri: `${env.PUBLIC_API_URL}/api/v1/auth/sso/${provider}/callback`,
      });
      return reply.redirect(url, 302);
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { state?: string; code?: string; error?: string; error_description?: string } }>(
    "/auth/sso/:provider/callback",
    async (req, reply) => {
      const provider = req.params.provider as SsoProvider;
      const stateCookie = req.cookies?.[SSO_STATE_COOKIE];
      if (!stateCookie || !req.query.state || stateCookie !== req.query.state) {
        return reply.status(400).send({
          error: {
            code: "sso_state_mismatch",
            message: "State validation failed. Please try signing in again.",
          },
        });
      }
      if (!req.query.code) {
        return reply.status(400).send({
          error: {
            code: "sso_denied",
            message: `Sign-in with ${provider} was not completed.`,
            fields: {
              error: req.query.error ?? "",
              description: req.query.error_description ?? "",
            },
          },
        });
      }
      const env = loadEnv();
      const callbackUrl = `${env.PUBLIC_API_URL}/api/v1/auth/sso/${provider}/callback`;
      const profile = await ssoExchangeCode(provider, req.query.code, callbackUrl);
      const user = await findOrCreateSsoUser(provider, profile);
      const session = await issueSessionPair(user, sessionMeta(req));
      const redirectTo = req.cookies?.[SSO_REDIRECT_COOKIE] ?? env.WEB_ORIGIN;

      clearRefreshCookie(reply);
      reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE,
        path: "/api/v1/auth",
        maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 3600,
      });
      // Access token handed to the web client in the URL fragment; the client
      // bootstraps /auth/me with it and stores nothing sensitive in localStorage.
      return reply.redirect(
        `${redirectTo}/auth/callback#access_token=${session.accessToken}`,
        302,
      );
    },
  );
}