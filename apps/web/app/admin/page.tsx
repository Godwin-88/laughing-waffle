"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi, formatPrice, type AdminOverview } from "@/lib/api";

export default function AdminOverviewPage() {
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || user.role !== "admin") return;
    void adminApi.overview().then(setOverview).catch((err: Error) => setError(err.message));
  }, [loading, user]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-500">Loading…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">
          Please <Link className="text-brand-600 hover:underline" href="/login">sign in</Link> to continue.
        </p>
      </div>
    );
  }
  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="text-ink-700">Instructor access required to view this page.</p>
        <Link className="mt-4 inline-block text-brand-600 hover:underline" href="/dashboard">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const tiles: Array<{ label: string; value: string; hint: string; href: string }> = [
    { label: "Learners", value: String(overview?.learners ?? "–"), hint: "Active learner accounts", href: "/admin/users?role=learner" },
    { label: "Instructors", value: String(overview?.instructors ?? "–"), hint: "Course creators", href: "/admin/users?role=instructor" },
    { label: "Published courses", value: String(overview?.publishedCourses ?? "–"), hint: "Live in the catalogue", href: "/courses" },
    { label: "Paid orders", value: String(overview?.paidOrders ?? "–"), hint: "Completed checkouts", href: "/admin/audit" },
    { label: "Revenue", value: formatPrice(overview?.revenueCents ?? 0), hint: "Gross USD", href: "/admin/audit" },
    { label: "Certificates issued", value: String(overview?.certificatesIssued ?? "–"), hint: "US-5.1.2", href: "/certificates" },
    { label: "Pending GDPR", value: String(overview?.pendingGdpr ?? "–"), hint: "Awaiting confirmation", href: "/admin/gdpr" },
    { label: "Admins", value: String(overview?.admins ?? "–"), hint: "Active administrators", href: "/admin/users?role=admin" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight text-ink-900">Admin</h1>
      <p className="mt-1 text-sm text-ink-500">Control panel — user management, platform configuration, GDPR, and the audit trail (US-7.1.x, US-7.2.1).</p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow"
          >
            <p className="text-3xl font-black text-ink-900">{t.value}</p>
            <p className="mt-1 text-sm font-semibold text-ink-800">{t.label}</p>
            <p className="text-xs text-ink-500">{t.hint}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <Link href="/admin/users" className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm transition hover:border-brand-300 hover:shadow">
          <p className="text-lg font-bold text-ink-900">User management</p>
          <p className="mt-1 text-sm text-ink-600">Search, filter, change roles, suspend, force password resets, export CSV, and administrate GDPR requests (US-7.1.1).</p>
        </Link>
        <Link href="/admin/settings" className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm transition hover:border-brand-300 hover:shadow">
          <p className="text-lg font-bold text-ink-900">Platform settings</p>
          <p className="mt-1 text-sm text-ink-600">Branding, email sender, maintenance mode, payment gateways, feature flags, and revision rollback (US-7.1.2).</p>
        </Link>
        <Link href="/admin/audit" className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm transition hover:border-brand-300 hover:shadow">
          <p className="text-lg font-bold text-ink-900">Audit trail</p>
          <p className="mt-1 text-sm text-ink-600">Append-only log of every administrative action with actor, target, and details (US-7.1.1).</p>
        </Link>
        <Link href="/admin/gdpr" className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm transition hover:border-brand-300 hover:shadow">
          <p className="text-lg font-bold text-ink-900">GDPR requests</p>
          <p className="mt-1 text-sm text-ink-600">Oversee all data-export and deletion requests across the platform (US-7.2.1).</p>
        </Link>
      </div>
    </main>
  );
}