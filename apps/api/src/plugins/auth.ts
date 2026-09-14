import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { loadEnv } from "../config/env";
import { unauthorized } from "../lib/errors";
import { verifyAccessToken } from "../lib/tokens";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    userRole: string;
  }
}

/**
 * Bearer-token authentication hook. Verifies the JWT signature/expiry via
 * `jose`, checks the account is still active, and attaches `req.userId`.
 * Attach per-route with `{ preHandler: [app.authenticate] }`.
 */
function authenticatePlugin(app: FastifyInstance) {
  app.decorate("authenticate", async function authenticate(
    this: FastifyInstance,
    req: FastifyRequest,
    _reply: import("fastify").FastifyReply,
  ) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized("Authentication required.");
    }
    const env = loadEnv();
    let claims;
    try {
      claims = await verifyAccessToken(env.JWT_SECRET, header.slice(7));
    } catch {
      throw unauthorized("Session expired. Please sign in again.");
    }
    if (claims.exp < Math.floor(Date.now() / 1000)) {
      throw unauthorized("Session expired. Please sign in again.");
    }

    const { db } = getDb(env.DATABASE_URL);
    const rows = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, claims.sub)).limit(1);
    if (rows.length === 0 || rows[0].status !== "active") {
      throw unauthorized("This account is no longer active.");
    }
    req.userId = rows[0].id;
    req.userRole = claims.role;
  });
}

export default fp(authenticatePlugin, { name: "takwimu-auth" });