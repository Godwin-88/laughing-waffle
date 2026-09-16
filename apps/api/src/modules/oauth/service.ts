import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import type { ApiClientListResponse, ApiClientRow, OAuthTokenResponse } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { oauthClients } from "../../db/schema";
import { badRequest, unauthorized } from "../../lib/errors";

// ─────────────────────────────────────────────────────────────
// US-8.1.1 — OAuth 2.0 client credentials for machine-to-machine
// access to the external course catalogue API.
// ─────────────────────────────────────────────────────────────

export const M2M_AUDIENCE = "takwimu:public-api";
export const M2M_TTL_SECONDS = 3600;
export const DEFAULT_SCOPES = "catalogue:read";

export interface M2mClaims {
  clientId: string;
  scope: string;
  iat: number;
  exp: number;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateClientId(): string {
  return randomBytes(12).toString("hex");
}

/** Sign a machine-to-machine access token (HS256; bound to the API audience). */
export async function issueClientToken(
  clientId: string,
  scope: string,
  ttlSeconds = M2M_TTL_SECONDS,
): Promise<string> {
  const env = loadEnv();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope, aud: M2M_AUDIENCE, jwtType: "m2m" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}

export async function verifyM2mToken(token: string): Promise<M2mClaims> {
  const env = loadEnv();
  const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), {
    algorithms: ["HS256"],
  });
  if (payload.aud !== M2M_AUDIENCE || typeof payload.sub !== "string") {
    throw new Error("invalid_m2m_token");
  }
  return {
    clientId: payload.sub,
    scope: typeof payload.scope === "string" ? payload.scope : DEFAULT_SCOPES,
    iat: typeof payload.iat === "number" ? payload.iat : 0,
    exp: typeof payload.exp === "number" ? payload.exp : 0,
  };
}

export async function handleClientCredentialsGrant(
  clientId: string,
  clientSecret: string,
  requestedScope: string | null,
): Promise<OAuthTokenResponse> {
  if (!clientId || !clientSecret) {
    throw badRequest("client_id and client_secret are required.", "invalid_client");
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!client || client.status !== "active") {
    throw unauthorized("Unknown or revoked OAuth client.", "invalid_client");
  }
  const given = hashSecret(clientSecret);
  const expected = client.clientSecretHash.replace(/^sha256:/, "");
  if (given !== expected) {
    throw unauthorized("Invalid client credentials.", "invalid_client");
  }
  if (requestedScope) {
    const allowed = client.scopes.split(",").map((s) => s.trim()).filter(Boolean);
    const asked = requestedScope.split(" ").map((s) => s.trim()).filter(Boolean);
    if (asked.some((scope) => !allowed.includes(scope))) {
      throw badRequest("Requested scope is not granted to this client.", "invalid_scope");
    }
  }
  await db.update(oauthClients).set({ lastUsedAt: new Date() }).where(eq(oauthClients.id, client.id));
  const scope = requestedScope?.trim() || client.scopes;
  return {
    access_token: await issueClientToken(client.clientId, scope),
    token_type: "Bearer",
    expires_in: M2M_TTL_SECONDS,
    scope,
  };
}
// ── Admin management ─────────────────────────────────────────

function toRow(row: typeof oauthClients.$inferSelect): ApiClientRow {
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    scopes: row.scopes,
    status: row.status === "revoked" ? "revoked" : "active",
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApiClients(): Promise<ApiClientListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(oauthClients).orderBy(oauthClients.createdAt);
  return { items: rows.map(toRow), total: rows.length };
}

export async function createApiClient(input: {
  name: string;
  scopes?: string;
  createdBy: string;
}): Promise<{ client: ApiClientRow; clientSecret: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const clientId = generateClientId();
  const clientSecret = randomBytes(32).toString("base64url");
  const scopes = (input.scopes?.trim() || DEFAULT_SCOPES)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  const [row] = await db
    .insert(oauthClients)
    .values({
      name: input.name,
      clientId,
      clientSecretHash: `sha256:${hashSecret(clientSecret)}`,
      scopes,
      createdBy: input.createdBy,
    })
    .returning();
  return { client: toRow(row), clientSecret };
}

export async function rotateApiClientSecret(clientId: string): Promise<{ clientSecret: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!client) throw badRequest("Unknown OAuth client.", "invalid_client");
  const clientSecret = randomBytes(32).toString("base64url");
  await db
    .update(oauthClients)
    .set({ clientSecretHash: `sha256:${hashSecret(clientSecret)}` })
    .where(eq(oauthClients.id, client.id));
  return { clientSecret };
}

export async function revokeApiClient(clientId: string): Promise<{ ok: true }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.update(oauthClients).set({ status: "revoked" }).where(eq(oauthClients.clientId, clientId));
  return { ok: true };
}