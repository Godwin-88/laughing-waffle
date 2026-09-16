import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createRemoteJWKSet, importJWK, jwtVerify } from "jose";
import type { LtiRegistrationRow } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, ltiGrades, ltiLaunches, ltiRegistrations, users } from "../../db/schema";
import { ApiError, badRequest, conflict, notFound, unauthorized } from "../../lib/errors";
import { getToolJwks, signToolJwt } from "./keys";

/**
 * US-8.1.2 — LTI 1.3 Tool Provider.
 *
 * Launch flow:
 *   1. Platform (Canvas/Moodle/Blackboard) calls GET /api/lti/login with iss,
 *      client_id, login_hint, target_link_uri → we create a one-shot launch
 *      session (state/nonce) and 302 to the platform's OIDC auth endpoint.
 *   2. Platform authenticates the user and POSTs a signed id_token + state to
 *      POST /api/lti/launch. We verify signature (platform JWKS), iss/aud/nonce,
 *      resolve the learner + course, upsert the enrolment, and return an HTML
 *      auto-posting form that carries a one-time launch ticket to the web UI.
 *   3. The web UI exchanges the ticket at POST /api/lti/session (up to 60s), sets
 *      a normal refresh cookie, and redirects to the lesson.
 *   4. AGS grade passback: on quiz submit the platform's scores endpoint is called
 *      (within 60s) with an RS256 JWT signed by the tool keypair.
 */

export interface LoginInitiationParams {
  issuer: string;
  clientId: string;
  targetLinkUri: string;
  loginHint: string;
  ltiMessageHint?: string;
  deploymentId?: string;
  custom?: string;
}

export interface LaunchTicket {
  ticket: string;
  targetUrl: string;
  expiresInSeconds: number;
}

const TICKET_TTL_SECONDS = 60;
// ── Registration CRUD ────────────────────────────────────────

function toRegistrationRow(row: typeof ltiRegistrations.$inferSelect): LtiRegistrationRow {
  return {
    id: row.id,
    issuer: row.issuer,
    clientId: row.clientId,
    toolName: row.toolName ?? "",
    authLoginUrl: row.authLoginUrl,
    authTokenUrl: row.authTokenUrl,
    jwksUrl: row.jwksUrl,
    agsLineItemUrl: row.agsLineItemUrl,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRegistrations(): Promise<{ items: LtiRegistrationRow[]; total: number }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(ltiRegistrations).orderBy(ltiRegistrations.createdAt);
  return { items: rows.map(toRegistrationRow), total: rows.length };
}

export async function createRegistration(input: {
  issuer: string;
  clientId: string;
  toolName?: string;
  authLoginUrl?: string;
  authTokenUrl?: string;
  jwksUrl?: string;
  platformKeySetJson?: string;
  agsLineItemUrl?: string;
  active?: boolean;
  createdBy: string;
}): Promise<LtiRegistrationRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  let platformKeySet: Record<string, unknown> | undefined;
  if (input.platformKeySetJson) {
    const parsed = JSON.parse(input.platformKeySetJson) as unknown;
    if (!parsed || typeof parsed !== "object") throw badRequest("platformKeySetJson must be valid JSON.");
    platformKeySet = parsed as Record<string, unknown>;
  }
  const [row] = await db
    .insert(ltiRegistrations)
    .values({
      issuer: input.issuer,
      clientId: input.clientId,
      toolName: input.toolName ?? "",
      authLoginUrl: input.authLoginUrl ?? null,
      authTokenUrl: input.authTokenUrl ?? null,
      jwksUrl: input.jwksUrl ?? null,
      platformKeySet: platformKeySet ?? null,
      agsLineItemUrl: input.agsLineItemUrl ?? null,
      active: input.active ?? true,
      createdBy: input.createdBy,
    })
    .returning();
  return toRegistrationRow(row);
}

export async function getRegistration(id: string): Promise<LtiRegistrationRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [row = null] = await db.select().from(ltiRegistrations).where(eq(ltiRegistrations.id, id)).limit(1);
  if (!row) throw notFound("LTI registration not found.");
  return toRegistrationRow(row);
}

