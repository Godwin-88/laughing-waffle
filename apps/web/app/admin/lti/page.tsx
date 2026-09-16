"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LtiRegistrationRow } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { ltiAdminApi } from "@/lib/api";

/** US-8.1.2 — LTI 1.3 tool provider: manage originating LMS registrations. */
export default function AdminLtiPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<LtiRegistrationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [toolName, setToolName] = useState("");
  const [authLoginUrl, setAuthLoginUrl] = useState("");
  const [authTokenUrl, setAuthTokenUrl] = useState("");
  const [jwksUrl, setJwksUrl] = useState("");
  const [agsLineItemUrl, setAgsLineItemUrl] = useState("");
  const [keySetJson, setKeySetJson] = useState("");

  const refresh = useCallback(() => {
    void ltiAdminApi
      .list()
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") return;
    refresh();
  }, [loading, user, refresh]);

  async function createRegistration() {
    setBusy(true);
    setError(null);
    try {
      await ltiAdminApi.create({
        issuer,
        clientId,
        toolName: toolName || undefined,
        authLoginUrl: authLoginUrl || undefined,
        authTokenUrl: authTokenUrl || undefined,
        jwksUrl: jwksUrl || undefined,
        agsLineItemUrl: agsLineItemUrl || undefined,
        platformKeySetJson: keySetJson || undefined,
        active: true,
      });
      setIssuer("");
      setClientId("");
      setToolName("");
      setAuthLoginUrl("");
      setAuthTokenUrl("");
      setJwksUrl("");
      setAgsLineItemUrl("");
      setKeySetJson("");
      setShowForm(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(reg: LtiRegistrationRow) {
    setBusy(true);
    setError(null);
    try {
      await ltiAdminApi.update(reg.id, { active: !reg.active });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(reg: LtiRegistrationRow) {
    if (!confirm(`Delete the "${reg.issuer}" registration and its grade ledger?`)) return;
    setBusy(true);
    setError(null);
    try {
      await ltiAdminApi.remove(reg.id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const apiHost = typeof window !== "undefined" ? window.location.origin : "";
  const jwksHref = `${apiHost}/api/lti/jwks`;

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
return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink-900">LTI integrations</h1>
          <p className="mt-1 text-sm text-ink-500">
            LTI 1.3 tool provider — register each originating LMS (Canvas, Moodle, Blackboard…) (US-8.1.2).
          </p>
        </div>
        <Link href="/admin" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← Admin
        </Link>
      </header>

      <div className="mt-4 rounded-xl border border-ink-200 bg-white px-4 py-3 text-xs text-ink-600">
        Add this tool to your LMS — OIDC login URL:{" "}
        <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{apiHost}/api/lti/login</code>
        {" "}· launch URL:{" "}
        <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{apiHost}/api/lti/launch</code>
        {" "}· JWKS:{" "}
        <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">{jwksHref}</code>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink-900">Registrations ({items.length})</h2>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "+ Add registration"}
        </button>
      </div>

      {showForm ? (
        <section className="mt-4 rounded-2xl border border-ink-200 bg-white p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">Issuer</span>
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://canvas.example.edu"
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">Client ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="10000000000001"
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">Tool name</span>
              <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Takwimu LMS"
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">OIDC auth endpoint</span>
              <input value={authLoginUrl} onChange={(e) => setAuthLoginUrl(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">Token endpoint</span>
              <input value={authTokenUrl} onChange={(e) => setAuthTokenUrl(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">JWKS URL (platform)</span>
              <input value={jwksUrl} onChange={(e) => setJwksUrl(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs font-semibold text-ink-600">AGS line item URL</span>
              <input value={agsLineItemUrl} onChange={(e) => setAgsLineItemUrl(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
            </label>
          </div>
          <textarea value={keySetJson} onChange={(e) => setKeySetJson(e.target.value)} rows={3}
            placeholder="Paste the platform public key set JSON (optional — fallback if no JWKS URL)"
            className="mt-3 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-brand-500" />
          <button type="button" onClick={() => void createRegistration()} disabled={busy || issuer.trim().length === 0 || clientId.trim().length === 0}
            className="mt-3 rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "Saving…" : "Save registration"}
          </button>
        </section>
      ) : null}
      <section className="mt-6 overflow-hidden rounded-2xl border border-ink-200 bg-white">
        {items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-500">No LTI registrations yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map((reg) => (
              <li key={reg.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-bold text-ink-900">{reg.toolName || reg.issuer}</p>
                  <p className="truncate font-mono text-xs text-ink-500">{reg.issuer} · client {reg.clientId}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    AGS: {reg.agsLineItemUrl ?? "disabled"}
                    {reg.jwksUrl ? " · JWKS URL" : reg.authLoginUrl ? " · OIDC auth URL" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${reg.active ? "bg-green-100 text-green-700" : "bg-ink-100 text-ink-500"}`}>
                    {reg.active ? "active" : "paused"}
                  </span>
                  <button type="button" onClick={() => void toggleActive(reg)} disabled={busy}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-brand-400 disabled:opacity-50">
                    {reg.active ? "Pause" : "Activate"}
                  </button>
                  <button type="button" onClick={() => void remove(reg)} disabled={busy}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                    Delete
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