"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LtiGradesResponse } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { ltiAdminApi } from "@/lib/api";

/** US-8.1.2 — AGS grade passback visibility for LTI registrations. */
export default function AdminLtiGradesPage() {
  const { user, loading } = useAuth();
  const params = useSearchParams();
  const registrationId = params.get("registrationId");
  const [ledger, setLedger] = useState<LtiGradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void ltiAdminApi
      .grades(registrationId)
      .then(setLedger)
      .catch((err: Error) => setError(err.message));
  }, [registrationId]);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") return;
    refresh();
  }, [loading, user, refresh]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-ink-500">Loading…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-ink-700">
          Please <Link className="text-brand-600 hover:underline" href="/login">sign in</Link> to continue.
        </p>
      </div>
    );
  }
  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-ink-700">Admin access required to view this page.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">LTI grade ledger</h1>
          <p className="mt-1 text-sm text-ink-500">
            Quiz scores pushed back to originating LMS platforms (US-8.1.2 AGS).
          </p>
        </div>
        <Link href="/admin/lti" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← LTI integrations
        </Link>
      </header>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="mt-8 overflow-hidden rounded-2xl border border-ink-200 bg-white">
        {!ledger || ledger.items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-500">No grade passback records yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50 text-xs uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {ledger.items.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono text-ink-800">{row.scoreGiven} / {row.scoreMaximum}</td>
                  <td className="px-4 py-3 text-ink-600">{row.userId.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        row.status === "pushed"
                          ? "bg-green-100 text-green-700"
                          : row.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-ink-100 text-ink-600"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-ink-500" title={row.error ?? ""}>
                    {row.error ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}