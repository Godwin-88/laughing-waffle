import { and, count, eq } from "drizzle-orm";
import type { CertificateEligibilityResponse, CertificateSummary, CertificateVerificationResponse } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { certificates, courses, enrolments, gradebook, lessons, progress, users } from "../../db/schema";
import { badRequest, notFound } from "../../lib/errors";
import { generateCertificateNumber, linkedinCertificationLink } from "../../lib/orders";
import { getStorage } from "../../storage/storage";
import { getMailer } from "../../mail/mailer";
import { publishProgressEvent } from "../../lib/progress-events";
import { buildCertificatePdf, certificateKeyFor } from "./pdf";

type CertRow = typeof certificates.$inferSelect;

/**
 * Certificate engine (US-5.1.2). A course is completed when every required
 * lesson is complete AND every graded quiz has a passing gradebook row at or
 * above the course's configured certificate_pass_percent. Certificates are
 * issued lazily and idempotently (unique user+course), stored in the
 * user-uploads bucket, emailed, and exposed via a public verification URL.
 */

interface Eligibility {
  enrolled: boolean;
  requiredLessons: number;
  completedLessons: number;
  percent: number;
  quizPercent: number | null;
  quizPassRequired: number;
  quizzesPassed: boolean;
}

export async function computeEligibility(userId: string, courseId: string): Promise<Eligibility> {
  const { db } = getDb(loadEnv().DATABASE_URL);

  const courseRows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  const course = courseRows[0];
  if (!course) throw notFound("Course not found.");

  const [{ required }] = await db
    .select({ required: count() })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), eq(lessons.published, true)));

  const enrolledRows = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, courseId)))
    .limit(1);
  const enrolled = enrolledRows.length > 0;

  const [{ completed }] = await db
    .select({ completed: count() })
    .from(progress)
    .where(and(eq(progress.userId, userId), eq(progress.courseId, courseId), eq(progress.completed, true)));

  // Quiz pass requirement: every graded lesson must have a passing gradebook row.
  const quizLessons = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(eq(lessons.courseId, courseId), eq(lessons.kind, "quiz")));

  let quizPercent: number | null = null;
  let quizzesPassed = true;
  if (quizLessons.length > 0) {
    const rows = await db
      .select({ lessonId: gradebook.lessonId, percent: gradebook.percent })
      .from(gradebook)
      .where(and(eq(gradebook.userId, userId), eq(gradebook.itemType, "quiz")));

    const bestByLesson = new Map<string, number>();
    for (const r of rows) {
      const p = Number(r.percent);
      const best = bestByLesson.get(r.lessonId) ?? -1;
      if (p > best) bestByLesson.set(r.lessonId, p);
    }
    for (const ql of quizLessons) {
      const p = bestByLesson.get(ql.id);
      if (p === undefined || p < course.certificatePassPercent) {
        quizzesPassed = false;
        break;
      }
    }
    const values = quizLessons.map((ql) => bestByLesson.get(ql.id)).filter((v): v is number => v !== undefined);
    quizPercent = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  }

  const requiredNumber = required;
  const percent = requiredNumber > 0 ? Math.round((completed / requiredNumber) * 100) : 100;
  return {
    enrolled,
    requiredLessons: requiredNumber,
    completedLessons: completed,
    percent,
    quizPercent,
    quizPassRequired: course.certificatePassPercent,
    quizzesPassed,
  };
}

export async function certificateEligibility(userId: string, courseSlug: string): Promise<CertificateEligibilityResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const courseRows = await db.select().from(courses).where(and(eq(courses.slug, courseSlug), eq(courses.status, "published"))).limit(1);
  const course = courseRows[0];
  if (!course) throw notFound("Course not found.");

  const eligibility = await computeEligibility(userId, course.id);
  const existing = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.userId, userId), eq(certificates.courseId, course.id)))
    .limit(1);

  return {
    courseSlug,
    enrolled: eligibility.enrolled,
    requiredLessons: eligibility.requiredLessons,
    completedLessons: eligibility.completedLessons,
    percent: eligibility.percent,
    quizPercent: eligibility.quizPercent,
    quizPassRequired: eligibility.quizPassRequired,
    quizzesPassed: eligibility.quizzesPassed,
    eligible: eligibility.enrolled && eligibility.completedLessons >= eligibility.requiredLessons && eligibility.quizzesPassed,
    issued: existing.length > 0,
    certificate: existing[0] ? await toSummary(existing[0]) : null,
  };
}

/** Issue a certificate for a completed course (idempotent). US-5.1.2. */
export async function issueCertificate(userId: string, courseSlug: string): Promise<CertificateSummary> {
  const { db } = getDb(loadEnv().DATABASE_URL);

  const courseRows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, courseSlug), eq(courses.status, "published")))
    .limit(1);
  const course = courseRows[0];
  if (!course) throw notFound("Course not found.");

  const eligibility = await computeEligibility(userId, course.id);
  const eligible =
    eligibility.enrolled &&
    eligibility.completedLessons >= eligibility.requiredLessons &&
    eligibility.quizzesPassed;
  if (!eligible) {
    throw badRequest(
      "Complete every lesson and pass the course quizzes before claiming your certificate.",
      { code: "not_eligible" },
    );
  }

  const existing = await db
    .select()
    .from(certificates)
    .where(and(eq(certificates.userId, userId), eq(certificates.courseId, course.id)))
    .limit(1);
  if (existing[0]) return toSummary(existing[0]);

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw notFound("User not found.");

  const certificateNumber = generateCertificateNumber();
  const fileKey = await certificateKeyFor(userId, certificateNumber);
  const learnerName = `${user.firstName} ${user.lastName}`.trim();

  const pdf = await buildCertificatePdf({
    learnerName,
    courseTitle: course.title,
    instructorName: course.instructor,
    certificateNumber,
    completionDate: new Date().toISOString(),
    issuedBy: "Takwimu Data School",
  });

  await getStorage().putObject(fileKey, pdf, "application/pdf", "user-uploads");

  const [record] = await db
    .insert(certificates)
    .values({
      certificateNumber,
      userId,
      courseId: course.id,
      instructorName: course.instructor,
      fileKey,
    })
    .returning();

  const summary = await toSummary(record);
  await notifyIssued(user, summary, course.title);
  return summary;
}

