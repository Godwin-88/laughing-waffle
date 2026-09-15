"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { gdprApi } from "@/lib/api";
import type { DataRequestListResponse, DataRequestSummary } from "@takwimu/shared";

const TYPE_LABEL: Record<string, string> = { export: "Export", delete: "Account deletion" };
const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Awaiting your email confirmation",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function PrivacySettingsPage() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState<DataRequestListResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function refresh() {
    try {
      setRequests(await gdprApi.mine());
    } catch {
      /* keep current list */
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    void refresh();
  }, [loading, user]);

  if (loading) return <p className="mx-auto max-w-6xl px-4 py-16 text-ink-500">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">Please <Link className="text-brand-600 hover:underline" href="/login">sign in</Link> to continue.</p>
      </div>
    );
  }

  async function requestExport() {
    setError(null);
    setNotice(null);
    try {
      const res = await gdprApi.requestExport();
      setNotice(res.message + " When you confirm, your ZIP will appear here.");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function requestDelete() {
    setError(null);
    setNotice(null);
    try {
      const res = await gdprApi.requestDelete();
      setNotice(res.message);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500">
        <Link className="text-brand-600 hover:underline" href="/dashboard">← My learning</Link>
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink-900">Privacy & data</h1>
      <p className="mt-1 text-sm text-ink-500">Your rights under the GDPR (US-7.2.1): access, export, and delete your personal data.</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
<section className="mt-6 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink-900">Export your data</h2>
        <p className="mt-1 text-sm text-ink-600">
          Request a ZIP archive of your profile, enrolments, lesson progress, quiz attempts, gradebook, orders, certificates, and usage analytics. We email you a confirmation link first; after confirming, the archive appears below (within 24 hours, usually seconds).
        </p>
        <button type="button" onClick={() => void requestExport()} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
          Request data export
        </button>
      </section>

      <section className="mt-6 rounded-2xl border border-red-200 bg-red-50/40 p-5">
        <h2 className="text-lg font-bold text-red-800">Delete your account</h2>
        <p className="mt-1 text-sm text-ink-600">
          We anonymise your personal information (name, email, avatar, bio) while keeping course progress aggregates so statistics stay accurate. A confirmation email is always required.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={confirmDelete} onChange={(e) => setConfirmDelete(e.target.checked)} className="h-4 w-4 rounded border-red-300" />
          I understand this action is irreversible.
        </label>
        <button type="button" disabled={!confirmDelete} onClick={() => void requestDelete()} className="mt-3 rounded-lg border border-red-400 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">
          Request account deletion
        </button>
      </section>
<section className="mt-8">
        <h2 className="text-lg font-bold text-ink-900">Recent requests</h2>
        <table className="mt-3 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Download</th>
            </tr>
          </thead>
          <tbody>
            {(requests?.items ?? []).map((r: DataRequestSummary) => (
              <tr key={r.id} className="border-b border-ink-200">
                <td className="px-3 py-2 text-ink-700">{new Date(r.requestedAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-ink-700">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="px-3 py-2 text-ink-700">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-3 py-2">
                  {r.status === "completed" && r.downloadUrl ? (
                    <button type="button" onClick={() => void gdprApi.download(r.id)} className="rounded-md bg-brand-600 px-3 py-1 text-xs font-bold text-white">
                      Download ZIP
                    </button>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests && requests.items.length === 0 && <p className="mt-3 text-ink-500">No data requests yet.</p>}
      </section>
    </main>
  );
}