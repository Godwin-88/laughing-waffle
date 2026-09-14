import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { lessons, transcodeJobs, users, videoAssets } from "../../db/schema";
import { emitAnalyticsEvent } from "../../lib/events";
import { getStorage, hlsPrefixFor } from "../../storage/storage";
import { getMailer } from "../../mail/mailer";

const execFileAsync = promisify(execFile);

const VARIANT_RENDITIONS = [
  { name: "360p", width: 640, height: 360, bitrateK: 800 },
  { name: "720p", width: 1280, height: 720, bitrateK: 2800 },
  { name: "1080p", width: 1920, height: 1080, bitrateK: 5000 },
] as const;

function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary path");
  return ffmpegPath;
}

interface ProbeResult {
  durationSeconds: number;
  width: number;
  height: number;
}

async function probeMedia(filePath: string): Promise<ProbeResult> {
  try {
    await execFileAsync(ffmpegBin(), ["-i", filePath]);
    throw new Error("ffmpeg -i succeeded (unexpected)");
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const stderr = err?.stderr ?? err?.message ?? "";
    const durationMatch = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    const videoMatch = /Stream.*Video:.*\s(\d{3,5})x(\d{3,5})/.exec(stderr);
    const durationSeconds = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : 0;
    const width = videoMatch ? Number(videoMatch[1]) : 1280;
    const height = videoMatch ? Number(videoMatch[2]) : 720;
    if (durationSeconds <= 0) {
      throw new Error(`Could not probe media duration:\\n${stderr.slice(0, 400)}`);
    }
    return { durationSeconds, width, height };
  }
}

/**
 * Transcode one source into HLS VOD with a three-rung ladder
 * (360p/720p/1080p) plus a master playlist (US-4.1.2).
 */
