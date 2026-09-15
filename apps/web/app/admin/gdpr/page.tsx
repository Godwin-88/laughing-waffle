"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi } from "@/lib/api";
import type { DataRequestListResponse, DataRequestSummary } from "@takwimu/shared";

const TYPE_LABEL: Record<string, string> = { export: "Export", delete: "Deletion" };
const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Pending confirmation",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function AdminGdprPage() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState<DataRequestListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || user.role !== "admin") return;
    void adminApi
      .gdprRequests()
      .then(setRequests)
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
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink-900">GDPR requests</h1>
      <p className="mt-1 text-sm text-ink-500">All data-export and deletion requests across the platform, newest first (US-7.2.1).</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
            <th className="px-3 py-2">Requested</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Initiator</th>
            <th className="px-3 py-2">Completed</th>
            <th className="px-3 py-2">Expires</th>
          </tr>
        </thead>
        <tbody>
          {(requests?.items ?? []).map((r: DataRequestSummary) => (
            <tr key={r.id} className="border-b border-ink-200">
              <td className="px-3 py-2 text-ink-700">{new Date(r.requestedAt).toLocaleString()}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.type === "delete" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                  {TYPE_LABEL[r.type] ?? r.type}
                </span>
              </td>
              <td className="px-3 py-2 text-ink-700">{STATUS_LABEL[r.status] ?? r.status}</td>
              <td className="px-3 py-2 text-ink-700">{r.initiatedBy === "admin" ? "Administrator" : "Learner"}</td>
              <td className="px-3 py-2 text-ink-600">{r.completedAt ? new Date(r.completedAt).toLocaleString() : "—"}</td>
              <td className="px-3 py-2 text-ink-600">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {requests && requests.items.length === 0 && <p className="mt-6 text-ink-500">No GDPR requests yet.</p>}
    </main>
  );
}