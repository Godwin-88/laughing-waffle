import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cancelOfflineDownload,
  createOfflineDownload,
  getOfflineDownload,
  getOfflineDownloadFile,
  listOfflineDownloads,
} from "./service";

const createSchema = z.object({
  lessonId: z.string().uuid(),
  deviceId: z.string().min(8).max(200),
});

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * US-3.1.2 — Offline lesson downloads.
 * All endpoints require an enrolled learner session.
 */
export function registerOfflineRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>(
    "/offline/downloads",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = createSchema.parse(req.body);
      const created = await createOfflineDownload(req.userId, payload);
      return reply.code(201).send(created);
    },
  );

  app.get("/offline/downloads", { preHandler: [app.authenticate] }, async (req) => {
    return listOfflineDownloads(req.userId);
  });

  app.get<{ Params: { id: string } }>(
    "/offline/downloads/:id",
    { preHandler: [app.authenticate] },
    async (req) => {
      return getOfflineDownload(req.userId, req.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/offline/downloads/:id/cancel",
    { preHandler: [app.authenticate] },
    async (req) => {
      return cancelOfflineDownload(req.userId, req.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/offline/downloads/:id/file",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { data, filename } = await getOfflineDownloadFile(req.userId, req.params.id);
      return reply
        .type("application/octet-stream")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .send(data);
    },
  );
}