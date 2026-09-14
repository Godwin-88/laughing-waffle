"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authApi, ApiClientError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.login(email, password);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-500">Sign in to continue learning.</p>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-ink-700">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm font-medium text-ink-700">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500"
              placeholder="••••••••"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-xl bg-brand-600 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-600">
          New to Takwimu?{" "}
          <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-xs text-ink-400">
          Demo: <code className="rounded bg-ink-100 px-1.5">demo@takwimu.school</code> / <code className="rounded bg-ink-100 px-1.5">Takwimu123</code>
        </p>
      </div>
    </div>
  );
}