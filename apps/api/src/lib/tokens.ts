import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

/** Access-token payload carried by the browser. */
export interface AccessClaims {
  sub: string; // user id
  role: string;
  iat: number;
  exp: number;
}

export async function signAccessToken(
  secret: string,
  userId: string,
  role: string,
  ttl: string,
): Promise<{ token: string; expiresInSeconds: number }> {
  const expiresInSeconds = msToSeconds(ttl);
  const token = await new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(new TextEncoder().encode(secret));
  return { token, expiresInSeconds };
}

export async function verifyAccessToken(
  secret: string,
  token: string,
): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") throw new Error("missing sub");
    return {
      sub: payload.sub,
      role: typeof payload.role === "string" ? payload.role : "learner",
      iat: typeof payload.iat === "number" ? payload.iat : 0,
      exp: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch {
    throw new Error("invalid_token");
  }
}

/** Opaque single-use tokens (verification, refresh). Stored hashed at rest. */
export function issueOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parse strings like "15m", "2h", "7d" into seconds. Defaults to 15 minutes. */
export function msToSeconds(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) return 15 * 60;
  return Number(match[1]) * UNIT_MS[match[2]] / 1000;
}