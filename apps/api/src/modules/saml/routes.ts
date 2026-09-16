import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { forbidden } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import {
  buildSpMetadata,
  createSamlProvider,
  deleteSamlProvider,
  getSamlProvider,
  listSamlLoginProviders,
  listSamlProviders,
  parseSamlResponse,
  provisionSamlUser,
  refreshIdpMetadata,
  updateSamlProvider,
  type SamlAssertion,
} from "./service";

const createSchema = z.object({
  label: z.string().min(1, "Label is required.").max(120),
  metadataXml: z.string().min(1, "Paste the IdP metadata XML."),
  lmsRoleAttribute: z.string().max(80).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  metadataXml: z.string().min(1).optional(),
  lmsRoleAttribute: z.string().max(80).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function requireAdmin(req: { userRole: string; userId: string }): string {
  if (req.userRole !== "admin") throw forbidden("Admin access required.");
  return req.userId;
}

async function sessionMeta(req: FastifyRequest) {
  const ua = req.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 400) : null,
    ip: req.ip ?? null,
  };
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

/**
 * US-1.1.3 — SAML 2.0 institutional SSO.
 * Admin CRUD under /api/v1/saml/providers (US-7.1-style guard), public
 * endpoints for the IdP: SP metadata, login-initiation redirect, and the
 * assertion consumer service (ACS) that JIT-provisions the learner.
 */
export function registerSamlRoutes(app: FastifyInstance) {
  // ── Public: list active providers for the login page ─────────
  app.get("/saml/providers/public", async () => listSamlLoginProviders());

  // ── Public: SP metadata (paste into the IdP as the partner entity) ──
  app.get("/saml/metadata", async (_req, reply) => {
    return reply
      .type("application/xml")
      .header("content-disposition", 'inline; filename="takwimu-sp-metadata.xml"')
      .send(buildSpMetadata());
  });

  // ── Public: SAML login-initiation (302 to the IdP SSO URL) ──
  app.get<{ Params: { id: string } }>("/saml/login/:id", async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const provider = await getSamlProvider(id);
    if (!provider) {
      return reply.status(404).send({ error: { code: "not_found", message: "SAML provider not found." } });
    }
    if (provider.status !== "active") {
      return reply.status(503).send({ error: { code: "saml_paused", message: "This single sign-on provider is paused." } });
    }
    if (!provider.ssoUrl) {
      return reply.status(400).send({ error: { code: "saml_no_sso_url", message: "IdP metadata has no SingleSignOnService URL." } });
    }
    const relay = Buffer.from(JSON.stringify({ providerId: id })).toString("base64url");
    const url = new URL(provider.ssoUrl);
    url.searchParams.set("RelayState", relay);
    return reply.redirect(url.toString(), 302);
  });

  // ── Public: ACS — the IdP POSTs a base64 SAMLResponse (form-encoded).
  //    Dev/test also accepts a typed JSON assertion so the flow runs without
  //    a real IdP; both paths JIT-provision and issue a normal session. ──
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/saml/acs/:id",
    async (req, reply) => {
      const { id } = idParamSchema.parse(req.params);
      const env = loadEnv();

      let assertion: SamlAssertion;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const samlResponse = typeof body.SAMLResponse === "string" ? body.SAMLResponse : "";
      if (samlResponse) {
        assertion = parseSamlResponse(samlResponse);
      } else if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
        // Mock assertion (SAML_MOCK): { email, lms_role? } — used by e2e.
        const email = typeof body.email === "string" ? body.email : "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return reply.status(400).send({ error: { code: "saml_missing_email", message: "Mock SAML assertion requires a valid email." } });
        }
        assertion = {
          email: email.toLowerCase(),
          firstName: typeof body.firstName === "string" && body.firstName ? body.firstName : email.split("@")[0],
          lastName: typeof body.lastName === "string" ? body.lastName : "",
          lmsRole: typeof body.lms_role === "string" ? body.lms_role : null,
          nameId: email,
        };
      } else {
        return reply.status(400).send({ error: { code: "saml_no_response", message: "Missing SAMLResponse." } });
      }

      const { session } = await provisionSamlUser(id, assertion, await sessionMeta(req));
      setRefreshCookie(reply, session.refreshToken);

      const acceptHeader = (req.headers.accept ?? "").toLowerCase();
      if (acceptHeader.includes("application/json")) {
        return reply.send({
          accessToken: session.accessToken,
          tokenType: session.tokenType,
          expiresInSeconds: session.expiresInSeconds,
          user: session.user,
        });
      }
      return reply.redirect(`${env.WEB_ORIGIN}/auth/callback#access_token=${session.accessToken}`, 302);
    },
  );

  // ── Auth: admin CRUD ───────────────────────────────────────
  app.get("/saml/providers", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return listSamlProviders();
  });

  app.post<{ Body: unknown }>("/saml/providers", { preHandler: [app.authenticate] }, async (req, reply) => {
    const adminId = requireAdmin(req);
    const payload = createSchema.parse(req.body);
    const provider = await createSamlProvider({ ...payload, createdBy: adminId });
    await recordAudit({ actorId: adminId, action: "saml.provider.created", targetType: "saml_provider", targetId: provider.id });
    return reply.code(201).send(provider);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/saml/providers/:id",
    { preHandler: [app.authenticate] },
    async (req) => {
      const adminId = requireAdmin(req);
      const { id } = idParamSchema.parse(req.params);
      const patch = updateSchema.parse(req.body);
      const provider = await updateSamlProvider(id, patch);
      await recordAudit({ actorId: adminId, action: "saml.provider.updated", targetType: "saml_provider", targetId: provider.id });
      return provider;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/saml/providers/:id/refresh",
    { preHandler: [app.authenticate] },
    async (req) => {
      const adminId = requireAdmin(req);
      const { id } = idParamSchema.parse(req.params);
      const provider = await refreshIdpMetadata(id);
      await recordAudit({ actorId: adminId, action: "saml.provider.refreshed", targetType: "saml_provider", targetId: provider.id });
      return provider;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/saml/providers/:id",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const adminId = requireAdmin(req);
      const { id } = idParamSchema.parse(req.params);
      await deleteSamlProvider(id);
      await recordAudit({ actorId: adminId, action: "saml.provider.deleted", targetType: "saml_provider", targetId: id });
      return reply.send({ ok: true });
    },
  );
}