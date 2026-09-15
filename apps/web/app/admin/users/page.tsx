"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi } from "@/lib/api";
import type { AdminUserListResponse, AdminUserRow } from "@takwimu/shared";

const STATUS_LABEL: Record<string, string> = { active: "Active", suspended: "Suspended", pending_verification: "Pending verification" };

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [result, setResult] = useState<AdminUserListResponse | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await adminApi.users({ search, role: role || undefined, status: status || undefined, page });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") return;
    void load();
  }, [loading, user, page]);

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

  async function act(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500">
        <Link className="text-brand-600 hover:underline" href="/admin">← Admin</Link>
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink-900">User management</h1>
      <p className="mt-1 text-sm text-ink-500">Search, filter, change roles, suspend, force password resets, and export (US-7.1.1).</p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label className="block text-xs font-medium text-ink-600">
          Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" className="mt-1 w-56 rounded-lg border border-ink-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-ink-600">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 rounded-lg border border-ink-300 px-3 py-2 text-sm">
            <option value="">All roles</option>
            <option value="learner">Learner</option>
            <option value="instructor">Instructor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-ink-600">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 rounded-lg border border-ink-300 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="pending_verification">Pending verification</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Search
        </button>
        <button
          type="button"
          onClick={() => void adminApi.exportCsv({ search, role: role || undefined, status: status || undefined })}
          className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-semibold text-ink-700"
        >
          Export CSV
        </button>
      </form>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      <table className="mt-6 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2">Last active</th>
            <th className="px-3 py-2">Enrolments</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
{(result?.items ?? []).map((row: AdminUserRow) => {
            const isSelf = row.id === user.id;
            return (
              <tr key={row.id} className="border-b border-ink-200">
                <td className="px-3 py-2 font-medium text-ink-800">{row.firstName} {row.lastName}{isSelf ? " (you)" : ""}</td>
                <td className="px-3 py-2 text-ink-700">{row.email}</td>
                <td className="px-3 py-2">
                  <select
                    value={row.role}
                    disabled={isSelf}
                    onChange={(e) =>
                      void act(
                        () => adminApi.updateUser(row.id, { role: e.target.value as "learner" | "instructor" | "admin" }),
                        "Role updated.",
                      )
                    }
                    className="rounded-md border border-ink-300 px-2 py-1 text-xs"
                  >
                    <option value="learner">Learner</option>
                    <option value="instructor">Instructor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  {row.status === "active" ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Active</span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{STATUS_LABEL[row.status] ?? row.status}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-600">{new Date(row.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-ink-600">{row.lastActiveAt ? new Date(row.lastActiveAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2 text-ink-600">{row.enrolmentCount}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => void act(() => adminApi.updateUser(row.id, { status: row.status === "active" ? "suspended" : "active" }), row.status === "active" ? "User suspended." : "User unsuspended.")}
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700"
                    >
                      {row.status === "active" ? "Suspend" : "Un-suspend"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(() => adminApi.forcePasswordReset(row.id), "Password reset email sent.")}
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700"
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => void act(() => adminApi.gdprExportForUser(row.id), "GDPR export requested for user.")}
                      className="rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700"
                    >
                      GDPR export
                    </button>
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => void act(() => adminApi.deleteUser(row.id), "User anonymised.")}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {result && result.total > result.pageSize && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-ink-300 px-3 py-1.5 text-ink-700">
            ← Prev
          </button>
          <span className="text-ink-500">
            Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))} · {result.total} users
          </span>
          <button type="button" disabled={page * result.pageSize >= result.total} onClick={() => setPage(page + 1)} className="rounded-lg border border-ink-300 px-3 py-1.5 text-ink-700">
            Next →
          </button>
        </div>
      )}
    </main>
  );
}