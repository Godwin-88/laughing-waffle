import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  BulkEnrolmentJobDetail,
  BulkEnrolmentJobListResponse,
  BulkEnrolmentJobSummary,
  BulkEnrolmentPreview,
  BulkRowResult,
  CreateBulkEnrolmentPayload,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { bulkEnrolmentJobs, bulkEnrolmentRows, courses, enrolments, users } from "../../db/schema";
import { badRequest, notFound } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";
import { getMailer } from "../../mail/mailer";
import { parseCsv } from "../../lib/csv";

/**
 * US-2.2.3 — Admin bulk enrolment via CSV upload.
 *
 * Two-phase flow (matching the acceptance criteria):
 *   1. POST /bulk-enrolments/preview — parse + validate without writing
 *      (valid rows count, invalid rows with reasons).
 *   2. POST /bulk-enrolments/jobs — commit; the job processes asynchronously,
 *      partial success is allowed (valid rows enrolled, invalid skipped), and
 *      the admin is emailed on completion.
 * Capped at 5,000 rows per upload.
 */

export const MAX_BULK_ROWS = 5_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface CsvDataRow {
  email: string;
  cohortName: string | null;
  expiryDate: string | null;
  /** course_id from the CSV row, when the column is present. */
  courseId: string;
}

export function csvTextToRows(csvText: string): CsvDataRow[] {
  const parsed = parseCsv(csvText);
  if (parsed.length <= 1) return [];
  const header = parsed[0].cells.map((c) => c.toLowerCase());
  const emailIdx = header.indexOf("email");
  const courseIdx = header.indexOf("course_id");
  const cohortIdx = header.indexOf("cohort_name");
  const expiryIdx = header.indexOf("expiry_date");
  if (emailIdx < 0) {
    throw badRequest('CSV must include an "email" column.', { csv: "missing_email_column" });
  }
  const rows: CsvDataRow[] = [];
  for (const row of parsed.slice(1)) {
    const email = (row.cells[emailIdx] ?? "").trim().toLowerCase();
    if (!email) continue;
    rows.push({
      email,
      courseId: courseIdx >= 0 ? (row.cells[courseIdx] ?? "").trim() : "",
      cohortName: cohortIdx >= 0 && (row.cells[cohortIdx] ?? "").trim() ? (row.cells[cohortIdx] ?? "").trim() : null,
      expiryDate: expiryIdx >= 0 && (row.cells[expiryIdx] ?? "").trim() ? (row.cells[expiryIdx] ?? "").trim() : null,
    });
  }
  return rows;
}

/** Normalise the create payload into CSV-like rows (supports JSON rows too). */
export function payloadToRows(payload: CreateBulkEnrolmentPayload): CsvDataRow[] {
  if (payload.csv) {
    const fromCsv = csvTextToRows(payload.csv);
    return fromCsv.map((r) => ({ ...r, courseId: r.courseId || payload.courseId }));
  }
  if (payload.rows && payload.rows.length > 0) {
    return payload.rows.map((r) => ({
      email: r.email.trim().toLowerCase(),
      cohortName: r.cohortName || null,
      expiryDate: r.expiryDate || null,
      courseId: payload.courseId,
    }));
  }
  throw badRequest("Provide either CSV text or a rows array.", { csv: "empty" });
}

export interface ValidatedRows {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  results: BulkRowResult[];
}

export async function validateRows(
  courseId: string,
  rows: CsvDataRow[],
): Promise<ValidatedRows> {
  if (rows.length === 0) {
    throw badRequest("No data rows found in the upload.", { rows: "empty" });
  }
  if (rows.length > MAX_BULK_ROWS) {
    throw badRequest(`Bulk enrolment is capped at ${MAX_BULK_ROWS} rows per upload.`, {
      rows: "too_many",
    });
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const course = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).limit(1);
  if (course.length === 0) throw notFound("Course not found.");

  const seen = new Set<string>();
  const results: BulkRowResult[] = [];
  let invalidRows = 0;
  rows.forEach((row, index) => {
    const reason = validateRow(row, seen);
    if (reason) {
      invalidRows++;
      results.push({ row: index + 2, email: row.email, status: "invalid", reason });
    } else {
      seen.add(row.email);
      results.push({ row: index + 2, email: row.email, status: "valid", reason: null });
    }
  });
  return {
    totalRows: rows.length,
    validRows: rows.length - invalidRows,
    invalidRows,
    results,
  };
}

