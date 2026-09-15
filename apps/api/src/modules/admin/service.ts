import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  AdminUserListResponse,
  AdminUserRow,
  AuditLogListResponse,
  UserRole,
  UserStatus,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { auditLogs, certificates, courses, dataRequests, enrolments, orders, users } from "../../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { createPasswordResetToken, sendPasswordResetEmail } from "../auth/service";
import { anonymiseUser, hasCompletedExport } from "../gdpr/service";

/**
 * Admin user management (US-7.1.1). Every mutation is audit-logged via
 * `recordAudit`; role changes guard against self-demotion and removing the
 * last active admin. Deletion requires a completed GDPR export first.
 */

export function requireAdmin(userRole: string): void {
  if (userRole !== "admin") throw forbidden("Admin access required.");
}

export interface UserListFilters {
  search?: string;
  role?: UserRole;
  status?: string;
  page: number;
  pageSize: number;
}

const SEARCHABLE = (term: string): SQL | undefined =>
  or(ilike(users.email, `%${term}%`), ilike(users.firstName, `%${term}%`), ilike(users.lastName, `%${term}%`));

function statusCondition(status?: string): SQL | undefined {
  if (status === "pending_verification") {
    return sql`${users.emailVerifiedAt} IS NULL AND ${users.status} = 'active'`;
  }
  if (status === "active" || status === "suspended") {
    return eq(users.status, status);
  }
  return undefined;
}

function buildFilters(filters: { search?: string; role?: UserRole; status?: string }): Array<SQL | undefined> {
  const whereList: Array<SQL | undefined> = [];
  if (filters.search?.trim()) whereList.push(SEARCHABLE(filters.search.trim()));
  if (filters.role && ["learner", "instructor", "admin"].includes(filters.role)) {
    whereList.push(eq(users.role, filters.role));
  }
  whereList.push(statusCondition(filters.status));
  return whereList.filter((c) => c !== undefined);
}

export async function listUsers(userRole: string, filters: UserListFilters): Promise<AdminUserListResponse> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const page = Math.max(1, filters.page);
  const pageSize = Math.max(1, Math.min(100, filters.pageSize));
  const whereList = buildFilters(filters);
  const where = whereList.length > 0 ? and(...whereList) : undefined;

  const rows = await db
    .select({
      user: users,
      enrolmentCount: count(enrolments.id),
    })
    .from(users)
    .leftJoin(enrolments, eq(enrolments.userId, users.id))
    .where(where)
    .groupBy(users.id)
    .orderBy(desc(users.createdAt))
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(where);

  return {
    items: rows.map((r) => toAdminRow(r.user, Number(r.enrolmentCount))),
    total: Number(total),
    page,
    pageSize,
  };
}

export async function listAllForCsv(
  userRole: string,
  filters: Omit<UserListFilters, "page" | "pageSize">,
): Promise<string> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const whereList = buildFilters(filters);
  const where = whereList.length > 0 ? and(...whereList) : undefined;

  const rows = await db
    .select({
      user: users,
      enrolmentCount: count(enrolments.id),
    })
    .from(users)
    .leftJoin(enrolments, eq(enrolments.userId, users.id))
    .where(where)
    .groupBy(users.id)
    .orderBy(desc(users.createdAt))
    .limit(10_000);

  const header = "email,firstName,lastName,role,status,createdAt,lastActiveAt,enrolments";
  const lines = rows.map((r) =>
    [
      `"${r.user.email}"`,
      `"${r.user.firstName}"`,
      `"${r.user.lastName}"`,
      r.user.role,
      r.user.status,
      r.user.createdAt.toISOString(),
      r.user.lastActiveAt?.toISOString() ?? "",
      Number(r.enrolmentCount),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}
export async function updateUserRoleStatus(
  userRole: string,
  actorId: string,
  targetUserId: string,
  patch: { role?: UserRole; status?: UserStatus },
): Promise<AdminUserRow> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const target = rows[0];
  if (!target) throw notFound("User not found.");
  if (target.status === "deleted") throw conflict("This account is deleted and cannot be modified.");

  if (patch.role && patch.role !== target.role) {
    if (target.id === actorId && patch.role !== "admin") {
      throw conflict("You cannot demote your own account.", "self_demotion");
    }
    if (target.role === "admin" && patch.role !== "admin") {
      // Last-admin guard: refuse if this is the final active admin.
      const [{ admins }] = await db
        .select({ admins: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.status, "active")));
      if (Number(admins) <= 1) {
        throw conflict("Cannot demote the last active administrator.", "last_admin");
      }
    }
    await db.update(users).set({ role: patch.role }).where(eq(users.id, targetUserId));
    void recordAudit({
      actorId,
      action: "user.role_changed",
      targetType: "user",
      targetId: targetUserId,
      details: { from: target.role, to: patch.role },
    });
  }

  if (patch.status && patch.status !== target.status) {
    if (patch.status === "suspended" && target.role === "admin" && target.id !== actorId) {
      throw conflict("Administrator accounts must be demoted before suspension.", "admin_suspend_guard");
    }
    await db.update(users).set({ status: patch.status }).where(eq(users.id, targetUserId));
    void recordAudit({
      actorId,
      action: patch.status === "suspended" ? "user.suspended" : "user.unsuspended",
      targetType: "user",
      targetId: targetUserId,
      details: { by: actorId },
    });
  }

  const fresh = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const [{ enrolmentCount }] = await db
    .select({ enrolmentCount: count() })
    .from(enrolments)
    .where(eq(enrolments.userId, targetUserId));
  return toAdminRow(fresh[0], Number(enrolmentCount));
}

