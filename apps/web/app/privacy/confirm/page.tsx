"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { gdprApi } from "@/lib/api";

export default function PrivacyConfirmPage() {
  const params = useSearchParams();
  const prefill = params.get("token") ?? "";
  const [token, setToken] = useState(prefill);
  const [result, setResult] = useState<{ status?: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setResult(null);
    if (token.trim().length < 8) {
      setError("Please paste the confirmation code from your email.");
      return;
    }
    try {
      const res = await gdprApi.confirm(token.trim());
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-black tracking-tight text-ink-900">Confirm your data request</h1>
      <p className="mt-2 text-sm text-ink-600">
        We emailed you a one-time confirmation code. Enter it below to complete your GDPR data export or account deletion (US-7.2.1).
      </p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-800">
          <p className="font-semibold">{result.message}</p>
          {result.status === "processing" && (
            <p className="mt-1">Check <Link className="text-brand-600 hover:underline" href="/settings/privacy">Privacy &amp; data</Link> shortly for the completed request.</p>
          )}
        </div>
      )}

      <label className="mt-6 block text-xs font-medium text-ink-600">
        Confirmation code
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your code" className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-3 font-mono text-base" />
      </label>
      <button type="button" onClick={() => void confirm()} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">
        Confirm request
      </button>

      <p className="mt-6 text-sm text-ink-500">
        <Link className="text-brand-600 hover:underline" href="/settings/privacy">← Back to privacy &amp; data</Link>
      </p>
    </main>
  );
}