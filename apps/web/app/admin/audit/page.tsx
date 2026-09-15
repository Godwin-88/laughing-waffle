"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi } from "@/lib/api";
import type { AuditLogEntry, AuditLogListResponse } from "@takwimu/shared";

export default function AdminAuditPage() {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<AuditLogListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || user.role !== "admin") return;
    void adminApi
      .audit({ limit: 200 })
      .then(setResult)
      .catch((err: Error) => setError(err.message));
  }, [loading, user]);

  if (loading) return <p className="mx-auto max-w-6xl px-4 py-16 text-ink-500">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">Please <Link className="text-brand-600 hover:underline" href="/login">sign in</Link> to continue.</p>
      </div>
    );
  }
  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">Admin access required to view this page.</p>
        <Link className="mt-4 inline-block text-brand-600 hover:underline" href="/dashboard">← Back to dashboard</Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500">
        <Link className="text-brand-600 hover:underline" href="/admin">← Admin</Link>
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink-900">Audit trail</h1>
      <p className="mt-1 text-sm text-ink-500">Append-only log of every administrative action, newest first (US-7.1.1).</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Target</th>
            <th className="px-3 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {(result?.items ?? []).map((entry: AuditLogEntry) => (
            <tr key={entry.id} className="border-b border-ink-200">
              <td className="px-3 py-2 text-ink-600">{new Date(entry.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2 text-ink-700">
                {entry.actorName ?? entry.actorEmail ?? <span className="text-ink-400">system</span>}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-ink-800">{entry.action}</td>
              <td className="px-3 py-2 text-ink-700">
                {entry.targetType}
                {entry.targetId ? <span className="font-mono text-xs text-ink-400"> · {entry.targetId.slice(0, 8)}</span> : null}
              </td>
              <td className="px-3 py-2 text-ink-500">{entry.details ? JSON.stringify(entry.details) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result && result.total === 0 && <p className="mt-6 text-ink-500">No audit entries recorded yet.</p>}
    </main>
  );
}