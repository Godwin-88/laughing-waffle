import { buildApp } from "./app";
import { loadEnv } from "./config/env";
import { closeDb } from "./db/client";
import { startTranscodeWorker } from "./modules/video/transcode";

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });

  // US-4.1.2 background FFmpeg transcode worker (poll for queued jobs).
  const transcodeTimer =
    env.TRANSCODE_WORKER === "on" ? startTranscodeWorker(5_000) : null;
  if (transcodeTimer) app.log.info("[transcode] worker started (poll 5s)");

  const shutdown = async (signal: string) => {
    app.log.info(`shutting down (${signal})…`);
    if (transcodeTimer) clearInterval(transcodeTimer);
    try {
      await app.close();
    } finally {
      closeDb();
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const port = env.API_PORT;
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Takwimu LMS API listening on ${env.PUBLIC_API_URL} (storage: ${env.STORAGE_DRIVER})`);
}

main().catch(async (err) => {
  console.error("fatal:", err);
  closeDb();
  process.exit(1);
});