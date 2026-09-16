"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ApiClientRow } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { oauthAdminApi } from "@/lib/api";

/** US-8.1.1 — machine-to-machine API clients (OAuth 2.0 client credentials). */
export default function AdminApiClientsPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<ApiClientRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("catalogue:read");
  const [secret, setSecret] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void oauthAdminApi
      .list()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") return;
    refresh();
  }, [loading, user, refresh]);
async function createKey() {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await oauthAdminApi.create({ name, scopes });
      setSecret(res.clientSecret);
      setName("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(clientId: string) {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const res = await oauthAdminApi.rotate(clientId);
      setSecret(res.clientSecret);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(clientId: string) {
    if (!confirm("Revoke this API key? Existing tokens become invalid immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      await oauthAdminApi.revoke(clientId);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        <Link className="mt-4 inline-block text-brand-600 hover:underline" href="/dashboard">
          ← Back to dashboard
        </Link>
      </div>
    );
const apiHost = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">API keys</h1>
          <p className="mt-1 text-sm text-ink-500">
            OAuth 2.0 client-credentials for partners integrating the course catalogue (US-8.1.1).
          </p>
        </div>
        <Link href="/admin" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← Admin
        </Link>
      </header>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {secret && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-bold text-green-800">One-time client secret — copy it now</p>
          <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-green-900">{secret}</code>
        </div>
      )}

      <section className="mt-8 rounded-2xl border border-ink-200 bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink-500">Create a client</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-40">
            <span className="text-xs font-semibold text-ink-600">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Partner university portal"
              className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="flex-1 min-w-40">
            <span className="text-xs font-semibold text-ink-600">Scopes (comma-separated)</span>
            <input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <button
            type="button"
            onClick={() => void createKey()}
            disabled={busy || name.trim().length === 0}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create client"}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Token endpoint: <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{apiHost}/api/v1/oauth/token</code>
        </p>
      </section>

      <section className="mt-8 overflow-hidden rounded-2xl border border-ink-200 bg-white">
        <header className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink-500">
            Clients ({items.length})
          </h2>
        </header>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-500">No API clients yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-bold text-ink-900">{c.name}</p>
                  <p className="truncate font-mono text-xs text-ink-500">{c.clientId}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    Scopes: <span className="font-mono">{c.scopes}</span>
                    {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleString()}` : " · never used"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      c.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {c.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void rotate(c.clientId)}
                    disabled={busy || c.status !== "active"}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-brand-400 disabled:opacity-50"
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    onClick={() => void revoke(c.clientId)}
                    disabled={busy || c.status !== "active"}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
  }