async function transcodeToHls(sourcePath: string, outDir: string) {
  const { width, height } = await probeMedia(sourcePath);
  const rungs = VARIANT_RENDITIONS.filter((v) => v.height <= height);
  if (rungs.length === 0) rungs.push(VARIANT_RENDITIONS[0]);

  const masterLines: string[] = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const rung of rungs) {
    const variantDir = path.join(outDir, rung.name);
    const segDir = path.join(variantDir, "segments");
    await fs.mkdir(segDir, { recursive: true });
    const variantPlaylist = path.join(variantDir, "index.m3u8");
    await execFileAsync(ffmpegBin(), [
      "-y",
      "-i", sourcePath,
      "-vf", `scale=w=${rung.width}:h=${rung.height}:force_original_aspect_ratio=decrease`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-profile:v", "main",
      "-crf", "23",
      "-maxrate", `${rung.bitrateK}k`,
      "-bufsize", `${rung.bitrateK * 2}k`,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      "-hls_time", "6",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(segDir, "seg_%04d.ts"),
      variantPlaylist,
    ]);
    masterLines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rung.bitrateK * 1000},RESOLUTION=${rung.width}x${rung.height}`,
      `${rung.name}/index.m3u8`,
    );
  }

  await fs.writeFile(path.join(outDir, "index.m3u8"), masterLines.join("\n") + "\n", "utf8");
}

async function uploadDirToStorage(localDir: string, storagePrefix: string) {
  const storage = getStorage();
  async function walk(dir: string, rel = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, nextRel);
      } else {
        const data = await fs.readFile(full);
        const key = storagePrefix + "/" + nextRel;
        await storage.putObject(key, data, "application/octet-stream", "course-assets");
      }
    }
  }
  await walk(localDir);
}

/**
 * Queue a transcode job for a completed upload. Idempotent: a queued/processing
 * job already exists → no-op.
 */
export async function queueTranscodeForAsset(assetId: string): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const existing = await db
    .select({ id: transcodeJobs.id })
    .from(transcodeJobs)
    .where(and(eq(transcodeJobs.assetId, assetId), eq(transcodeJobs.state, "queued")))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(transcodeJobs).values({ assetId, state: "queued", attempts: 0 });
}

async function markJobFailed(jobId: string, assetId: string, lessonId: string, message: string) {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.transaction(async (tx) => {
    await tx
      .update(transcodeJobs)
      .set({ state: "failed", error: message, finishedAt: new Date() })
      .where(eq(transcodeJobs.id, jobId));
    await tx
      .update(videoAssets)
      .set({ status: "failed", error: message })
      .where(eq(videoAssets.id, assetId));
  });
  await db.update(lessons).set({ videoStatus: "failed" }).where(eq(lessons.id, lessonId));

  emitAnalyticsEvent({
    eventName: "video_transcode_failed",
    courseId: null,
    lessonId,
    payload: { assetId, error: message },
  });
}

/** Pick the oldest queued job and process it end-to-end (used by the worker). */
export async function processNextTranscodeJob(): Promise<boolean> {
  const env = loadEnv();
  const { db } = getDb(env.DATABASE_URL);

  const [job] = await db
    .select()
    .from(transcodeJobs)
    .where(eq(transcodeJobs.state, "queued"))
    .orderBy(transcodeJobs.createdAt)
    .limit(1);
  if (!job) return false;

  const [asset] = await db
    .select()
    .from(videoAssets)
    .where(eq(videoAssets.id, job.assetId))
    .limit(1);
  if (!asset) {
    await db
      .update(transcodeJobs)
      .set({ state: "failed", error: "asset missing" })
      .where(eq(transcodeJobs.id, job.id));
    return true;
  }

  await db
    .update(transcodeJobs)
    .set({ state: "processing", startedAt: new Date(), attempts: job.attempts + 1 })
    .where(eq(transcodeJobs.id, job.id));

  const storage = getStorage();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "takwimu-transcode-"));
  try {
    const sourcePath = path.join(workDir, "source.mp4");
    const source = await storage.readObject(asset.sourceKey, "course-assets");
    if (!source) throw new Error("source object missing from storage");
    await fs.writeFile(sourcePath, source.data);

    const { durationSeconds } = await probeMedia(sourcePath);
    await transcodeToHls(sourcePath, path.join(workDir, "hls"));
    const prefix = hlsPrefixFor(asset.courseId, asset.lessonId);
    await uploadDirToStorage(path.join(workDir, "hls"), prefix);

    await db.transaction(async (tx) => {
      await tx
        .update(videoAssets)
        .set({ status: "ready", hlsPrefix: prefix, durationSeconds, error: null })
        .where(eq(videoAssets.id, asset.id));
      await tx
        .update(transcodeJobs)
        .set({ state: "done", error: null, finishedAt: new Date() })
        .where(eq(transcodeJobs.id, job.id));
    });
    await db
      .update(lessons)
      .set({ videoStatus: "ready", hlsPrefix: prefix, videoDurationSeconds: durationSeconds })
      .where(eq(lessons.id, asset.lessonId));

    emitAnalyticsEvent({
      eventName: "video_transcoded",
      userId: asset.userId,
      courseId: asset.courseId,
      lessonId: asset.lessonId,
      payload: { assetId: asset.id, durationSeconds, ladders: VARIANT_RENDITIONS.map((v) => v.height) },
    });

    const [instructor] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, asset.userId))
      .limit(1);
    if (instructor) {
      const [lesson] = await db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.id, asset.lessonId))
        .limit(1);
      void getMailer()
        .sendEmail({
          to: instructor.email,
          subject: "Your lesson video is ready",
          text: `Hi ${instructor.firstName},\n\nYour video is ready to play. You can preview it in the course builder.\n\nLesson: ${lesson?.title ?? asset.sourceFilename}\n`,
          html: `<h2>Takwimu Data School</h2><p>Hi ${instructor.firstName},</p><p>Your video for <strong>${lesson?.title ?? asset.sourceFilename}</strong> has finished transcoding and is ready to play.</p>`,
        })
        .catch(() => undefined);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    await markJobFailed(job.id, asset.id, asset.lessonId, message);
    const [instructor] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, asset.userId))
      .limit(1);
    if (instructor) {
      void getMailer()
        .sendEmail({
          to: instructor.email,
          subject: "A video transcode failed",
          text: `Hi ${instructor.firstName},\n\nWe could not transcode "${asset.sourceFilename}".\n\nError: ${message}`,
        })
        .catch(() => undefined);
    }
    return true;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/** Poll for queued jobs; overlap-guarded (US-4.1.2 background worker). */
export function startTranscodeWorker(intervalMs = 5_000): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processNextTranscodeJob();
    } catch (error) {
      console.error("[transcode] worker tick error:", error);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, intervalMs);
}