export async function bulkSuspendUsers(
  userRole: string,
  actorId: string,
  userIds: string[],
): Promise<{ suspended: number }> {
  requireAdmin(userRole);
  if (userIds.length === 0 || userIds.length > 500) throw badRequest("Select between 1 and 500 users to suspend.");
  const { db } = getDb(loadEnv().DATABASE_URL);
  const ids = [...new Set(userIds)].filter((id) => id !== actorId); // never self-suspend
  if (ids.length === 0) return { suspended: 0 };
  // Admins must be demoted first — never touch admin rows in bulk.
  const result = await db
    .update(users)
    .set({ status: "suspended" })
    .where(and(sql`${users.id} = ANY(${ids as unknown as string[]})`, sql`${users.role} != 'admin'`))
    .returning({ id: users.id });
  void recordAudit({
    actorId,
    action: "user.bulk_suspended",
    targetType: "user",
    details: { count: result.length, ids: result.map((r) => r.id) },
  });
  return { suspended: result.length };
}

export async function forcePasswordReset(
  userRole: string,
  actorId: string,
  targetUserId: string,
): Promise<{ emailSentTo: string }> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, targetUserId)).limit(1);
  const target = rows[0];
  if (!target) throw notFound("User not found.");
  const token = await createPasswordResetToken(target.id, actorId);
  await sendPasswordResetEmail(target.id, token);
  void recordAudit({
    actorId,
    action: "user.force_password_reset",
    targetType: "user",
    targetId: targetUserId,
    details: { requestedAt: new Date().toISOString() },
  });
  return { emailSentTo: target.email };
}

export async function deleteUserViaGdpr(
  userRole: string,
  actorId: string,
  targetUserId: string,
): Promise<{ message: string }> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const target = rows[0];
  if (!target) throw notFound("User not found.");
  if (target.id === actorId) throw conflict("Use the self-service deletion flow instead.", "self_delete");
  if (target.role === "admin") throw conflict("Delete administrator accounts via the GDPR flow.", "admin_delete_guard");

  // GDPR art. 7 — a completed export must exist before admin-initiated deletion.
  const requestRows = await db
    .select({ type: dataRequests.type, status: dataRequests.status })
    .from(dataRequests)
    .where(eq(dataRequests.userId, targetUserId));
  if (!hasCompletedExport(requestRows)) {
    throw conflict("A completed data export is required before deletion. Trigger one first.", "export_prerequisite");
  }

  await anonymiseUser(targetUserId);
  void recordAudit({
    actorId,
    action: "user.deleted_by_admin",
    targetType: "user",
    targetId: targetUserId,
    details: { retained: true },
  });
  return { message: "User data anonymised; the row is retained for aggregate statistics." };
}
export async function getAdminOverview(): Promise<{
  users: number;
  learners: number;
  instructors: number;
  admins: number;
  publishedCourses: number;
  paidOrders: number;
  revenueCents: number;
  pendingGdpr: number;
  certificatesIssued: number;
}> {
  requireAdmin("admin"); // route guard already enforces; belt-and-braces for direct service use
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [userCounts, courseCounts, orderCounts, gdprCounts, certCounts] = await Promise.all([
    db
      .select({ role: users.role, total: count() })
      .from(users)
      .where(sql`${users.status} != 'deleted'`)
      .groupBy(users.role),
    db.select({ total: count() }).from(courses).where(eq(courses.status, "published")),
    db
      .select({ total: count(), sum: sql<number>`COALESCE(SUM(${orders.amountCents}), 0)` })
      .from(orders)
      .where(eq(orders.status, "paid")),
    db.select({ total: count() }).from(dataRequests).where(eq(dataRequests.status, "pending_confirmation")),
    db.select({ total: count() }).from(certificates),
  ]);

  const roleMap = new Map(userCounts.map((r) => [r.role, Number(r.total)]));
  return {
    users: [...roleMap.values()].reduce((a, b) => a + b, 0),
    learners: roleMap.get("learner") ?? 0,
    instructors: roleMap.get("instructor") ?? 0,
    admins: roleMap.get("admin") ?? 0,
    publishedCourses: Number(courseCounts[0]?.total ?? 0),
    paidOrders: Number(orderCounts[0]?.total ?? 0),
    revenueCents: Number(orderCounts[0]?.sum ?? 0),
    pendingGdpr: Number(gdprCounts[0]?.total ?? 0),
    certificatesIssued: Number(certCounts[0]?.total ?? 0),
  };
}

export async function listAuditLogs(
  userRole: string,
  filters: { actorId?: string; targetType?: string; limit?: number },
): Promise<AuditLogListResponse> {
  requireAdmin(userRole);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const whereList: SQL[] = [];
  if (filters.actorId) whereList.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.targetType) whereList.push(eq(auditLogs.targetType, filters.targetType));
  const where = whereList.length > 0 ? and(...whereList) : undefined;
  const limit = Math.max(1, Math.min(500, filters.limit ?? 100));

  const rows = await db
    .select({
      entry: auditLogs,
      actorEmail: users.email,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);

  return {
    items: rows.map((r) => ({
      id: r.entry.id,
      actorId: r.entry.actorId,
      actorEmail: r.actorEmail ?? null,
      actorName: r.actorFirstName
        ? `${r.actorFirstName} ${r.actorLastName ?? ""}`.trim()
        : null,
      action: r.entry.action,
      targetType: r.entry.targetType,
      targetId: r.entry.targetId,
      details: r.entry.details ?? null,
      createdAt: r.entry.createdAt.toISOString(),
    })),
    total: Number(total),
  };
}

function toAdminRow(user: typeof users.$inferSelect, enrolmentCount: number): AdminUserRow {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role as UserRole,
    status:
      user.status === "active" || user.status === "suspended"
        ? (user.status as UserStatus)
        : "suspended",
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    enrolmentCount,
  };
}