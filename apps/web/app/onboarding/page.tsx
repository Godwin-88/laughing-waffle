"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { INTEREST_OPTIONS } from "@takwimu/shared";
import { ApiClientError, profileApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const STEP_NO = [1, 2, 3];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [step, setStep] = useState(1);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;

  const apply = (formData: FormData) => {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of formData.entries()) {
      if (k === "interests") {
        const list = (fields.interests as string[] | undefined) ?? [];
        list.push(String(v));
        fields.interests = list;
      } else {
        fields[k] = v;
      }
    }
    return fields;
  };

  const proceed = async () => {
    const fields = apply(new FormData(document.forms[0]));
    if (step === 1 && (!fields.firstName || !fields.lastName)) return setInvalid("Please fill in both your names.");
    if (step === 2 && !fields.interests) return setInvalid("Pick at least one interest.");
    if (step === 3 && !fields.experienceLevel) return setInvalid("Choose a level.");
    setBusy(true);
    setInvalid(null);
    try {
      await profileApi.wizardStep(step as 1 | 2 | 3, fields);
      if (step >= 3) {
        window.location.href = "/dashboard";
        return;
      }
      setStep(step + 1);
      void refresh();
    } catch (err) {
      setInvalid(err instanceof ApiClientError ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="mb-6 flex items-center gap-2">
        {STEP_NO.map((s) => (
          <span key={s} className={`h-2 flex-1 rounded-full ${s <= step ? "bg-brand-600" : "bg-ink-200"}`} />
        ))}
        <span className="ml-2 text-xs font-semibold text-brand-700">{step}/3</span>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-7">
        {step === 1 ? (
          <>
            <h1 className="text-xl font-extrabold text-ink-900">Your name</h1>
            <p className="mt-1 text-sm text-ink-500">Step 1 of 3 — how we&apos;ll address you.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <input defaultValue={user.firstName} name="firstName" placeholder="First name" className="h-11 rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500" />
              <input defaultValue={user.lastName} name="lastName" placeholder="Last name" className="h-11 rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500" />
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h1 className="text-xl font-extrabold text-ink-900">What drives you?</h1>
            <p className="mt-1 text-sm text-ink-500">Step 2 of 3 — choose all that apply.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((opt) => (
                <label key={opt.value} className={`flex cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${user.interests.includes(opt.value) ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"}`}>
                  <input type="checkbox" name="interests" value={opt.value} defaultChecked={user.interests.includes(opt.value)} className="h-4 w-4 accent-brand-600" />
                  {opt.label}
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold text-ink-900">Your starting level</h1>
            <p className="mt-1 text-sm text-ink-500">Step 3 of 3 — helps us recommend courses.</p>
            <div className="mt-5 flex flex-col gap-2">
              {["beginner", "intermediate", "advanced"].map((lv) => (
                <label key={lv} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${user.experienceLevel === lv ? "border-brand-600 bg-brand-50 text-brand-800" : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"}`}>
                  <input type="radio" name="experienceLevel" value={lv} defaultChecked={user.experienceLevel === lv} className="accent-brand-600" />
                  {lv[0].toUpperCase() + lv.slice(1)}
                </label>
              ))}
            </div>
          </>
        )}

        {invalid ? <div className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{invalid}</div> : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void proceed()}
          className="mt-4 h-11 w-full rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : step >= 3 ? "Finish & go to dashboard →" : "Continue →"}
        </button>
      </div>

      <p className="mt-4 text-center text-sm text-ink-500">
        Want to skip?{" "}
        <Link href="/dashboard" className="font-semibold text-brand-600 hover:text-brand-700">
          Head to the dashboard
        </Link>
      </p>
    </div>
  );
}