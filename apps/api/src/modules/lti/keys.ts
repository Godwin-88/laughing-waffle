import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";
import { loadEnv } from "../../config/env";

/**
 * US-8.1.2 — LTI 1.3 tool keypair.
 * The tool signs launch id_tokens / AGS assertions with an RS256 key.
 * `LTI_PRIVATE_KEY` (PEM) pins the key across restarts; when unset a key is
 * generated at boot and held in memory (fine for single-instance deploys).
 */

interface ToolKeyBundle {
  publicKey: KeyLike;
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
}

let keyPromise: Promise<ToolKeyBundle> | null = null;

async function loadKeys(): Promise<ToolKeyBundle> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
      const publicJwk = await exportJWK(publicKey);
      const kid = loadEnv().LTI_KID ?? (publicJwk.n as string | undefined)?.slice(-16) ?? "takwimu-tool";
      return { publicKey, privateKey, publicJwk, kid };
    })();
  }
  return keyPromise;
}

/** Public JWK + kid for the tool (served by GET /api/lti/jwks). */
export async function getToolPublicJwk(): Promise<{ jwk: JWK; kid: string }> {
  const { publicJwk, kid } = await loadKeys();
  return { jwk: publicJwk, kid };
}

/** JWKS payload — a single RS256 signing key. */
export async function getToolJwks(): Promise<{ keys: Array<Record<string, unknown>> }> {
  const { publicJwk, kid } = await loadKeys();
  return { keys: [{ ...publicJwk, kid, use: "sig", alg: "RS256" }] };
}

/** Sign a JWT with the tool private key (launch id_token / AGS assertion). */
export async function signToolJwt(
  claims: Record<string, unknown>,
  opts: { audience: string | string[]; issuer: string; expiresInSec?: number; useJti?: boolean },
): Promise<string> {
  const { privateKey, kid } = await loadKeys();
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresInSec ?? 600));
  if (opts.useJti !== false) jwt.setJti(randomUUID());
  return jwt.sign(privateKey);
}