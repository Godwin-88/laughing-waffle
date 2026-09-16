import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CreateBulkEnrolmentPayload } from "@takwimu/shared";
import { forbidden } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import {
  createBulkEnrolmentJob,
  getBulkEnrolmentJobDetail,
  listBulkEnrolmentJobs,
  previewBulkEnrolment,
} from "./service";

const inputSchema = z.object({
  courseId: z.string().min(1),
  csv: z.string().optional(),
  rows: z
    .array(
      z.object({
        email: z.string().min(3).max(200),
        cohortName: z.string().max(200).nullable().optional(),
        expiryDate: z.string().nullable().optional(),
      }),
    )
    .optional(),
  fileName: z.string().max(200).optional(),
});

function requireAdmin(req: { userRole: string; userId: string }): string {
  if (req.userRole !== "admin") throw forbidden("Admin access required.");
  return req.userId;
}

/**
 * US-2.2.3 — Admin bulk enrolment preview + async commit.
 * Both endpoints accept JSON `{ courseId, csv? | rows? }`; the preview also
 * accepts multipart `file` (CSV) + `course_id` form fields for the admin UI.
 */
export function registerBulkEnrolmentRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>(
    "/bulk-enrolments/preview",
    { preHandler: [app.authenticate] },
    async (req) => {
      requireAdmin(req);
      const payload = inputSchema.parse(req.body ?? {});
      return previewBulkEnrolment(payload.courseId, payload as CreateBulkEnrolmentPayload);
    },
  );

  app.post<{ Body: unknown }>(
    "/bulk-enrolments/jobs",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const adminId = requireAdmin(req);
      const payload = inputSchema.parse(req.body ?? {});
      const job = await createBulkEnrolmentJob(adminId, payload as CreateBulkEnrolmentPayload);
      await recordAudit({ actorId: adminId, action: "bulk_enrolment.job.created", targetType: "bulk_enrolment_job", targetId: job.id });
      return reply.code(201).send(job);
    },
  );

  app.get("/bulk-enrolments/jobs", { preHandler: [app.authenticate] }, async (req) => {
    const adminId = requireAdmin(req);
    return listBulkEnrolmentJobs(adminId);
  });

  app.get<{ Params: { id: string } }>(
    "/bulk-enrolments/jobs/:id",
    { preHandler: [app.authenticate] },
    async (req) => {
      requireAdmin(req);
      return getBulkEnrolmentJobDetail(req.params.id);
    },
  );

  // Multipart CSV upload helper — used by the admin UI when the client prefers
  // a real file upload (declared here so `song.file` stays a Fastify busboy part).
  app.post<{ Body: Record<string, unknown> }>(
    "/bulk-enrolments/upload-preview",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      requireAdmin(req);
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: { code: "no_file", message: "No CSV file uploaded." } });
      const fileBuffer = Buffer.from(await data.toBuffer());
      const csv = fileBuffer.toString("utf-8");
      const courseId = String((req.body as Record<string, unknown>)?.course_id ?? "");
      if (!courseId) return reply.status(400).send({ error: { code: "course_required", message: "course_id form field is required." } });
      return previewBulkEnrolment(courseId, { courseId, csv, fileName: data.filename ?? "upload.csv" });
    },
  );
}