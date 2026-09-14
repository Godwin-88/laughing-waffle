import { buildApp } from "./app";
import { loadEnv } from "./config/env";
import { closeDb } from "./db/client";

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });

  const shutdown = async (signal: string) => {
    app.log.info(`shutting down (${signal})…`);
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