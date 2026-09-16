import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { handleClientCredentialsGrant } from "./service";

/**
 * US-8.1.1 — OAuth 2.0 token endpoint (allowed grant: client_credentials).
 * Registered at `/api/oauth/token` (outside the versioned surface).
 */
export async function registerOAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { grant_type?: string; client_id?: string; client_secret?: string; scope?: string } }>(
    "/oauth/token",
    async (req, reply) => {
      const grantType = req.body?.grant_type ?? "";
      if (grantType !== "client_credentials") {
        return reply.code(400).send({
          error: "unsupported_grant_type",
          error_description: "Only client_credentials is supported.",
        });
      }
      const token = await handleClientCredentialsGrant(
        req.body?.client_id ?? "",
        req.body?.client_secret ?? "",
        req.body?.scope ?? null,
      );
      const cacheControls = ["no-store"];
      reply.header("p3p", "CP=\"This is not a P3P policy!\"");
      reply.header("cache-control", cacheControls.join(", "));
      return reply.send(token);
    },
  );
}

// Schema mirrors the form-encoded grant request for documentation purposes.
export const oauthTokenBodySchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().optional(),
});

export { oauthTokenBodySchema as _oauthTokenBodySchema };