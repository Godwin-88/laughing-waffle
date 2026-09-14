"use client";

import Link from "next/link";
import { useState } from "react";
import { authApi, ApiClientError } from "@/lib/api";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function resend(e: { preventDefault(): void }) {
    e.preventDefault();
    setMsg(null);
    try {
      await authApi.resendVerification(email);
      setMsg("Verification email sent — check your inbox.");
    } catch (err) {
      setMsg(err instanceof ApiClientError ? err.message : "Could not resend.");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="rounded-2xl border border-ink-200 bg-white p-8">
        <p className="text-5xl">✉️</p>
        <h1 className="mt-4 text-2xl font-extrabold text-ink-900">Verify your email</h1>
        <p className="mt-2 text-sm text-ink-600">
          We emailed you a verification link. Open it to activate your account, then sign in.
        </p>
        {msg ? <div className="mt-3 rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-800">{msg}</div> : null}
        <form onSubmit={resend} className="mt-5 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-11 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500"
          />
          <button type="submit" className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">
            Send link
          </button>
        </form>
        <Link href="/login" className="mt-6 block w-full rounded-xl bg-ink-100 py-3 text-center text-sm font-semibold text-ink-700 hover:bg-ink-200">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}