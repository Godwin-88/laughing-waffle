"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SamlProviderRow } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { samlApi, API_BASE } from "@/lib/api";

/**
 * Sprint 10 — SAML 2.0 SSO (US-1.1.3).
 * Admins register enterprise identity providers by pasting their IdP
 * metadata XML. Users sign in from /login -> /saml/login/:id -> IdP ->
 * (ACS) provisioned automatically (JIT) with `lms_role` mapped from the
 * assertion attribute configured below.
 */
export default function AdminSamlPage() {
  const { user, loading } = useAuth();
  const [providers, setProviders] = useState<SamlProviderRow[]>([]);
  const [label, setLabel] = useState("");
  const [metadataXml, setMetadataXml] = useState("");
  const [roleAttr, setRoleAttr] = useState("lms_role");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const res = await samlApi.list();
    setProviders(res.items);
  }

  useEffect(() => {
    if (loading || !user || user.role !== "admin") return;
    void refresh().catch((err: Error) => setError(err.message));
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

  async function createProvider() {
    setError(null);
    setNotice(null);
    if (!label.trim() || !metadataXml.trim()) {
      setError("Label and IdP metadata XML are required.");
      return;
    }
    setBusy(true);
    try {
      await samlApi.create({ label: label.trim(), metadataXml: metadataXml.trim(), lmsRoleAttribute: roleAttr.trim() });
      setLabel("");
      setMetadataXml("");
      await refresh();
      setNotice("Identity provider registered. You can now use the login URL for this provider.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create provider.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, next: Partial<{ status: 'active' | 'paused'; lmsRoleAttribute: string }>) {
    try {
      await samlApi.update(id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    }
  }

  async function refreshIdp(id: string) {
    try {
      await samlApi.refresh(id);
      await refresh();
      setNotice("IdP metadata refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    }
  }

  async function remove(id: string, labelText: string) {
    if (!confirm(`Remove SAML provider "${labelText}"? Users signed in via this IdP stay signed in until they next sign out.`)) return;
    try {
      await samlApi.remove(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight text-ink-900">SAML SSO</h1>
      <p className="mt-1 text-sm text-ink-500">
        Enterprise single sign-on (US-1.1.3) — register identity providers; JIT-provisioned accounts map the assertion&apos;s{" "}
        <code className="rounded bg-ink-100 px-1">{roleAttr}</code> attribute to the platform role.
      </p>


      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <section className="mt-6 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink-900">Register identity provider</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-ink-800">
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Acme University SSO"
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-800">
            IdP metadata XML
            <textarea
              value={metadataXml}
              onChange={(e) => setMetadataXml(e.target.value)}
              rows={6}
              placeholder={'<?xml version="1.0"?>\n<EntityDescriptor entityID="https://idp.example.com">…'}
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-800">
            Role attribute
            <input
              value={roleAttr}
              onChange={(e) => setRoleAttr(e.target.value)}
              placeholder="lms_role"
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>
          <button
            onClick={() => void createProvider()}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Registering…" : "Register provider"}
          </button>
        </div>
        <div className="mt-5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <p>
            <strong className="text-ink-800">Service-provider metadata:</strong>{" "}
            <code className="break-all">{API_BASE}/api/v1/saml/metadata</code> — share this URL with the IdP.
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-ink-900">Registered providers</h2>
        {providers.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No identity providers registered yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {providers.map((p) => (
              <li key={p.id} className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">
                      {p.label}{" "}
                      <span
                        className={
                          p.status === "active"
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                            : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        }
                      >
                        {p.status}
                      </span>
                    </p>
                    <p className="mt-1 break-all text-xs text-ink-500">Issuer: {p.issuer ?? "— (parsed from metadata)"}</p>
                    <p className="break-all text-xs text-ink-500">SSO URL: {p.ssoUrl ?? "—"}</p>
                    {p.lastRefreshAt ? (
                      <p className="text-xs text-ink-500">Metadata refreshed {new Date(p.lastRefreshAt).toLocaleString()}</p>
                    ) : null}
                    <p className="mt-1 break-all text-xs text-ink-600">
                      Login: <code>{API_BASE}/api/v1/saml/login/{p.id}</code>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 text-xs">
                    <button
                      onClick={() => void patch(p.id, { status: p.status === "active" ? "paused" : "active" })}
                      className="rounded-md border border-ink-300 px-2 py-1 text-ink-700 hover:bg-ink-100"
                    >
                      {p.status === "active" ? "Pause" : "Activate"}
                    </button>
                    <button
                      onClick={() => void refreshIdp(p.id)}
                      className="rounded-md border border-ink-300 px-2 py-1 text-ink-700 hover:bg-ink-100"
                    >
                      Refresh metadata
                    </button>
                    <button
                      onClick={() => void remove(p.id, p.label)}
                      className="rounded-md border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
