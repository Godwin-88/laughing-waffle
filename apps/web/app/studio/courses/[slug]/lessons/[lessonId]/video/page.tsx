"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { VideoAssetStatus } from "@takwimu/shared";
import { useAuth } from "@/lib/auth-context";
import { videoApi } from "@/lib/api";

/** US-4.1.2 — chunked video upload + transcode status. */
export default function VideoUploadPage() {
  const params = useParams<{ slug: string; lessonId: string }>();
  const { slug, lessonId } = params;
  const { user, loading } = useAuth();
  const [assetId, setAssetId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"idle" | "splitting" | "uploading" | "transcoding" | "ready" | "failed">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    let t: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const s = await videoApi.status(assetId);
        if (cancelled) return;
        if (s.status === "queued" || s.status === "uploading") setPhase("transcoding");
        else if (s.status === "ready") {
          setPhase("ready");
          if (t) clearInterval(t);
        } else if (s.status === "failed") {
          setPhase("failed");
          setErrorMsg(s.error ?? "Transcoding failed.");
          if (t) clearInterval(t);
        }
      } catch {
        /* keep polling */
      }
    };
    void poll();
    t = setInterval(poll, 4_000);
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [assetId]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;

  const onFile = async (file: File) => {
    setErrorMsg(null);
    setProgress(0);
    const allowedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo"];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|mkv|avi)$/i)) {
      setErrorMsg("Unsupported file type. Use MP4, WebM, MOV, MKV or AVI.");
      return;
    }
    if (file.size > 10 * 1024 * 1024 * 1024) {
      setErrorMsg("Maximum upload size is 10 GB.");
      return;
    }

    setPhase("splitting");
    try {
      const session = await videoApi.startUpload(lessonId, file.name, file.type || "video/mp4", file.size);
      setAssetId(session.assetId);
      setPhase("uploading");

      const PART = session.partSizeBytes;
      for (let i = 1; i <= session.partCount; i++) {
        const start = (i - 1) * PART;
        const end = Math.min(start + PART, file.size);
        const slice = file.slice(start, end);
        await videoApi.uploadPart(session, i, slice);
        setProgress(Math.min(99, Math.round((i / session.partCount) * 97)));
      }

      const status: VideoAssetStatus = await videoApi.completeUpload(session.assetId);
      setProgress(100);
      setPhase("transcoding");
      void status;
    } catch (err) {
      setPhase("failed");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  const statusLabel =
    phase === "idle"
      ? "Choose a video file to begin."
      : phase === "splitting"
        ? "Preparing upload…"
        : phase === "uploading"
          ? `Uploading… ${progress}%`
          : phase === "transcoding"
            ? "Video uploaded ✓ Transcoding to adaptive HLS…"
            : phase === "ready"
              ? "Video is ready to play. ✓"
              : "Upload failed.";

  return (
    <div className="mx-auto mt-8 max-w-2xl px-4 sm:px-6">
      <nav className="text-sm text-ink-500">
        <Link href={`/studio/courses/${slug}`} className="hover:text-brand-700">← Back to course</Link>
      </nav>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900">Upload lesson video</h1>
      <p className="mt-1 text-sm text-ink-500">
        VOD upload · chunked in 5&nbsp;MB parts · auto-transcoded into 360p / 720p / 1080p adaptive HLS.
      </p>

      <div
        className="mt-6 flex h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-300 bg-ink-50 p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void onFile(file);
        }}
      >
        {phase === "idle" || phase === "failed" ? (
          <>
            <p className="text-sm text-ink-600">MP4 / WebM / MOV</p>
            <label className="mt-3 cursor-pointer rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
              {phase === "failed" ? "Try again" : "Choose file"}
              <input type="file" accept="video/*,.mp4,.webm,.mov,.mkv,.avi" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }} />
            </label>
          </>
        ) : (
          <div className="w-full max-w-sm">
            <p className="text-sm font-semibold text-ink-800">{statusLabel}</p>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-ink-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${phase === "ready" ? 100 : progress}%` }}
              />
            </div>
            {phase === "transcoding" || phase === "uploading" ? (
              <p className="mt-2 text-xs text-ink-400">You can leave this page — we&apos;ll email you when it&apos;s ready.</p>
            ) : null}
            {phase === "ready" ? (
              <Link href={`/studio/courses/${slug}`} className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
                Back to course →
              </Link>
            ) : null}
          </div>
        )}
        {errorMsg && phase === "failed" ? <p className="mt-3 max-w-sm text-sm text-red-600">{errorMsg}</p> : null}
      </div>
    </div>
  );
}