export async function updateRegistration(
  id: string,
  patch: Record<string, unknown>,
): Promise<LtiRegistrationRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  let platformKeySet: Record<string, unknown> | undefined;
  if (typeof patch.platformKeySetJson === "string") {
    const parsed = JSON.parse(patch.platformKeySetJson) as unknown;
    if (!parsed || typeof parsed !== "object") throw badRequest("platformKeySetJson must be valid JSON.");
    platformKeySet = parsed as Record<string, unknown>;
  }
  const [row] = await db
    .update(ltiRegistrations)
    .set({
      toolName: typeof patch.toolName === "string" ? patch.toolName : undefined,
      authLoginUrl: typeof patch.authLoginUrl === "string" ? patch.authLoginUrl : undefined,
      authTokenUrl: typeof patch.authTokenUrl === "string" ? patch.authTokenUrl : undefined,
      jwksUrl: typeof patch.jwksUrl === "string" ? patch.jwksUrl : undefined,
      platformKeySet,
      agsLineItemUrl: typeof patch.agsLineItemUrl === "string" ? patch.agsLineItemUrl : undefined,
      active: typeof patch.active === "boolean" ? patch.active : undefined,
      updatedAt: new Date(),
    })
    .where(eq(ltiRegistrations.id, id))
    .returning();
  if (!row) throw notFound("LTI registration not found.");
  return toRegistrationRow(row);
}

export async function deleteRegistration(id: string): Promise<{ ok: true }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.delete(ltiRegistrations).where(eq(ltiRegistrations.id, id));
  return { ok: true };
}
// ── OIDC login initiation (step 1) ───────────────────────────

