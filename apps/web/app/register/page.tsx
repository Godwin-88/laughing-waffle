"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authApi, ApiClientError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", consent: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: string, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authApi.register({ ...form, password: form.password, consent: form.consent });
      router.push("/verify-email");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Create your account</h1>
        <p className="mt-1 text-sm text-ink-500">Free forever. No credit card required.</p>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Labeled name="firstName" label="First name" value={form.firstName} onChange={(v) => set("firstName", v)} placeholder="Ada" />
            <Labeled name="lastName" label="Last name" value={form.lastName} onChange={(v) => set("lastName", v)} placeholder="Lovelace" />
          </div>
          <Labeled name="email" type="email" label="Email" value={form.email} onChange={(v) => set("email", v)} placeholder="you@example.com" />
          <label className="block text-sm font-medium text-ink-700">
            Password
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500"
              placeholder="8+ characters, uppercase + number"
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-600">
            <input type="checkbox" required checked={form.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-0.5 accent-brand-600" />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="font-semibold text-brand-600 hover:text-brand-700">terms</Link>{" "}
              and <Link href="/privacy" className="font-semibold text-brand-600 hover:text-brand-700">privacy policy</Link>.
            </span>
          </label>
          <button
            type="submit"
            disabled={loading || !form.consent}
            className="h-11 w-full rounded-xl bg-brand-600 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-600">
          Already registered?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function Labeled({
  name,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium text-ink-700">
      {label}
      <input
        name={name}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500"
        placeholder={placeholder}
      />
    </label>
  );
}