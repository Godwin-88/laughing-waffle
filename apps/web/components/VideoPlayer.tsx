"use client";

import { useEffect, useRef, useState } from "react";
import type { LessonPublic } from "@takwimu/shared";
import { progressApi } from "@/lib/api";

interface VideoPlayerProps {
  lesson: LessonPublic;
  courseSlug: string;
  className?: string;
}

const SAVE_INTERVAL_MS = 5_000;

/**
 * US-3.1.1 — adaptive HLS player. Uses hls.js for browsers without native HLS,
 * resumes at the saved playback position, and persists progress on an interval
 * (position + auto-complete at 95 % duration — enforced server-side too).
 */
export function VideoPlayer({ lesson, courseSlug, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [status, setStatus] = useState(lesson.video?.status ?? "none");

  useEffect(() => {
    const video = videoRef.current;
    const info = lesson.video;
    if (!video || !info || !info.hlsManifestUrl) return;

    let disposed = false;
    const start = async () => {
      if (typeof window !== "undefined" && (window as unknown as { Hls?: unknown }).Hls) {
        // Safari / native HLS
        video.src = info.hlsManifestUrl!;
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (disposed || !video) return;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
      });
      hlsRef.current = hls;
      hls.loadSource(info.hlsManifestUrl!);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!disposed) void video.play().catch(() => undefined);
      });
    };
    void start();

    const resume = () => {
      if (info.savedPositionMs && info.savedPositionMs > 3_000) {
        video.currentTime = info.savedPositionMs / 1000;
      }
    };
    video.addEventListener("loadedmetadata", resume);

    let lastSeen = 0;
    const interval = setInterval(() => {
      if (!video || Number.isNaN(video.currentTime)) return;
      const pos = Math.floor(video.currentTime * 1000);
      if (Math.abs(pos - lastSeen) < 500) return;
      lastSeen = pos;
      void progressApi
        .save(courseSlug, lesson.id, pos)
        .then((r) => setStatus(r.completed ? "ready" : (lesson.video?.status ?? "none")))
        .catch(() => undefined);
    }, SAVE_INTERVAL_MS);

    const onEnded = () => {
      void progressApi
        .complete(courseSlug, lesson.id)
        .then(() => setStatus("ready"))
        .catch(() => undefined);
    };
    video.addEventListener("ended", onEnded);

    return () => {
      disposed = true;
      clearInterval(interval);
      video.removeEventListener("loadedmetadata", resume);
      video.removeEventListener("ended", onEnded);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [lesson.id, lesson.video, courseSlug]);

  const info = lesson.video;

  if (!info) return null;

  if (info.status === "failed") {
    return (
      <div className={`rounded-2xl border border-red-200 bg-red-50 p-8 text-center ${className ?? ""}`}>
        <p className="font-semibold text-red-700">This video failed to process.</p>
        {info.error ? <p className="mt-1 text-sm text-red-600">{info.error}</p> : null}
      </div>
    );
  }

  if (info.status !== "ready") {
    const label =
      info.status === "uploading"
        ? "Upload in progress…"
        : info.status === "queued"
          ? "Video queued for transcoding…"
          : info.status === "transcoding"
            ? "Video is being transcoded into adaptive streams…"
            : "Video is being prepared…";
    return (
      <div className={`grid aspect-video place-items-center rounded-2xl border border-ink-200 bg-ink-900 ${className ?? ""}`}>
        <div className="px-6 text-center">
          {info.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.posterUrl} alt="Video poster" className="mb-3 h-40 w-full rounded-xl object-cover opacity-60" />
          ) : null}
          <p className="font-semibold text-white">{label}</p>
          <p className="mt-1 text-sm text-ink-300">
            {info.status === "uploading" || info.status === "queued"
              ? "You'll be able to watch as soon as the adaptive streams are ready."
              : "This usually takes a few minutes."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-ink-200 bg-black ${className ?? ""}`}>
      <video
        ref={videoRef}
        className="aspect-video w-full"
        controls
        playsInline
        poster={info.posterUrl ?? undefined}
        crossOrigin="anonymous"
      >
        {info.captionsUrl ? <track kind="captions" src={info.captionsUrl} srcLang="en" label="English" default /> : null}
      </video>
    </div>
  );
}