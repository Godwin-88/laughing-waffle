"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi } from "@/lib/api";
import type { ConfigRevision, ConfigRevisionsResponse, PaymentGateway, PlatformConfig } from "@takwimu/shared";

const GATEWAYS: Array<{ id: PaymentGateway; label: string }> = [
  { id: "stripe", label: "Card (Stripe)" },
  { id: "mpesa", label: "M-Pesa (Daraja STK)" },
  { id: "paypal", label: "PayPal" },
];

export default function AdminSettingsPage() {
  const { user, loading } = useAuth();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [revisions, setRevisions] = useState<ConfigRevisionsResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || user.role !== "admin") return;
    void Promise.all([adminApi.config(), adminApi.configRevisions()])
      .then(([c, r]) => {
        setConfig(structuredClone(c.config));
        setRevisions(r);
      })
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

  async function save() {
    setError(null);
    setNotice(null);
    if (!config) return;
    try {
      const res = await adminApi.updateConfig(config as unknown as Record<string, unknown>);
      setConfig(res.config);
      setRevisions(await adminApi.configRevisions());
      setNotice("Configuration updated. Changes propagate within 60 seconds.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rollback(revisionId: string) {
    setError(null);
    setNotice(null);
    try {
      const res = await adminApi.rollbackConfig(revisionId);
      setConfig(res.config);
      setRevisions(await adminApi.configRevisions());
      setNotice("Configuration rolled back.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-sm text-ink-500">
        <Link className="text-brand-600 hover:underline" href="/admin">← Admin</Link>
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-ink-900">Platform settings</h1>
      <p className="mt-1 text-sm text-ink-500">Branding, email sender, maintenance mode, payment gateways, feature flags, and revision rollback (US-7.1.2).</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {config && (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink-900">Branding</h2>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              Platform name
              <input value={config.platform.name} onChange={(e) => setConfig({ ...config, platform: { ...config.platform, name: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              Primary colour
              <input value={config.platform.primaryColor} onChange={(e) => setConfig({ ...config, platform: { ...config.platform, primaryColor: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              Default language
              <input value={config.platform.defaultLanguage} onChange={(e) => setConfig({ ...config, platform: { ...config.platform, defaultLanguage: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              Timezone
              <input value={config.platform.timezone} onChange={(e) => setConfig({ ...config, platform: { ...config.platform, timezone: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
          </section>

          <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink-900">Email sender</h2>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              From name
              <input value={config.email.fromName} onChange={(e) => setConfig({ ...config, email: { ...config.email, fromName: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              From address
              <input value={config.email.fromAddress} onChange={(e) => setConfig({ ...config, email: { ...config.email, fromAddress: e.target.value } })} className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
          </section>
<section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink-900">Maintenance mode</h2>
            <label className="flex items-center gap-3 text-sm text-ink-700">
              <input type="checkbox" checked={config.maintenance.enabled} onChange={(e) => setConfig({ ...config, maintenance: { ...config.maintenance, enabled: e.target.checked } })} className="h-4 w-4 rounded border-ink-300" />
              Enabled (non-admins receive a 503)
            </label>
            <label className="mt-3 block text-xs font-medium text-ink-600">
              Notice
              <textarea value={config.maintenance.message} onChange={(e) => setConfig({ ...config, maintenance: { ...config.maintenance, message: e.target.value } })} className="mt-1 h-24 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm" />
            </label>
          </section>

          <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink-900">Payment gateways</h2>
            <p className="mt-1 text-xs text-ink-500">Disabled gateways are rejected at checkout with a friendly error.</p>
            <div className="mt-3 flex flex-col gap-2 text-sm text-ink-700">
              {GATEWAYS.map((g) => {
                const checked = config.payments.enabledGateways.includes(g.id);
                return (
                  <label key={g.id} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const enabled = e.target.checked
                          ? [...config.payments.enabledGateways, g.id]
                          : config.payments.enabledGateways.filter((x: PaymentGateway) => x !== g.id);
                        setConfig({ ...config, payments: { enabledGateways: enabled } });
                      }}
                      className="h-4 w-4 rounded border-ink-300"
                    />
                    {g.label}
                  </label>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-ink-900">Feature flags</h2>
            <div className="mt-3 flex flex-col gap-2 text-sm text-ink-700">
              {([
                ["certificates", "Certificates (block claim + hide if off)"],
                ["discussions", "Discussions"],
                ["offlineDownload", "Offline download"],
              ] as Array<[string, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean((config.features as Record<string, boolean>)[key])}
                    onChange={(e) => setConfig({ ...config, features: { ...config.features, [key]: e.target.checked } })}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="mt-8 flex gap-3">
        <button type="button" onClick={() => void save()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">
          Save changes
        </button>
      </div>
<section className="mt-10 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink-900">Configuration revisions</h2>
        <p className="mt-1 text-xs text-ink-500">Each save snapshots the full config; click Rollback to restore a previous snapshot as the active config.</p>
        <table className="mt-3 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2">Applied at</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Platform name</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {(revisions?.items ?? []).map((r: ConfigRevision) => (
              <tr key={r.id} className="border-b border-ink-200">
                <td className="px-3 py-2 text-ink-700">{new Date(r.appliedAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-ink-700">{r.actorName ?? "system"}</td>
                <td className="px-3 py-2 text-ink-700">{r.snapshot.platform.name}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => void rollback(r.id)} className="rounded-md border border-amber-400 px-2 py-1 text-xs font-medium text-amber-700">
                    Rollback
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}