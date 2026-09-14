"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { CertificateVerificationResponse } from "@takwimu/shared";
import { certificateApi } from "@/lib/api";

/** Public certificate verification — US-5.1.2 (no login required). */
export default function VerifyCertificatePage() {
  const params = useParams<{ certificateNumber: string }>();
  const [result, setResult] = useState<CertificateVerificationResponse | null>(null);
  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");

  useEffect(() => {
    if (!params.certificateNumber) return;
    let cancelled = false;
    certificateApi
      .verify(params.certificateNumber)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setState(res.valid ? "valid" : "invalid");
      })
      .catch(() => {
        if (!cancelled) setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [params.certificateNumber]);

  if (state === "loading") {
    return <div className="p-16 text-center text-ink-500">Verifying certificate…</div>;
  }

  return (
    <div className="mx-auto mt-16 max-w-lg px-4 text-center">
      {state === "valid" && result ? (
        <div className="rounded-2xl border border-green-200 bg-white p-8 shadow-sm">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-100 text-3xl">✓</div>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-green-600">Verified credential</p>
          <h1 className="mt-2 text-2xl font-extrabold text-ink-900">{result.learnerName}</h1>
          <p className="mt-1 font-semibold text-ink-700">{result.courseTitle}</p>
          <p className="mt-3 text-sm text-ink-500">
            awarded by <span className="font-semibold">{result.platformName}</span>
          </p>
          <dl className="mt-6 space-y-2 rounded-xl bg-ink-50 p-4 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Certificate</dt>
              <dd className="font-mono text-xs text-ink-800">{result.certificateNumber}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Issued on</dt>
              <dd className="text-ink-800">{new Date(result.issuedOn).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Instructor</dt>
              <dd className="text-ink-800">{result.instructorName}</dd>
            </div>
          </dl>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
            ← Back to Takwimu Data School
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-100 text-3xl">✕</div>
          <h1 className="mt-4 text-2xl font-extrabold text-ink-900">Certificate not found</h1>
          <p className="mt-2 text-sm text-ink-500">
            This certificate number could not be verified. If you believe this is an error, contact{" "}
            <span className="font-semibold text-ink-700">Takwimu Data School</span> support.
          </p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
            ← Back to Takwimu Data School
          </Link>
        </div>
      )}
    </div>
  );
}