function validateRow(row: CsvDataRow, seen: Set<string>): string | null {
  if (!EMAIL_RE.test(row.email)) return "Invalid email address.";
  if (seen.has(row.email)) return "Duplicate email in upload.";
  if (row.expiryDate && Number.isNaN(Date.parse(row.expiryDate))) return "Invalid expiry_date.";
  return null;
}

export async function previewBulkEnrolment(
  courseId: string,
  input: CreateBulkEnrolmentPayload,
): Promise<BulkEnrolmentPreview> {
  const rows = payloadToRows(input);
  const validation = await validateRows(courseId, rows);
  return {
    totalRows: validation.totalRows,
    validRows: validation.validRows,
    invalidRows: validation.invalidRows,
    skippedRows: 0,
    enrolledRows: 0,
    rows: validation.results,
    fileName: input.fileName ?? "upload.csv",
    courseId,
  };
}

export async function createBulkEnrolmentJob(
  adminId: string,
  input: CreateBulkEnrolmentPayload,
): Promise<BulkEnrolmentJobSummary> {
  if (!input.courseId) throw badRequest("courseId is required.", { courseId: "required" });
  const courseId = input.courseId;
  const rows = payloadToRows({ ...input, courseId });
  const validation = await validateRows(courseId, rows);

  const { db } = getDb(loadEnv().DATABASE_URL);
  const [job] = await db
    .insert(bulkEnrolmentJobs)
    .values({
      adminId,
      courseId,
      filename: input.fileName ?? "upload.csv",
      totalRows: validation.totalRows,
      validRows: validation.validRows,
      invalidRows: validation.invalidRows,
      status: "pending",
      report: validation.results as unknown as Record<string, unknown>[],
    })
    .returning();

  for (const row of rows) {
    const result = validation.results.find((r) => r.email === row.email) ?? {
      row: 0,
      email: row.email,
      status: "invalid",
      reason: "Unknown row.",
    };
    await db.insert(bulkEnrolmentRows).values({
      jobId: job.id,
      email: row.email,
      courseId,
      cohortName: row.cohortName,
      expiryDate: row.expiryDate ? new Date(row.expiryDate) : null,
      status: result.status === "valid" ? "valid" : "invalid",
      reason: result.status === "valid" ? null : result.reason,
    });
  }

  // Process asynchronously; the admin is emailed on completion (US-2.2.3).
  void processBulkEnrolmentJob(job.id).catch((err) => {
    console.warn(`[bulk-enrolment] job ${job.id} failed:`, (err as Error)?.message ?? err);
  });

  return getBulkEnrolmentJob(job.id);
}

async function processBulkEnrolmentJob(jobId: string): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const jobs = await db.select().from(bulkEnrolmentJobs).where(eq(bulkEnrolmentJobs.id, jobId)).limit(1);
  const job = jobs[0];
  if (!job) return;

  await db.update(bulkEnrolmentJobs).set({ status: "processing" }).where(eq(bulkEnrolmentJobs.id, jobId));

  const rowRows = await db.select().from(bulkEnrolmentRows).where(eq(bulkEnrolmentRows.jobId, jobId));
  const usersRows = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(inArray(users.email, rowRows.map((r) => r.email)));

  const byEmail = new Map(usersRows.map((u) => [u.email, u]));
  const existingEnrolments = await db
    .select({ userId: enrolments.userId, courseId: enrolments.courseId })
    .from(enrolments)
    .where(
      and(
        inArray(enrolments.userId, usersRows.map((u) => u.id)),
        eq(enrolments.courseId, job.courseId),
      ),
    );

  const enrolledKeys = new Set(existingEnrolments.map((e) => `${e.userId}:${e.courseId}`));
  let enrolledRows = 0;
  let skippedRows = 0;

  for (const row of rowRows) {
    if (row.status !== "valid") continue;
    const user = byEmail.get(row.email);
    if (!user) {
      skippedRows++;
      await db.update(bulkEnrolmentRows).set({ status: "skipped", reason: "No account found for this email." }).where(eq(bulkEnrolmentRows.id, row.id));
      continue;
    }
    if (user.status !== "active") {
      skippedRows++;
      await db.update(bulkEnrolmentRows).set({ status: "skipped", reason: "Account is not active." }).where(eq(bulkEnrolmentRows.id, row.id));
      continue;
    }
    const key = `${user.id}:${job.courseId}`;
    if (enrolledKeys.has(key)) {
      skippedRows++;
      await db.update(bulkEnrolmentRows).set({ status: "skipped", reason: "Already enrolled." }).where(eq(bulkEnrolmentRows.id, row.id));
      continue;
    }
    await db.insert(enrolments).values({
      userId: user.id,
      courseId: job.courseId,
      status: "enrolled",
      expiresAt: row.expiryDate ? new Date(row.expiryDate) : null,
    });
    enrolledKeys.add(key);
    enrolledRows++;
    await db.update(bulkEnrolmentRows).set({ status: "enrolled" }).where(eq(bulkEnrolmentRows.id, row.id));
    emitAnalyticsEvent({
      eventName: "course_enrolled",
      userId: user.id,
      courseId: job.courseId,
      payload: { via: "bulk_enrolment", jobId },
    });
  }

  await db
    .update(bulkEnrolmentJobs)
    .set({
      status: "completed",
      enrolledRows,
      skippedRows,
      completedAt: new Date(),
    })
    .where(eq(bulkEnrolmentJobs.id, jobId));

  const admin = await db.select({ email: users.email }).from(users).where(eq(users.id, job.adminId)).limit(1);
  const course = await db.select({ title: courses.title }).from(courses).where(eq(courses.id, job.courseId)).limit(1);
  if (admin.length > 0) {
    void getMailer()
      .sendEmail({
        to: admin[0].email,
        subject: `Bulk enrolment complete — ${enrolledRows} enrolled`,
        text: `Your bulk enrolment job for "${course[0]?.title ?? job.courseId}" finished.\n\nTotal: ${job.totalRows}\nEnrolled: ${enrolledRows}\nSkipped: ${skippedRows}\nInvalid: ${job.invalidRows}\n\nView the full report in the admin panel → Bulk enrolment.`,
      })
      .catch(() => {});
  }
}