/** Start OIDC login initiation. Creates the launch session + 302 URL. */
export async function startLoginInitiation(
  params: LoginInitiationParams,
): Promise<{ redirectUrl: string; registrationId: string }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [reg = null] = await db
    .select()
    .from(ltiRegistrations)
    .where(and(eq(ltiRegistrations.issuer, params.issuer), eq(ltiRegistrations.clientId, params.clientId)))
    .limit(1);
  if (!reg) throw notFound("Unknown LTI platform (issuer/client_id pair). Please register it in Admin → LTI.");
  if (!reg.active) throw conflict("This LTI registration is inactive.", "lti_inactive");
  if (!reg.authLoginUrl) throw badRequest("Platform auth_login_url is not configured for this registration.");

  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");

  const targetUri = params.targetLinkUri || (params.custom ? decodeCustomTarget(params.custom) : null);
  await db.insert(ltiLaunches).values({
    registrationId: reg.id,
    state,
    nonce,
    messageType: "LtiResourceLinkLaunch",
    targetLinkUri: targetUri,
    contextId: params.deploymentId ?? null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const url = new URL(reg.authLoginUrl);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("client_id", reg.clientId);
  url.searchParams.set("redirect_uri", `${loadEnv().PUBLIC_API_URL}/api/lti/launch`);
  url.searchParams.set("login_hint", params.loginHint);
  if (params.ltiMessageHint) url.searchParams.set("lti_message_hint", params.ltiMessageHint);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("prompt", "none");
  return { redirectUrl: url.toString(), registrationId: reg.id };
}

function decodeCustomTarget(custom: string): string | null {
  try {
    const obj = JSON.parse(Buffer.from(custom, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof obj.target_link_uri === "string") return obj.target_link_uri;
    if (typeof obj.slug === "string") return `/courses/${obj.slug}`;
    return null;
  } catch {
    return null;
  }
}

// ── Launch verification (step 2) ─────────────────────────────

export interface VerifiedLaunch {
  registrationId: string;
  userId: string;
  courseId: string | null;
  targetLinkUri: string;
  messageType: string;
}

interface LaunchSessionRow {
  id: string;
  registrationId: string;
  nonce: string;
  used: boolean;
  expiresAt: Date;
  targetLinkUri: string | null;
}

function platformKeys(reg: { jwksUrl: string | null; platformKeySet: Record<string, unknown> | null }) {
  const raw = (reg.platformKeySet ?? {}) as Record<string, unknown>;
  const jwks = raw as { keys?: Array<Record<string, unknown>> };
  if (Array.isArray(jwks.keys) && jwks.keys.length > 0) return { static: jwks.keys, remote: null };
  if (raw.kty) return { static: [raw], remote: null };
  if (reg.jwksUrl) return { static: null, remote: createRemoteJWKSet(new URL(reg.jwksUrl)) };
  return { static: null, remote: null };
}

/** Verify the platform's id_token and resolve learner + course. */
export async function completeLaunch(input: { idToken: string; state: string }): Promise<VerifiedLaunch> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const q = await db.select().from(ltiLaunches).where(eq(ltiLaunches.state, input.state)).limit(1);
  const launchRow = q[0] as LaunchSessionRow | undefined;
  if (!launchRow || launchRow.used) throw unauthorized("Invalid or already-used launch state.");
  if (launchRow.expiresAt < new Date()) throw unauthorized("LTI launch session expired.");

  const regRows = await db.select().from(ltiRegistrations).where(eq(ltiRegistrations.id, launchRow.registrationId)).limit(1);
  const registration = regRows[0];
  if (!registration) throw unauthorized("LTI registration for this launch was removed.");

  const keys = platformKeys(registration);
  if (!keys.static && !keys.remote) {
    throw unauthorized("LTI registration has no platform JWKS URL or pasted keys.", "lti_no_platform_keys");
  }

  let claims: Record<string, unknown>;
  try {
    if (keys.static) {
      let verified: Record<string, unknown> | null = null;
      for (const jwk of keys.static) {
        try {
          const key = await importJWK({ ...jwk } as never, "RS256");
          const { payload } = await jwtVerify(input.idToken, key, {
            issuer: registration.issuer,
            audience: registration.clientId,
            algorithms: ["RS256", "RS384", "PS256", "RS512"],
          });
          verified = payload as Record<string, unknown>;
          break;
        } catch {
          /* try next key */
        }
      }
      if (!verified) throw new Error("signature_verification_failed");
      claims = verified;
    } else {
      const { payload } = await jwtVerify(input.idToken, keys.remote!, {
        issuer: registration.issuer,
        audience: registration.clientId,
        algorithms: ["RS256", "RS384", "PS256", "RS512"],
      });
      claims = payload as Record<string, unknown>;
    }
  } catch (err) {
    throw new ApiError(
      401,
      "lti_verification_failed",
      "LTI id_token verification failed. Check the platform JWKS URL or pasted keys.",
      { detail: (err as Error)?.message?.slice(0, 160) ?? "unknown" },
    );
  }

  if (claims.nonce !== launchRow.nonce) {
    throw unauthorized("LTI id_token nonce mismatch.", "lti_nonce_mismatch");
  }

  await db.update(ltiLaunches).set({ used: true }).where(eq(ltiLaunches.id, launchRow.id));
// ── Resolve the learner ────────────────────────────────────
  const subject = String(claims.sub ?? "");
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  const givenName = typeof claims.given_name === "string" ? claims.given_name : (claims.name ? String(claims.name) : "LTI");
  const familyName = typeof claims.family_name === "string" ? claims.family_name : "Learner";

  let userRow = (await db.select().from(users).where(and(eq(users.ssoSubject, subject), eq(users.ssoProvider, "lti"))).limit(1))[0] ?? null;
  if (!userRow && email) {
    userRow = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0] ?? null;
  }
  if (!userRow) {
    if (!email) throw new ApiError(400, "lti_requires_email", "LTI launch did not include an email; cannot provision a learner.");
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash: `lti:${randomBytes(24).toString("base64url")}`,
        firstName: givenName,
        lastName: familyName,
        role: "learner",
        ssoProvider: "lti",
        ssoSubject: subject,
        emailVerifiedAt: new Date(),
        consentGivenAt: new Date(),
        wizardStep: 0,
      })
      .returning();
    userRow = created;
  }
  if (userRow.ssoSubject !== subject) {
    await db.update(users).set({ ssoSubject: subject, ssoProvider: "lti", lastActiveAt: new Date() }).where(eq(users.id, userRow.id));
  } else {
    await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userRow.id));
  }

  // ── Resolve the course ─────────────────────────────────────
  const custom = (claims["https://purl.imsglobal.org/spec/lti/claim/custom"] ?? {}) as Record<string, unknown>;
  const target = String(claims["https://purl.imsglobal.org/spec/lti/claim/target_link_uri"] ?? launchRow.targetLinkUri ?? "/dashboard");
  let courseId: string | null = null;
  let targetLinkUri = target;
  if (typeof custom.slug === "string") {
    const courseMatches = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, custom.slug)).limit(1);
    if (courseMatches.length > 0) {
      courseId = courseMatches[0].id;
      targetLinkUri = target.includes("/courses/") ? target : `/courses/${custom.slug}`;
    }
  }
  const context = (claims["https://purl.imsglobal.org/spec/lti/claim/context"] ?? {}) as Record<string, unknown>;
  const contextId = typeof context.id === "string" ? context.id : null;
  await db.update(ltiLaunches).set({ userId: userRow.id, courseId, contextId }).where(eq(ltiLaunches.id, launchRow.id));

  if (courseId) {
    await db
      .insert(enrolments)
      .values({ userId: userRow.id, courseId, status: "enrolled", pricePaidCents: 0 })
      .onConflictDoNothing({ target: [enrolments.userId, enrolments.courseId] });
  }

  return {
    registrationId: registration.id,
    userId: userRow.id,
    courseId,
    targetLinkUri: targetLinkUri || "/dashboard",
    messageType: String(claims["https://purl.imsglobal.org/spec/lti/claim/message_type"] ?? "LtiResourceLinkLaunch"),
  };
}
// ── Launch ticket & web session bootstrap ────────────────────

