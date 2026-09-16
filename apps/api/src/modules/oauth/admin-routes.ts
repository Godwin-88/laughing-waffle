import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forbidden } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import {
  createApiClient,
  listApiClients,
  revokeApiClient,
  rotateApiClientSecret,
} from "./service";

const createClientSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.string().optional(),
});

const paramSchema = z.object({ clientId: z.string().min(1) });

function requireAdmin(req: { userRole: string; userId: string }): string {
  if (req.userRole !== "admin") throw forbidden("Admin access required.");
  return req.userId;
}

/** Admin management of OAuth 2.0 machine-to-machine clients (US-8.1.1). */
export function registerOAuthAdminRoutes(app: FastifyInstance) {
  app.get("/oauth/clients", { preHandler: [app.authenticate] }, async (req) => {
    requireAdmin(req);
    return listApiClients();
  });

  app.post<{ Body: unknown }>("/oauth/clients", { preHandler: [app.authenticate] }, async (req, reply) => {
    const adminId = requireAdmin(req);
    const body = createClientSchema.parse(req.body);
    const result = await createApiClient({ ...body, createdBy: adminId });
    await recordAudit({
      actorId: adminId,
      action: "oauth.client.created",
      targetType: "oauth_client",
      targetId: result.client.id,
    });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { clientId: string } }>(
    "/oauth/clients/:clientId/rotate",
    { preHandler: [app.authenticate] },
    async (req) => {
      const adminId = requireAdmin(req);
      const { clientId } = paramSchema.parse(req.params);
      const result = await rotateApiClientSecret(clientId);
      await recordAudit({
        actorId: adminId,
        action: "oauth.client.secret_rotated",
        targetType: "oauth_client",
      });
      return result;
    },
  );

  app.post<{ Params: { clientId: string } }>(
    "/oauth/clients/:clientId/revoke",
    { preHandler: [app.authenticate] },
    async (req) => {
      const adminId = requireAdmin(req);
      const { clientId } = paramSchema.parse(req.params);
      await revokeApiClient(clientId);
      await recordAudit({
        actorId: adminId,
        action: "oauth.client.revoked",
        targetType: "oauth_client",
      });
      return { ok: true };
    },
  );
}