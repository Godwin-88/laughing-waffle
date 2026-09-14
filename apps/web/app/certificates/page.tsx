"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CertificateSummary } from "@takwimu/shared";
import { certificateApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/** US-5.1.2 — my certificates: download, verify, share to LinkedIn. */
export default function CertificatesPage() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<CertificateSummary[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    certificateApi
      .mine()
      .then((res) => setItems(res.items))
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Could not load certificates."));
  }, [user]);

  const onDownload = async (cert: CertificateSummary) => {
    try {
      setDownloading(cert.id);
      await certificateApi.download(cert.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;

  return (
    <div className="mx-auto mt-10 max-w-4xl px-4 sm:px-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Certificates</h1>
        <p className="mt-1 text-sm text-ink-500">
          Verified credentials awarded when you complete every lesson and pass the quizzes in a course.
        </p>
      </header>

      {errorMsg ? <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</p> : null}

      <div className="mt-6 space-y-4">
        {items === null ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-10 text-center">
            <p className="text-lg font-bold text-ink-800">No certificates yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
              Finish all lessons of an enrolled course and pass its graded quizzes, then claim your certificate from
              the course page.
            </p>
            <Link href="/courses" className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
              Find a course →
            </Link>
          </div>
        ) : (
          items.map((cert) => (
            <div key={cert.id} className="rounded-2xl border border-ink-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 place-items-center rounded-xl bg-brand-600 text-2xl text-white">🏅</div>
                  <div>
                    <p className="text-lg font-extrabold text-ink-900">{cert.courseTitle}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {cert.certificateNumber} · issued {new Date(cert.issuedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onDownload(cert)}
                    disabled={downloading === cert.id}
                    className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {downloading === cert.id ? "Downloading…" : "Download PDF"}
                  </button>
                  <a
                    href={cert.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-brand-400"
                  >
                    Add to LinkedIn
                  </a>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
                <span>
                  🔗 <span className="font-semibold">Verify:</span>{" "}
                  <a href={cert.verifyUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700">
                    {cert.verifyUrl.replace(/^https?:\/\//, "")}
                  </a>
                </span>
                <span>👩‍🏫 {cert.instructorName}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}