function toSummary(job: typeof bulkEnrolmentJobs.$inferSelect, courseTitle: string | null): BulkEnrolmentJobSummary {
  return {
    id: job.id,
    courseId: job.courseId,
    courseTitle,
    fileName: job.filename,
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    enrolledRows: job.enrolledRows,
    skippedRows: job.skippedRows,
    status: (["pending", "processing", "completed", "failed"].includes(job.status) ? job.status : "pending") as BulkEnrolmentJobSummary["status"],
    report: (job.report ?? []) as unknown as BulkRowResult[],
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

export async function getBulkEnrolmentJob(jobId: string): Promise<BulkEnrolmentJobSummary> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const jobs = await db.select().from(bulkEnrolmentJobs).where(eq(bulkEnrolmentJobs.id, jobId)).limit(1);
  if (jobs.length === 0) throw notFound("Bulk enrolment job not found.");
  const job = jobs[0];
  const course = await db.select({ title: courses.title }).from(courses).where(eq(courses.id, job.courseId)).limit(1);
  return toSummary(job, course[0]?.title ?? null);
}

export async function listBulkEnrolmentJobs(adminId: string): Promise<BulkEnrolmentJobListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const jobs = await db
    .select()
    .from(bulkEnrolmentJobs)
    .where(eq(bulkEnrolmentJobs.adminId, adminId))
    .orderBy(desc(bulkEnrolmentJobs.createdAt))
    .limit(50);
  const courseIds = [...new Set(jobs.map((j) => j.courseId))];
  const courseRows = await db.select().from(courses).where(inArray(courses.id, courseIds));
  const titles = new Map(courseRows.map((c) => [c.id, c.title]));
  return { items: jobs.map((j) => toSummary(j, titles.get(j.courseId) ?? null)), total: jobs.length };
}

export async function getBulkEnrolmentJobDetail(jobId: string): Promise<BulkEnrolmentJobDetail> {
  const summary = await getBulkEnrolmentJob(jobId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      email: bulkEnrolmentRows.email,
      cohortName: bulkEnrolmentRows.cohortName,
      expiryDate: bulkEnrolmentRows.expiryDate,
      status: bulkEnrolmentRows.status,
      reason: bulkEnrolmentRows.reason,
    })
    .from(bulkEnrolmentRows)
    .where(eq(bulkEnrolmentRows.jobId, jobId))
    .orderBy(bulkEnrolmentRows.createdAt);
  return {
    ...summary,
    rows: rows.map((r) => ({
      email: r.email,
      cohortName: r.cohortName ?? null,
      expiryDate: r.expiryDate ? r.expiryDate.toISOString() : null,
      status: r.status as BulkRowResult["status"],
      reason: r.reason ?? null,
    })),
  };
}