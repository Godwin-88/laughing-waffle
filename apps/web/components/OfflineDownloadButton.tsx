"use client";

import { useEffect, useState } from "react";
import type { OfflineDownloadRow } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { offlineApi } from "@/lib/api";

/**
 * Sprint 10 — Offline lesson downloads (US-3.1.2).
 * Enrolled learners bind a download to the current device (a client-side
 * device id). The API encrypts the lesson bundle with AES-256-GCM and wraps
 * the content key for that device. This button creates the download, then
 * hands over the signed file URL once the bundle is ready.
 */
export function OfflineDownloadButton({ lessonId }: { lessonId: string }) {
  const { user } = useAuth();
  const [deviceId, setDeviceId] = useState<string>("");
  const [download, setDownload] = useState<OfflineDownloadRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stored = "";
    try {
      stored = localStorage.getItem("takwimu_device_id") ?? "";
    } catch {
      /* localStorage unavailable */
    }
    if (!stored) {
      stored = crypto.randomUUID();
      try {
        localStorage.setItem("takwimu_device_id", stored);
      } catch {
        /* keep ephemeral */
      }
    }
    setDeviceId(stored);
    void offlineApi
      .mine()
      .then((res) => {
        const existing = res.items.find((d) => d.lessonId === lessonId);
        if (existing) setDownload(existing);
      })
      .catch(() => {
        /* not signed in or feature disabled — leave quiet */
      });
  }, [lessonId]);

  if (!user) return null;

  async function start() {
    if (!deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await offlineApi.create({ lessonId, deviceId });
      setDownload(created.download);
      if (created.download.status !== "ready" && created.download.status !== "failed") {
        // Poll briefly; the queue is synchronous in dev so a ready row appears fast.
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const fresh = await offlineApi.get(created.download.id);
          setDownload(fresh);
          if (fresh.status === "ready" || fresh.status === "failed" || fresh.status === "expired") break;
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create an offline download. Enrolled learners only.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await offlineApi.cancel(id);
      setDownload(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
    }
  }

  if (download && download.status === "ready" && download.fileUrl) {
    return (
      <div className="rounded-2xl border border-green-300 bg-green-50 p-4 shadow-sm">
        <p className="text-sm font-semibold text-green-900">Offline copy ready</p>
        <p className="mt-1 text-xs text-green-800">
          {download.lessonTitle} · {(download.sizeBytes / 1024).toFixed(1)} KB · expires{" "}
          {new Date(download.expiresAt).toLocaleDateString()} — bound to this device.
        </p>
        <a
          href={download.fileUrl}
          download
          className="mt-2 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Download encrypted bundle
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-ink-900">Offline viewing</p>
      <p className="mt-1 text-xs text-ink-600">
        {download
          ? `Status: ${download.status} (${download.progress}%)`
          : "Available to enrolled learners. Bundles expire after 30 days or when your enrolment does."}
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      {download && (download.status === "failed" || download.status === "expired") ? (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void cancel(download.id);
          }}
          className="mt-1 inline-block text-xs text-red-700 hover:underline"
        >
          Clear failed download
        </a>
      ) : null}
      {!download ? (
        <button
          onClick={() => void start()}
          disabled={busy || !deviceId}
          className="mt-2 rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {busy ? "Preparing…" : "Download for offline"}
        </button>
      ) : null}
    </div>
  );
}