async function notifyIssued(
  user: { id: string; email: string; firstName: string },
  summary: CertificateSummary,
  courseTitle: string,
): Promise<void> {
  const env = loadEnv();
  try {
    await getMailer().sendEmail({
      to: user.email,
      subject: `Your ${courseTitle} certificate is ready (${summary.certificateNumber})`,
      text:
        `Congratulations ${user.firstName}!\n\n` +
        `You have completed ${courseTitle} and earned a Takwimu Data School certificate.\n\n` +
        `Certificate ID: ${summary.certificateNumber}\n` +
        `Verify online:   ${summary.verifyUrl}\n` +
        `Download:        ${summary.downloadUrl}\n` +
        `Add to LinkedIn: ${summary.linkedinUrl}\n\n` +
        `— ${env.SMTP_FROM}`,
    });
  } catch (err) {
    console.warn("[certificates] notification email failed:", err);
  }

  publishProgressEvent(user.id, {
    event: "certificate-issued",
    courseSlug: summary.courseSlug,
    lessonId: "",
    completed: true,
    positionMs: 0,
    coursePercent: 100,
    lessonTitle: courseTitle,
    at: new Date().toISOString(),
  });
}
export async function listMyCertificates(userId: string): Promise<CertificateSummary[]> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ cert: certificates, courseSlug: courses.slug, courseTitle: courses.title })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(eq(certificates.userId, userId))
    .orderBy(certificates.issuedAt);
  return Promise.all(rows.map((r) => toSummary(r.cert, r.courseSlug, r.courseTitle)));
}

export async function getCertificateForUser(userId: string, certificateId: string): Promise<CertificateSummary> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ cert: certificates, courseSlug: courses.slug, courseTitle: courses.title })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .where(and(eq(certificates.id, certificateId), eq(certificates.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw notFound("Certificate not found.");
  return toSummary(rows[0].cert, rows[0].courseSlug, rows[0].courseTitle);
}

export async function downloadCertificatePdf(
  userId: string,
  certificateId: string,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const summary = await getCertificateForUser(userId, certificateId);
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ fileKey: certificates.fileKey })
    .from(certificates)
    .where(eq(certificates.id, certificateId))
    .limit(1);
  const fileKey = rows[0]?.fileKey ?? "certificates/missing";
  const stored = await getStorage().readObject(fileKey, "user-uploads");
  if (!stored) throw notFound("Certificate file not found.");
  return {
    buffer: stored.data,
    contentType: stored.contentType || "application/pdf",
    filename: `${summary.certificateNumber}.pdf`,
  };
}

/** Public verification — no auth (US-5.1.2 public verification URL). */
export async function verifyCertificate(certificateNumber: string): Promise<CertificateVerificationResponse | null> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ cert: certificates, courseTitle: courses.title, firstName: users.firstName, lastName: users.lastName })
    .from(certificates)
    .innerJoin(courses, eq(certificates.courseId, courses.id))
    .innerJoin(users, eq(certificates.userId, users.id))
    .where(eq(certificates.certificateNumber, certificateNumber))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    valid: true,
    certificateNumber,
    learnerName: `${row.firstName} ${row.lastName}`.trim(),
    courseTitle: row.courseTitle,
    instructorName: row.cert.instructorName,
    issuedOn: row.cert.issuedAt.toISOString(),
    platformName: "Takwimu Data School",
  };
}

async function toSummary(cert: CertRow, courseSlug?: string, courseTitle?: string): Promise<CertificateSummary> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  let slug = courseSlug;
  let title = courseTitle;
  if (!slug || !title) {
    const rows = await db
      .select({ slug: courses.slug, title: courses.title })
      .from(courses)
      .where(eq(courses.id, cert.courseId))
      .limit(1);
    slug = rows[0]?.slug;
    title = rows[0]?.title;
  }
  const env = loadEnv();
  const certUrl = `${env.WEB_ORIGIN}/verify/${cert.certificateNumber}`;
  const downloadUrl = await getStorage().signUrl(cert.fileKey, "user-uploads", 3600);
  const issued = cert.issuedAt;
  return {
    id: cert.id,
    certificateNumber: cert.certificateNumber,
    courseSlug: slug ?? "course",
    courseTitle: title ?? "Course",
    instructorName: cert.instructorName,
    issuedAt: issued.toISOString(),
    downloadUrl,
    verifyUrl: certUrl,
    linkedinUrl: linkedinCertificationLink({
      name: cert.certificateNumber,
      organizationName: "Takwimu Data School",
      issueYear: issued.getUTCFullYear(),
      issueMonth: issued.getUTCMonth() + 1,
      certId: cert.certificateNumber,
      certUrl,
    }),
  };
}
