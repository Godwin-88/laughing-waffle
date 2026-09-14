import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { enrolments, lessons } from "../../db/schema";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { getStorage, mediaContentType } from "../../storage/storage";
import {
  attachCaptions,
  attachPoster,
  completeUpload,
  createUploadSession,
  getUploadStatus,
  partUploadUrl,
  receivePart,
  reportPartComplete,
} from "./service";

const startSessionSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().max(120).optional(),
  sizeBytes: z.number().int().min(1).max(10_000_000_000),
});

const partCompleteSchema = z.object({
  partNumber: z.number().int().min(1).max(10_000),
  etag: z.string().max(255).optional().nullable(),
  size: z.number().int().min(1).max(10 * 1024 * 1024),
});

export function registerVideoRoutes(app: FastifyInstance) {
  // ── US-4.1.2 instructor video upload (chunked multipart) ──
  app.post<{ Params: { lessonId: string } }>(
    "/instructor/lessons/:lessonId/uploads",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const input = startSessionSchema.parse(req.body);
      const session = await createUploadSession(req.userId, req.userRole, req.params.lessonId, input);
      return reply.send(session);
    },
  );

  app.get<{ Params: { assetId: string; partNumber: string } }>(
    "/instructor/videos/:assetId/parts/:partNumber",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const part = Number(req.params.partNumber);
      if (!Number.isInteger(part) || part < 1) throw badRequest("Invalid part number.");
      return reply.send(await partUploadUrl(req.userId, req.userRole, req.params.assetId, part));
    },
  );

  // Local driver — the browser PUTs the raw part body here.
  app.put<{ Params: { assetId: string; partNumber: string } }>(
    "/instructor/videos/:assetId/parts/:partNumber",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const part = Number(req.params.partNumber);
      if (!Number.isInteger(part) || part < 1) throw badRequest("Invalid part number.");
      const body = req.body as Buffer | undefined;
      const data =
        body && body.byteLength > 0 ? body : await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.raw.on("data", (c: Buffer) => chunks.push(c));
          req.raw.on("end", () => resolve(Buffer.concat(chunks)));
          req.raw.on("error", reject);
        });
      if (data.byteLength <= 0) throw badRequest("Empty part body.");
      await receivePart(req.userId, req.userRole, req.params.assetId, part, data);
      return reply.send({ ok: true, partNumber: part, size: data.byteLength });
    },
  );

  // B2 driver — client reports a presigned UploadPart that completed.
  app.post<{ Params: { assetId: string } }>(
    "/instructor/videos/:assetId/parts/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = partCompleteSchema.parse(req.body);
      await reportPartComplete(req.userId, req.userRole, req.params.assetId, {
        partNumber: body.partNumber,
        etag: body.etag ?? null,
        size: body.size,
      });
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { assetId: string } }>(
    "/instructor/videos/:assetId/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send(await completeUpload(req.userId, req.userRole, req.params.assetId));
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/instructor/videos/:assetId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      return reply.send(await getUploadStatus(req.userId, req.userRole, req.params.assetId));
    },
  );

  // Captions + poster attachments (US-3.1.1 / US-4.1.3).
  app.post<{ Params: { lessonId: string } }>(
    "/instructor/lessons/:lessonId/captions",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw badRequest("No file attached.");
      const data = await file.toBuffer();
      if (data.byteLength > 512 * 1024) throw badRequest("Captions file too large (max 512 KB).");
      return reply.send(await attachCaptions(req.userId, req.userRole, req.params.lessonId, data));
    },
  );

  app.post<{ Params: { lessonId: string } }>(
    "/instructor/lessons/:lessonId/poster",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const file = await req.file();
      if (!file) throw badRequest("No file attached.");
      const data = await file.toBuffer();
      if (data.byteLength > 3 * 1024 * 1024) throw badRequest("Poster too large (max 3 MB).");
      return reply.send(
        await attachPoster(req.userId, req.userRole, req.params.lessonId, data, file.mimetype),
      );
    },
  );
}