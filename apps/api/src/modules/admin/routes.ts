import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forbidden } from "../../lib/errors";
import {
  getConfig,
  listConfigRevisions,
  rollbackConfigRevision,
  updateConfig,
} from "../../lib/config";
import { requestDataAction, listAllRequests } from "../gdpr/service";
import {
  bulkSuspendUsers,
  deleteUserViaGdpr,
  forcePasswordReset,
  getAdminOverview,
  listAllForCsv,
  listAuditLogs,
  listUsers,
  updateUserRoleStatus,
} from "./service";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  role: z.enum(["learner", "instructor", "admin"]).optional(),
  status: z.enum(["active", "suspended", "pending_verification"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const patchUserSchema = z.object({
  role: z.enum(["learner", "instructor", "admin"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

const bulkSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(500) });

const configPatchSchema = z.object({
  platform: z
    .object({
      name: z.string().min(1).max(120).optional(),
      logoKey: z.string().max(300).nullable().optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      defaultLanguage: z.string().min(2).max(10).optional(),
      timezone: z.string().min(1).max(60).optional(),
    })
    .optional(),
  email: z
    .object({
      fromName: z.string().min(1).max(120).optional(),
      fromAddress: z.string().email().optional(),
    })
    .optional(),
  maintenance: z
    .object({
      enabled: z.boolean().optional(),
      message: z.string().min(1).max(500).optional(),
    })
    .optional(),
  payments: z
    .object({
      enabledGateways: z.array(z.enum(["stripe", "mpesa", "paypal"])).min(1).optional(),
    })
    .optional(),
  features: z
    .object({
      discussions: z.boolean().optional(),
      certificates: z.boolean().optional(),
      offlineDownload: z.boolean().optional(),
    })
    .optional(),
});
export function registerAdminRoutes(app: FastifyInstance) {
  const admin = {
    preHandler: [
      app.authenticate,
      async (req: import("fastify").FastifyRequest, _reply: import("fastify").FastifyReply) => {
        requireAdminRole(req.userRole);
      },
    ],
  };

  // ── US-7.1.2 platform configuration ─────────────────────────
  app.get("/admin/config", admin, async (_req, reply) => reply.send({ config: await getConfig() }));
  app.patch("/admin/config", admin, async (req, reply) => {
    const patch = configPatchSchema.parse(req.body);
    const result = await updateConfig(req.userId, patch);
    return reply.send({ config: result.config, revisionId: result.revisionId });
  });
  app.get("/admin/config/revisions", admin, async (req, reply) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 10);
    return reply.send(await listConfigRevisions(limit));
  });
  app.post<{ Params: { id: string } }>(
    "/admin/config/revisions/:id/rollback",
    admin,
    async (req, reply) => {
      const result = await rollbackConfigRevision(req.userId, req.params.id);
      return reply.send(result);
    },
  );

  // ── US-7.1.1 user management ────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/users",
    admin,
    async (req, reply) => {
      const q = listQuerySchema.parse(req.query);
      return reply.send(await listUsers(req.userRole, q));
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/users/export.csv",
    admin,
    async (req, reply) => {
      const q = listQuerySchema.parse(req.query);
      const csv = await listAllForCsv(req.userRole, { search: q.search, role: q.role, status: q.status });
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", 'attachment; filename="takwimu-admin-users.csv"');
      return reply.send(csv);
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/admin/users/:id",
    admin,
    async (req, reply) => {
      const patch = patchUserSchema.parse(req.body);
      return reply.send({ user: await updateUserRoleStatus(req.userRole, req.userId, req.params.id, patch) });
    },
  );

  app.post<{ Body: unknown }>("/admin/users/bulk-suspend", admin, async (req, reply) => {
    const { userIds } = bulkSchema.parse(req.body);
    return reply.send(await bulkSuspendUsers(req.userRole, req.userId, userIds));
  });

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/force-password-reset",
    admin,
    async (req, reply) => {
      return reply.send(await forcePasswordReset(req.userRole, req.userId, req.params.id));
    },
  );

  app.delete<{ Params: { id: string } }>("/admin/users/:id", admin, async (req, reply) => {
    return reply.send(await deleteUserViaGdpr(req.userRole, req.userId, req.params.id));
  });

  // ── US-7.2.1 admin on behalf of learner ─────────────────────
  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/gdpr-export",
    admin,
    async (req, reply) => {
      const result = await requestDataAction(req.params.id, "export", {
        initiatedBy: "admin",
        adminId: req.userId,
      });
      return reply.send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/gdpr-delete",
    admin,
    async (req, reply) => {
      const result = await requestDataAction(req.params.id, "delete", {
        initiatedBy: "admin",
        adminId: req.userId,
      });
      return reply.send(result);
    },
  );

  app.get("/admin/gdpr/requests", admin, async (req, reply) => {
    requireAdminRole(req.userRole);
    return reply.send(await listAllRequests());
  });

  // ── US-7.1.1 audit trail ────────────────────────────────────
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/audit",
    admin,
    async (req, reply) => {
      return reply.send(
        await listAuditLogs(req.userRole, {
          actorId: req.query.actorId,
          targetType: req.query.targetType,
          limit: Number(req.query.limit ?? 100),
        }),
      );
    },
  );

  app.get("/admin/overview", admin, async (req, reply) => {
    requireAdminRole(req.userRole);
    return reply.send(await getAdminOverview());
  });
}

function requireAdminRole(userRole: string): void {
  if (userRole !== "admin") {
    throw forbidden("Admin access required.");
  }
}