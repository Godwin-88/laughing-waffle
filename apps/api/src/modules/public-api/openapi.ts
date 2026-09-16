import type { FastifyInstance } from "fastify";
import { loadEnv } from "../../config/env";
import { PUBLIC_FIELDS } from "./routes";

/**
 * US-8.1.1 — "OpenAPI 3.1 spec auto-generated and published at /api/docs".
 * The spec is synthesised from the same query schema + field whitelist used by
 * the public routes so the document cannot drift from the implementation.
 */

function jwsSchema() {
  return {
    type: "object",
    properties: {
      access_token: { type: "string", description: "HS256 M2M bearer token (aud=takwimu:public-api)." },
      token_type: { type: "string", enum: ["Bearer"] },
      expires_in: { type: "integer", description: "Seconds until the token expires." },
      scope: { type: "string" },
    },
    required: ["access_token", "token_type", "expires_in", "scope"],
  };
}

export function buildOpenApiSpec(publicUrl: string): Record<string, unknown> {
  const fieldsSchema = {
    type: "string",
    description: `Comma-separated subset of: ${PUBLIC_FIELDS.join(", ")}`,
  };
  const base = publicUrl.replace(/\/$/, "");
  return {
    openapi: "3.1.0",
    info: {
      title: "Takwimu Data School — External Course Catalogue API",
      version: "1.0.0",
      description:
        "Machine-to-machine catalogue access (US-8.1.1). Authenticate with OAuth 2.0 client credentials at /api/oauth/token, then call the protected catalogue endpoints with the Bearer token. API v1 is versioned in the path and supported a minimum of 12 months after v2 launches. Each client is rate limited to 1,000 requests/hour (HTTP 429 + Retry-After on breach).",
    },
    servers: [{ url: base }],
    security: [{ oauth2ClientCredentials: [] }],
    components: {
      securitySchemes: {
        oauth2ClientCredentials: {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: `${base}/api/oauth/token`,
              scopes: { "catalogue:read": "Read the public course catalogue." },
            },
          },
        },
      },
    },
    paths: {
      "/api/oauth/token": {
        post: {
          summary: "Exchange client credentials for a Bearer token",
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  properties: {
                    grant_type: { type: "string", enum: ["client_credentials"] },
                    client_id: { type: "string" },
                    client_secret: { type: "string", format: "password" },
                    scope: { type: "string", default: "catalogue:read" },
                  },
                  required: ["grant_type", "client_id", "client_secret"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Token issued.", content: { "application/json": { schema: jwsSchema() } } },
            "400": { description: "Unsupported grant / invalid scope." },
            "401": { description: "Bad client credentials." },
          },
        },
      },
      "/api/v1/public/courses": {
        get: {
          summary: "List published courses",
          description:
            "Filtered, paginated catalogue. Ordering, facets and field selection supported.",
          parameters: [
            { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
            { name: "categories", in: "query", schema: { type: "string" }, description: "Comma-separated category values." },
            { name: "levels", in: "query", schema: { type: "string" }, description: "beginner|intermediate|advanced (csv)." },
            { name: "durations", in: "query", schema: { type: "string" }, description: "1-4|5-8|9-12|13+ (csv)." },
            { name: "price", in: "query", schema: { type: "string", enum: ["free", "paid", "all"] }, description: "Default all." },
            { name: "languages", in: "query", schema: { type: "string" } },
            { name: "ratingMin", in: "query", schema: { type: "number", minimum: 0, maximum: 5 } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["rating", "newest", "price_asc", "price_desc", "relevance"] } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 60, default: 12 } },
            { name: "fields", in: "query", schema: fieldsSchema },
          ],
          responses: {
            "200": { description: "Catalogue page (+ facets)." },
            "401": { description: "Missing/invalid token." },
            "403": { description: "Insufficient scope." },
            "429": {
              description: "Rate limit exceeded. Retry after the Retry-After header.",
              headers: { "Retry-After": { schema: { type: "integer" } } },
            },
          },
        },
      },
      "/api/v1/public/courses/{slug}": {
        get: {
          summary: "Fetch a single published course",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "fields", in: "query", schema: fieldsSchema },
          ],
          responses: {
            "200": { description: "Course detail (syllabus omitted from the public surface)." },
            "404": { description: "Unknown or unpublished course." },
            "429": { description: "Rate limit exceeded." },
          },
        },
      },
      "/api/docs.json": {
        get: { summary: "This OpenAPI 3.1 document (JSON)" },
      },
    },
  };
}

export function registerDocsRoutes(app: FastifyInstance) {
  app.get("/docs.json", async () => buildOpenApiSpec(loadEnv().PUBLIC_API_URL));

  app.get("/docs", async (_req, reply) => {
    const spec = buildOpenApiSpec(loadEnv().PUBLIC_API_URL);
    const rows: string[] = [];
    const specPaths = spec.paths as Record<string, Record<string, unknown>>;
    for (const [p, methodsObj] of Object.entries(specPaths)) {
      const verbs = Object.keys(methodsObj).join(", ").toUpperCase();
      rows.push(`<tr><td class="mono">${p}</td><td>${verbs}</td></tr>`);
    }
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Takwimu API — OpenAPI 3.1</title>
<style>
body{font-family:"Raleway",system-ui,sans-serif;margin:2rem auto;max-width:860px;color:#1a1a2e;line-height:1.55;padding:0 1rem}
h1{font-weight:800}code,.mono{font-family:ui-monospace,monospace;font-size:.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:.5rem .75rem;text-align:left}
th{background:#f1f5f9}.pill{display:inline-block;background:#e8f0fe;border-radius:999px;padding:.1rem .6rem;font-size:.8em}
a{color:#2563eb}pre{background:#0f172a;color:#e2e8f0;padding:1rem;overflow:auto;border-radius:.75rem}
</style></head><body>
<h1>Takwimu Data School — API</h1>
<p>OpenAPI 3.1 document, auto-generated from the route schema. <a href="/api/docs.json">Download <code>docs.json</code></a>.</p>
<table><thead><tr><th>Path</th><th>Methods</th></tr></thead><tbody>${rows.join("")}</tbody></table>
<h2>Authenticate</h2>
<pre>POST /api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&amp;client_id=…&amp;client_secret=…</pre>
<p>Then call <span class="pill">catalogue:read</span> endpoints with <code>Authorization: Bearer &lt;access_token&gt;</code>.</p>
</body></html>`.trim();
    return reply.type("text/html").send(html);
  });
}
