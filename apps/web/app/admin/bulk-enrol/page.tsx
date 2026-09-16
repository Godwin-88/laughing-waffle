"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BulkEnrolmentJobSummary, BulkEnrolmentPreview, CourseFilters } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import {
  bulkEnrolmentApi,
  catalogueApi,
} from "@/lib/api";

/**
 * Sprint 10 — Admin bulk enrolment (US-2.2.3).
 * Paste CSV text or JSON rows, preview the validation report, then commit
 * as an asynchronous job. Accounts must already exist — unknown emails are
 * skipped with a reason in the report (no JIT account creation).
 */
export default function AdminBulkEnrolPage() {
  const { user, loading } = useAuth();
  const [courses, setCourses] = useState<Array<{ id: string; title: string; slug: string }>>([]);
  const [courseId, setCourseId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<BulkEnrolmentPreview | null>(null);
  const [jobs, setJobs] = useState<BulkEnrolmentJobSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadCourses() {
    const filters: CourseFilters & { pageSize: number } = { pageSize: 100 };
    const res = await catalogueApi.list(filters);
    setCourses(res.items.map((c) => ({ id: c.id, title: c.title, slug: c.slug })));
    if (!courseId && res.items.length > 0) setCourseId(res.items[0].id);
  }

  async function loadJobs() {
    const res = await bulkEnrolmentApi.jobs();
    setJobs(res.items);
  }

  useEffect(() => {
    if (loading || !user || user.role !== "admin") return;
    void loadCourses().catch((err: Error) => setError(err.message));
    void loadJobs().catch((err: Error) => setError(err.message));
  }, [loading, user]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-500">Loading…</p>
      </div>
    );
  }
  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">
          Please <Link className="text-brand-600 hover:underline" href="/login">sign in</Link> as an administrator to continue.
        </p>
      </div>
    );
  }

  function parseJsonRows(): unknown[] {
    if (!jsonText.trim()) return [];
    try {
      const parsed = JSON.parse(jsonText);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function runPreview() {
    setError(null);
    setNotice(null);
    if (!courseId) {
      setError("Choose a course first.");
      return;
    }
    const payload: { courseId: string; csv?: string; rows?: Array<{ email: string; cohortName?: string | null; expiryDate?: string | null }>; fileName?: string } = { courseId };
    if (csvText.trim()) payload.csv = csvText;
    if (jsonText.trim()) {
      const rows = parseJsonRows();
      if (rows.length === 0) {
        setError("JSON rows must be an array of { email, cohortName?, expiryDate? }.");
        return;
      }
      payload.rows = rows as Array<{ email: string; cohortName?: string | null; expiryDate?: string | null }>;
    }
    if (!payload.csv && !payload.rows) {
      setError("Paste either CSV text or JSON rows.");
      return;
    }
    setBusy(true);
    try {
      setPreview(await bulkEnrolmentApi.preview(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    if (!preview || preview.validRows === 0) {
      setError("Run a preview that reports at least one valid row first.");
      return;
    }
    const payload: { courseId: string; csv?: string; rows?: Array<{ email: string; cohortName?: string | null; expiryDate?: string | null }>; fileName?: string } = { courseId };
    if (csvText.trim()) payload.csv = csvText;
    if (jsonText.trim() && parseJsonRows().length > 0) {
      payload.rows = parseJsonRows() as Array<{ email: string; cohortName?: string | null; expiryDate?: string | null }>;
    }
    setBusy(true);
    try {
      const job = await bulkEnrolmentApi.createJob(payload);
      setNotice(`Job started: ${job.totalRows} rows (${job.validRows} valid).`);
      setPreview(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight text-ink-900">Bulk enrolment</h1>
      <p className="mt-1 text-sm text-ink-500">
        Admin bulk enrolment (US-2.2.3) — paste CSV or JSON rows, preview the validation report, then commit as a job.
        Emails must match existing accounts; unknown emails are skipped with a reason.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <section className="mt-6 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink-900">New job</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-ink-800">
            Course
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            >
              {courses.length === 0 ? <option value="">No courses found</option> : null}
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink-800">
            CSV (email,cohort,expiry — first line optional header)
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={5}
              placeholder="student.one@example.com,Data 2026,2026-12-31"
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-800">
            Or JSON rows
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={5}
              placeholder={'[{"email":"student.one@example.com","cohortName":"Data 2026","expiryDate":"2026-12-31"}]'}
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
            />
          </label>
          <button
            onClick={() => void runPreview()}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Previewing…" : "Preview"}
          </button>
        </div>

        {preview ? (
          <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50 p-4">
            <p className="text-sm font-semibold text-ink-900">
              {preview.totalRows} rows · {preview.validRows} valid · {preview.invalidRows} invalid · {preview.enrolledRows} already enrolled · {preview.skippedRows} skipped
            </p>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-ink-600">
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row} className="border-t border-ink-100">
                      <td className="px-2 py-1 text-ink-500">{r.row}</td>
                      <td className="px-2 py-1 text-ink-800">{r.email}</td>
                      <td className="px-2 py-1">
                        <span className={r.status === "valid" ? "text-green-700" : r.status === "enrolled" ? "text-ink-500" : "text-red-700"}>{r.status}</span>
                      </td>
                      <td className="px-2 py-1 text-ink-500">{r.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => void createJob()}
              disabled={busy || preview.validRows === 0}
              className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "Creating…" : `Enrol ${preview.validRows} valid learner${preview.validRows === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink-900">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No bulk enrolment jobs yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <p className="font-semibold text-ink-900">
                  {j.fileName ?? "upload"}{" "}
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">{j.status}</span>
                </p>
                <p className="text-xs text-ink-500">
                  {j.courseTitle ?? j.courseId} · {new Date(j.createdAt).toLocaleString()} · {j.enrolledRows}/{j.totalRows} enrolled
                </p>
                {j.completedAt ? <p className="text-xs text-ink-500">Completed {new Date(j.completedAt).toLocaleString()}</p> : null}
                {j.report.length > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-brand-600">Validation report ({j.report.length} rows)</summary>
                    <div className="mt-1 max-h-48 overflow-auto">
                      <ul className="text-xs">
                        {j.report.slice(0, 100).map((r) => (
                          <li key={r.row} className={r.status === "valid" ? "text-green-700" : r.status === "enrolled" ? "text-ink-500" : "text-red-700"}>
                            [{r.row}] {r.email} — {r.status}{r.reason ? ` · ${r.reason}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}