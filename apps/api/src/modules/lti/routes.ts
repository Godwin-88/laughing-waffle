import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { badRequest, forbidden } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { issueSessionPair } from "../auth/service";
import {
  completeLaunch,
  createRegistration,
  deleteRegistration,
  exchangeLaunchTicket,
  getRegistration,
  issueLaunchTicket,
  listGradeLedger,
  listRegistrations,
  startLoginInitiation,
  updateRegistration,
} from "./service";
import { getToolJwks } from "./keys";

const loginInitQuery = z.object({
  iss: z.string().min(1),
  client_id: z.string().min(1),
  target_link_uri: z.string().optional(),
  login_hint: z.string().optional().default(""),
  lti_message_hint: z.string().optional(),
  deployment_id: z.string().optional(),
  custom: z.string().optional(),
});

const createRegSchema = z.object({
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  toolName: z.string().max(120).optional(),
  authLoginUrl: z.string().url().optional(),
  authTokenUrl: z.string().url().optional(),
  jwksUrl: z.string().url().optional(),
  platformKeySetJson: z.string().optional(),
  agsLineItemUrl: z.string().url().optional(),
  active: z.boolean().optional(),
});

const updateRegSchema = z.object({
  toolName: z.string().max(120).optional(),
  authLoginUrl: z.string().url().optional(),
  authTokenUrl: z.string().url().optional(),
  jwksUrl: z.string().url().optional(),
  platformKeySetJson: z.string().optional(),
  agsLineItemUrl: z.string().url().optional(),
  active: z.boolean().optional(),
});

function requireAdmin(req: { userRole: string; userId: string }): string {
  if (req.userRole !== "admin") throw forbidden("Admin access required.");
  return req.userId;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function registerLtiRoutes(app: FastifyInstance) {
  // ── OIDC login initiation (platform → tool) ────────────────
  app.get<{ Querystring: Record<string, unknown> }>("/lti/login", async (req, reply) => {
    const q = loginInitQuery.parse(req.query);
    const { redirectUrl } = await startLoginInitiation({
      issuer: q.iss,
      clientId: q.client_id,
      targetLinkUri: q.target_link_uri ?? "",
      loginHint: q.login_hint,
      ltiMessageHint: q.lti_message_hint,
      deploymentId: q.deployment_id,
      custom: q.custom,
    });
    return reply.redirect(redirectUrl);
  });

  // ── Launch endpoint (platform POSTs id_token + state) ──────
  app.post<{ Querystring: Record<string, unknown>; Body: Record<string, unknown> }>(
    "/lti/launch",
    async (req, reply) => {
      const idToken = typeof req.body?.id_token === "string" ? req.body.id_token : null;
      const state = typeof req.body?.state === "string" ? req.body.state : (typeof req.query?.state === "string" ? req.query.state : null);
      if (!idToken || !state) throw badRequest("Missing id_token or state.");
      const launch = await completeLaunch({ idToken, state });
      const ticket = issueLaunchTicket(launch);
      const qs = new URLSearchParams({ tk: ticket.ticket });
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Launching…</title>
<style>body{font-family:"Raleway",system-ui;display:grid;place-items:center;min-height:100vh;color:#1a1a2e}
.spinner{width:2rem;height:2rem;border:3px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="spinner"></div><p class="mt-3">Signing you in to Takwimu…</p>
<form method="post" action="${escapeHtml(loadEnv().WEB_ORIGIN)}/lti/launch?${escapeHtml(qs.toString())}">
<input type="hidden" name="ticket" value="${escapeHtml(ticket.ticket)}"></form>
<script>document.forms[0].submit()</script></body></html>`;
      return reply.type("text/html").send(html);
    },
  );

  // ── PUBLIC JWKS (platform fetches our signing key) ─────────
  app.get("/lti/jwks", async () => getToolJwks());

  // ── Session bootstrap: the SPA exchanges its one-time ticket ─
  app.post<{ Body: { ticket?: string } }>("/lti/session", async (req, reply) => {
    const body = (req.body ?? {}) as { ticket?: string };
    if (!body.ticket) throw badRequest("Missing launch ticket.");
    const { userId, targetUrl } = await exchangeLaunchTicket(body.ticket);
    const { db } = getDb(loadEnv().DATABASE_URL);
    const userRow = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!userRow) throw badRequest("Account not found.");
    const session = await issueSessionPair(userRow, {
      userAgent: req.headers["user-agent"]?.slice(0, 400) ?? null,
      ip: req.ip ?? null,
    });
    setRefreshCookie(reply, session.refreshToken);
    return reply.send({
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresInSeconds: session.expiresInSeconds,
      user: session.user,
      targetUrl,
    });
  });
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  const env = loadEnv();
  reply.setCookie("tkw_refresh", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 3600,
  });
}

/** Admin registration CRUD + AGS grade ledger visibility. */
export function registerLtiAdminRoutes(app: FastifyInstance) {
  app.get("/lti/registrations", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return listRegistrations();
  });

  app.post<{ Body: unknown }>("/lti/registrations", { preHandler: [app.authenticate] }, async (req, reply) => {
    const adminId = requireAdmin(req);
    const body = createRegSchema.parse(req.body);
    const reg = await createRegistration({ ...body, createdBy: adminId });
    await recordAudit({ actorId: adminId, action: "lti.registration.created", targetType: "lti_registration", targetId: reg.id });
    return reply.code(201).send(reg);
  });

  app.get<{ Params: { id: string } }>("/lti/registrations/:id", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return getRegistration(req.params.id);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/lti/registrations/:id", { preHandler: [app.authenticate] }, async (req) => {
    const adminId = requireAdmin(req);
    const body = updateRegSchema.parse(req.body);
    const reg = await updateRegistration(req.params.id, body);
    await recordAudit({ actorId: adminId, action: "lti.registration.updated", targetType: "lti_registration", targetId: reg.id });
    return reg;
  });

  app.delete<{ Params: { id: string } }>("/lti/registrations/:id", { preHandler: [app.authenticate] }, async (req) => {
    const adminId = requireAdmin(req);
    await deleteRegistration(req.params.id);
    await recordAudit({ actorId: adminId, action: "lti.registration.deleted", targetType: "lti_registration", targetId: req.params.id });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/lti/registrations/:id/grades", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return listGradeLedger(req.params.id);
  });

  app.get("/lti/grades", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return listGradeLedger(null);
  });
}
