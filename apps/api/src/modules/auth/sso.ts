import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { conflict, serviceUnavailable } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import type { UserRow } from "../../lib/users";

export type SsoProvider = "google" | "microsoft";

export interface OidcProfile {
  sub: string;
  email: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
}

interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface ProviderReady {
  key: SsoProvider;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

const PROVIDER_META: Record<SsoProvider, { discoveryUrl: string; scopes: string }> = {
  google: {
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    scopes: "openid email profile",
  },
  microsoft: {
    discoveryUrl:
      "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    scopes: "openid email profile",
  },
};

const discoveryCache = new Map<SsoProvider, { fetchedAt: number; doc: DiscoveryDoc }>();
const jwksCache: Partial<Record<SsoProvider, ReturnType<typeof createRemoteJWKSet>>> = {};

function getCredentials(env: ReturnType<typeof loadEnv>, provider: SsoProvider): ProviderReady {
  const clientId = provider === "google" ? env.GOOGLE_CLIENT_ID : env.MICROSOFT_CLIENT_ID;
  const clientSecret =
    provider === "google" ? env.GOOGLE_CLIENT_SECRET : env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw serviceUnavailable(
      `${provider === "google" ? "Google" : "Microsoft"} sign-in is not configured yet. Please use email and password.`,
      "sso_not_configured",
    );
  }
  return {
    key: provider,
    clientId,
    clientSecret,
    scopes: PROVIDER_META[provider].scopes,
  };
}

async function getDiscovery(provider: SsoProvider): Promise<DiscoveryDoc> {
  const cached = discoveryCache.get(provider);
  if (cached && Date.now() - cached.fetchedAt < 24 * 3600 * 1000) return cached.doc;

  const res = await fetch(PROVIDER_META[provider].discoveryUrl);
  if (!res.ok) {
    throw serviceUnavailable(
      "Sign-in provider is temporarily unavailable. Please try again shortly.",
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  const doc: DiscoveryDoc = {
    issuer: String(json.issuer),
    authorization_endpoint: String(json.authorization_endpoint),
    token_endpoint: String(json.token_endpoint),
    jwks_uri: String(json.jwks_uri),
  };
  discoveryCache.set(provider, { fetchedAt: Date.now(), doc });
  return doc;
}

function getJwks(provider: SsoProvider, jwksUri: string) {
  let keyset = jwksCache[provider];
  if (!keyset) {
    keyset = createRemoteJWKSet(new URL(jwksUri));
    jwksCache[provider] = keyset;
  }
  return keyset;
}

/** Build the IdP authorization URL. State/nonce are held in a short-lived cookie. */
export async function ssoAuthorizationUrl(
  provider: SsoProvider,
  opts: { state: string; redirectUri: string },
): Promise<string> {
  const env = loadEnv();
  const creds = getCredentials(env, provider);
  const discovery = await getDiscovery(provider);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", creds.scopes);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("nonce", opts.state); // bound to state for simplicity
  return url.toString();
}

/** Exchange the auth code for an ID token and verify its signature (JWKS). */
export async function ssoExchangeCode(
  provider: SsoProvider,
  code: string,
  redirectUri: string,
): Promise<OidcProfile> {
  const env = loadEnv();
  const creds = getCredentials(env, provider);
  const discovery = await getDiscovery(provider);

  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`idp_token_error: ${tokenRes.status} ${text.slice(0, 200)}`);
  }
  const tokenJson = (await tokenRes.json()) as { id_token?: string };
  if (!tokenJson.id_token) throw new Error("idp_missing_id_token");

  const jwks = getJwks(provider, discovery.jwks_uri);
  try {
    const { payload } = await jwtVerify(tokenJson.id_token, jwks, {
      issuer: discovery.issuer,
      audience: creds.clientId,
    });
    return {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : null,
      name: payload.name ? String(payload.name) : null,
      givenName: payload.given_name ? String(payload.given_name) : null,
      familyName: payload.family_name ? String(payload.family_name) : null,
      picture: payload.picture ? String(payload.picture) : null,
    };
  } catch {
    throw new Error("id_token_verification_failed");
  }
}

/** Find-or-create the learner from IdP claims (JIT provisioning, account link). */
export async function findOrCreateSsoUser(
  provider: SsoProvider,
  profile: OidcProfile,
): Promise<UserRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  if (!profile.email) {
    throw serviceUnavailable(
      `Your ${provider === "google" ? "Google" : "Microsoft"} account did not share an email address. Please try a different method.`,
      "sso_missing_email",
    );
  }
  const email = profile.email.toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing.length > 0) {
    const user = existing[0];
    if (user.ssoProvider && user.ssoProvider !== provider) {
      throw conflict("This email is already linked to another sign-in method.", "email_linked");
    }
    if (user.ssoSubject && user.ssoSubject !== profile.sub) {
      throw conflict("This email is already linked to a different social account.", "email_linked");
    }
    const updates: Record<string, unknown> = { ssoProvider: provider, ssoSubject: profile.sub };
    if (user.emailVerifiedAt === null) updates.emailVerifiedAt = new Date();
    const updated = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
    return updated[0];
  }

  const given = profile.givenName ?? profile.name?.split(/\s+/)[0] ?? "";
  const family =
    profile.familyName ??
    (profile.name ? profile.name.split(/\s+/).slice(1).join(" ") : "") ??
    "";
  const firstName = given.trim() || "New";
  const lastName = family.trim() || "Learner";

  const created = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(crypto.randomUUID() + crypto.randomUUID()),
      firstName,
      lastName,
      emailVerifiedAt: new Date(),
      ssoProvider: provider,
      ssoSubject: profile.sub,
      role: "learner",
    })
    .returning();
  return created[0];
}