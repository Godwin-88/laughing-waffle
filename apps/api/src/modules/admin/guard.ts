import type { FastifyInstance } from "fastify";
import { loadEnv } from "../../config/env";
import { verifyAccessToken } from "../../lib/tokens";
import { getConfig } from "../../lib/config";

/**
 * US-7.1.2 maintenance mode. Installed as a global onRequest hook on the
 * /api/v1 tree: when maintenance is enabled, every request is blocked with a
 * 503 EXCEPT signed-in administrators and the public health/auth bootstrap
 * (so an admin can still log in and disable the flag). Reads go through the
 * 60s config cache, so a toggle propagates within the acceptance window.
 */
export function installMaintenanceGuard(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const url = req.raw.url ?? "";
    if (!url.startsWith("/api/v1")) return;
    if (url.endsWith("/health")) return;
    if (url.includes("/api/v1/auth/")) return; // login/refresh/sso/verify/reset stay reachable

    const cfg = await getConfig();
    if (!cfg.maintenance.enabled) return;

    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        const env = loadEnv();
        const claims = await verifyAccessToken(env.JWT_SECRET, header.slice(7));
        if (claims.role === "admin") return;
      } catch {
        /* fall through to the 503 */
      }
    }

    return reply.status(503).send({
      error: {
        code: "maintenance_mode",
        message: cfg.maintenance.message || "We're carrying out scheduled maintenance. Please check back shortly.",
      },
    });
  });
}