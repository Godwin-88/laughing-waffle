import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  confirmDataRequest,
  downloadExport,
  listMyRequests,
  requestDataAction,
} from "./service";

const confirmSchema = z.object({ token: z.string().min(16).max(512) });

export function registerGdprRoutes(app: FastifyInstance) {
  // ── US-7.2.1 self-service ──────────────────────────────────
  app.post(
    "/gdpr/export",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await requestDataAction(req.userId, "export");
      return reply.send(result);
    },
  );

  app.post(
    "/gdpr/delete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await requestDataAction(req.userId, "delete");
      return reply.send(result);
    },
  );

  // Email-confirmation landing (public — token is the credential).
  app.post<{ Body: unknown }>("/gdpr/confirm", async (req, reply) => {
    const { token } = confirmSchema.parse(req.body);
    return reply.send(await confirmDataRequest(token));
  });

  app.get(
    "/gdpr/requests",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send(await listMyRequests(req.userId));
    },
  );

  app.get<{ Params: { requestId: string } }>(
    "/gdpr/exports/:requestId/download",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const file = await downloadExport(req.userId, req.params.requestId);
      reply.header("content-type", file.contentType);
      reply.header("content-disposition", `attachment; filename="${file.filename}"`);
      reply.header("cache-control", "private, no-store");
      return reply.send(file.buffer);
    },
  );
}