/**
 * One-time ticket that bridges the API launch POST (top-frame) to the SPA
 * session bootstrap (same-origin fetch). Single-use, short TTL.
 */
const tickets = new Map<string, { userId: string; registrationId: string; targetUrl: string; expiresAt: number }>();

export function issueLaunchTicket(launch: VerifiedLaunch): LaunchTicket {
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, {
    userId: launch.userId,
    registrationId: launch.registrationId,
    targetUrl: launch.targetLinkUri,
    expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000,
  });
  return { ticket, targetUrl: launch.targetLinkUri, expiresInSeconds: TICKET_TTL_SECONDS };
}

export async function exchangeLaunchTicket(ticket: string): Promise<{ userId: string; targetUrl: string }> {
  const entry = tickets.get(ticket);
  if (!entry) {
    throw unauthorized("LTI launch ticket expired or already used. Launch again from your LMS.", "lti_ticket_expired");
  }
  if (entry.expiresAt < Date.now()) {
    tickets.delete(ticket);
    throw unauthorized("LTI launch ticket expired or already used. Launch again from your LMS.", "lti_ticket_expired");
  }
  tickets.delete(ticket); // single-use
  const { db } = getDb(loadEnv().DATABASE_URL);
  const userRow = (await db.select().from(users).where(eq(users.id, entry.userId)).limit(1))[0];
  if (!userRow || userRow.status !== "active") {
    throw unauthorized("LTI-provisioned account is not active.", "account_inactive");
  }
  return { userId: entry.userId, targetUrl: entry.targetUrl };
}

// ── AGS grade passback (tool → platform) ─────────────────────

/**
 * Push a quiz score to the originating LMS (US-8.1.2 "Grade passback to
 * originating LMS within 60 seconds of quiz/assignment submission").
 * Fire-and-forget from the quiz submit path; ledger rows track delivery.
 */
export async function pushGradeToPlatform(input: {
  registrationId: string;
  userId: string;
  courseId: string | null;
  lessonId: string | null;
  attemptId: string | null;
  scoreGiven: number;
  scoreMaximum: number;
}): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [reg = null] = await db.select().from(ltiRegistrations).where(eq(ltiRegistrations.id, input.registrationId)).limit(1);
  if (!reg || !reg.active || !reg.agsLineItemUrl) return; // nothing to push

  const [ledger] = await db
    .insert(ltiGrades)
    .values({
      registrationId: input.registrationId,
      userId: input.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      attemptId: input.attemptId,
      scoreGiven: String(input.scoreGiven),
      scoreMaximum: String(input.scoreMaximum),
      status: "pending",
    })
    .returning();

  const agsBase = reg.agsLineItemUrl; // non-null: guarded above
  void (async () => {
    try {
      const token = await signToolJwt(
        { sub: input.userId, "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0" },
        { audience: reg.clientId, issuer: loadEnv().PUBLIC_API_URL, expiresInSec: 300 },
      );
      const endpoint = `${agsBase.replace(/\/$/, "")}/scores`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/vnd.ims.lti.v1.score+json",
        },
        body: JSON.stringify({
          userId: input.userId,
          scoreGiven: input.scoreGiven,
          scoreMaximum: input.scoreMaximum,
          timestamp: new Date().toISOString(),
          activityProgress: "Completed",
          gradingProgress: "FullyGraded",
        }),
      });
      const text = await res.text();
      await db
        .update(ltiGrades)
        .set({
          status: res.ok ? "pushed" : "failed",
          error: res.ok ? null : `http_${res.status} ${text.slice(0, 200)}`,
          pushedAt: res.ok ? new Date() : null,
        })
        .where(eq(ltiGrades.id, ledger.id));
      if (!res.ok) console.warn(`[lti-ags] grade pushback failed (${res.status}) for registration ${reg.id}`);
    } catch (err) {
      await db
        .update(ltiGrades)
        .set({ status: "failed", error: (err as Error)?.message?.slice(0, 300) ?? "network_error" })
        .where(eq(ltiGrades.id, ledger.id));
    }
  })();
}

export async function listGradeLedger(registrationId: string | null): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
}> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await (registrationId
    ? db.select().from(ltiGrades).where(eq(ltiGrades.registrationId, registrationId)).orderBy(ltiGrades.createdAt)
    : db.select().from(ltiGrades).orderBy(ltiGrades.createdAt));
  return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), pushedAt: r.pushedAt?.toISOString() ?? null })), total: rows.length };
}
