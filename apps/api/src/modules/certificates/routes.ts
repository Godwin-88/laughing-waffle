import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../../lib/errors";
import {
  certificateEligibility,
  downloadCertificatePdf,
  getCertificateForUser,
  issueCertificate,
  listMyCertificates,
  verifyCertificate,
} from "./service";

const certificateNumberSchema = z.string().min(8).max(80);

export function registerCertificateRoutes(app: FastifyInstance) {
  // ── US-5.1.2 — my certificates ─────────────────────────────
  app.get(
    "/certificates",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const items = await listMyCertificates(req.userId);
      return reply.send({ items });
    },
  );

  app.get<{ Params: { certificateId: string } }>(
    "/certificates/:certificateId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const certificate = await getCertificateForUser(req.userId, req.params.certificateId);
      return reply.send({ certificate });
    },
  );

  app.get<{ Params: { certificateId: string } }>(
    "/certificates/:certificateId/download",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const file = await downloadCertificatePdf(req.userId, req.params.certificateId);
      return reply
        .header("Content-Type", file.contentType)
        .header("Content-Disposition", `attachment; filename="${file.filename}"`)
        .send(file.buffer);
    },
  );

  // ── US-5.1.2 — eligibility & claim (idempotent issue) ─────
  app.get<{ Params: { slug: string } }>(
    "/courses/:slug/certificate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const result = await certificateEligibility(req.userId, req.params.slug);
      return reply.send(result);
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/courses/:slug/certificate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const certificate = await issueCertificate(req.userId, req.params.slug);
      return reply.status(201).send({ certificate });
    },
  );

  // ── Public verification URL (no auth) ──────────────────────
  app.get<{ Params: { certificateNumber: string } }>(
    "/verify/:certificateNumber",
    async (req, reply) => {
      const value = certificateNumberSchema.safeParse(req.params.certificateNumber);
      if (!value.success) throw notFound("Certificate not found.");
      const result = await verifyCertificate(value.data);
      if (!result) throw notFound("Certificate not found.");
      return reply.send(result);
    },
  );
}