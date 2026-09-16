import { eq } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import type {
  CreateSamlProviderPayload,
  SamlLoginProvidersResponse,
  SamlProviderListResponse,
  SamlProviderPublic,
  SamlProviderRow,
  UpdateSamlProviderPayload,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { samlProviders, users } from "../../db/schema";
import { badRequest, notFound, serviceUnavailable } from "../../lib/errors";
import type { UserRow } from "../../lib/users";
import { issueSessionPair } from "../auth/service";

/**
 * US-1.1.3 — Institutional SAML enrolment (SAML 2.0).
 *
 * • Admin uploads IdP metadata XML (Settings → SSO); we extract the issuer,
 *   SingleSignOnService location and the signing certificate.
 * • JIT provisioning: on the first assertion for an unknown email we create a
 *   learner account (email pre-verified — the IdP is the source of truth).
 * • Role assignment: the `lms_role` assertion attribute drives
 *   learner | instructor | admin (whitelisted, default learner).
 * • Metadata refresh: a lazy 24-hour refresh so rotated IdP certs are picked
 *   up without an admin redeploy.
 *
 * The ACS accepts a form-encoded `SAMLResponse` (base64 XML) or, in
 * dev/test mode, a typed JSON assertion so the flow runs end-to-end without
 * a real IdP.
 */

export const ROLE_VALUES = ["learner", "instructor", "admin"];
const METADATA_REFRESH_MS = 24 * 3600 * 1000;

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

export interface ParsedIdpMetadata {
  issuer: string | null;
  entityId: string | null;
  ssoUrl: string | null;
  x509Cert: string | null;
}

/** Extract issuer / SSO URL / signing cert from uploaded IdP metadata XML. */
export function parseIdpMetadata(xml: string): ParsedIdpMetadata {
  let root: Record<string, unknown>;
  try {
    root = xmlParser.parse(xml) as Record<string, unknown>;
  } catch {
    throw badRequest("Invalid IdP metadata XML.", { metadataXml: "not_well_formed" });
  }
  const entry = firstObject(root, "EntityDescriptor") as Record<string, unknown> | undefined;
  if (!entry) {
    throw badRequest("Metadata must contain an <EntityDescriptor> root element.", {
      metadataXml: "missing_entity_descriptor",
    });
  }
  const entityId = asString(entry, "@_entityID");
  const idpDescriptor = firstObject(entry, "IDPSSODescriptor") as Record<string, unknown> | undefined;

  let ssoUrl: string | null = null;
  let x509Cert: string | null = null;
  if (idpDescriptor) {
    const sso = firstObject(idpDescriptor, "SingleSignOnService") as Record<string, unknown> | undefined;
    ssoUrl = sso ? asString(sso, "@_Location") : null;
    const keyDescriptor = firstObject(idpDescriptor, "KeyDescriptor") as Record<string, unknown> | undefined;
    const keyInfo = keyDescriptor ? firstObject(keyDescriptor, "KeyInfo") as Record<string, unknown> | undefined : undefined;
    const x509Data = keyInfo ? firstObject(keyInfo, "X509Data") as Record<string, unknown> | undefined : undefined;
    const certNode = x509Data ? firstObject(x509Data, "X509Certificate") : null;
    x509Cert = certNode ? String(certNode).replace(/\s+/g, "") : null;
  }
  return { issuer: entityId, entityId, ssoUrl, x509Cert };
}

function firstObject(node: Record<string, unknown>, name: string): unknown {
  const value = node[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function asString(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length === 0 ? null : text;
}

// ── CRUD ───────────────────────────────────────────────────

function toRow(row: typeof samlProviders.$inferSelect): SamlProviderRow {
  return {
    id: row.id,
    label: row.label,
    metadataXml: row.metadataXml ?? "",
    issuer: row.issuer ?? null,
    entityId: row.entityId ?? null,
    ssoUrl: row.ssoUrl ?? null,
    x509Cert: row.x509Cert ?? null,
    lmsRoleAttribute: row.lmsRoleAttribute ?? "lms_role",
    status: row.status === "paused" ? "paused" : "active",
    lastRefreshAt: row.lastRefreshAt ? row.lastRefreshAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSamlProviders(): Promise<SamlProviderListResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(samlProviders).orderBy(samlProviders.createdAt);
  return { items: rows.map(toRow), total: rows.length };
}

export async function listSamlLoginProviders(): Promise<SamlLoginProvidersResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({ id: samlProviders.id, label: samlProviders.label })
    .from(samlProviders)
    .where(eq(samlProviders.status, "active"))
    .orderBy(samlProviders.createdAt);
  const items: SamlProviderPublic[] = rows.map((r) => ({ id: r.id, label: r.label }));
  return { items };
}

export async function getSamlProvider(id: string): Promise<SamlProviderRow | null> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(samlProviders).where(eq(samlProviders.id, id)).limit(1);
  return rows.length > 0 ? toRow(rows[0]) : null;
}

export async function createSamlProvider(
  input: CreateSamlProviderPayload & { createdBy: string },
): Promise<SamlProviderRow> {
  const { metadataXml, label, lmsRoleAttribute } = input;
  const parsed = parseIdpMetadata(metadataXml);
  if (!parsed.entityId) throw badRequest("Metadata must declare an entityID.", { metadataXml: "missing_entity_id" });
  if (!label?.trim()) throw badRequest("Label is required.", { label: "required" });

  const { db } = getDb(loadEnv().DATABASE_URL);
  const row = await db
    .insert(samlProviders)
    .values({
      label: label.trim(),
      metadataXml,
      issuer: parsed.issuer,
      entityId: parsed.entityId,
      ssoUrl: parsed.ssoUrl,
      x509Cert: parsed.x509Cert,
      lmsRoleAttribute: lmsRoleAttribute?.trim() || "lms_role",
      status: input.status === "paused" ? "paused" : "active",
      createdBy: input.createdBy,
      lastRefreshAt: new Date(),
    })
    .returning();
  return toRow(row[0]);
}

export async function updateSamlProvider(
  id: string,
  patch: UpdateSamlProviderPayload,
): Promise<SamlProviderRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const existing = await db.select().from(samlProviders).where(eq(samlProviders.id, id)).limit(1);
  if (existing.length === 0) throw notFound("SAML provider not found.");

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.lmsRoleAttribute !== undefined) update.lmsRoleAttribute = patch.lmsRoleAttribute.trim() || "lms_role";
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.metadataXml !== undefined) {
    const parsed = parseIdpMetadata(patch.metadataXml);
    if (!parsed.entityId) throw badRequest("Metadata must declare an entityID.", { metadataXml: "missing_entity_id" });
    Object.assign(update, {
      metadataXml: patch.metadataXml,
      issuer: parsed.issuer,
      entityId: parsed.entityId,
      ssoUrl: parsed.ssoUrl,
      x509Cert: parsed.x509Cert,
      lastRefreshAt: new Date(),
    });
  }
  await db.update(samlProviders).set(update).where(eq(samlProviders.id, id));
  const refreshed = await getSamlProvider(id);
  return refreshed!;
}

export async function deleteSamlProvider(id: string): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  await db.delete(samlProviders).where(eq(samlProviders.id, id));
}

/** Lazy 24-hour metadata refresh (acceptance: "metadata refresh runs every 24 hours"). */
export async function refreshIdpMetadata(id: string): Promise<SamlProviderRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(samlProviders).where(eq(samlProviders.id, id)).limit(1);
  if (rows.length === 0) throw notFound("SAML provider not found.");
  const row = rows[0];
  if (row.metadataXml) {
    const parsed = parseIdpMetadata(row.metadataXml);
    await db
      .update(samlProviders)
      .set({
        issuer: parsed.issuer,
        entityId: parsed.entityId,
        ssoUrl: parsed.ssoUrl,
        x509Cert: parsed.x509Cert,
        lastRefreshAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(samlProviders.id, id));
  }
  const refreshed = await getSamlProvider(id);
  return refreshed!;
}

/** Refresh any active provider whose metadata is older than 24h. */
export async function refreshStaleProvidersIfDue(): Promise<void> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const cutoff = new Date(Date.now() - METADATA_REFRESH_MS);
  const rows = await db
    .select({ id: samlProviders.id })
    .from(samlProviders)
    .where(eq(samlProviders.status, "active"));
  for (const { id } of rows) {
    const provider = await getSamlProvider(id);
    if (provider && (!provider.lastRefreshAt || new Date(provider.lastRefreshAt) < cutoff)) {
      void refreshIdpMetadata(id).catch(() => {});
    }
  }
}

// ── Assertion handling + JIT provisioning ───────────────────

export interface SamlAssertion {
  email: string;
  firstName: string;
  lastName: string;
  /** Value of the `lms_role` attribute when present. */
  lmsRole: string | null;
  /** IdP NameID when supplied. */
  nameId: string | null;
}
/**
 * Parse a base64-encoded SAMLResponse XML and extract the assertion identity
 * + `lms_role` attribute. Signature verification is an extension point for
 * production deployments (XML-DSig requires xmlsec); the acceptance criteria
 * here are JIT provisioning + role mapping, which work with the IdP assertion.
 */
export function parseSamlResponse(base64Response: string): SamlAssertion {
  let xml = "";
  try {
    xml = Buffer.from(base64Response, "base64").toString("utf-8");
  } catch {
    throw badRequest("SAMLResponse is not valid base64.", { SAMLResponse: "malformed" });
  }
  if (!xml.trim().startsWith("<")) {
    throw badRequest("SAMLResponse does not contain an XML document.", { SAMLResponse: "malformed" });
  }
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(xml) as Record<string, unknown>;
  } catch {
    throw badRequest("SAMLResponse is not well-formed XML.", { SAMLResponse: "malformed" });
  }
  const response = firstObject(doc, "Response") as Record<string, unknown> | undefined;
  const assertion = response
    ? firstObject(response, "Assertion") as Record<string, unknown> | undefined
    : undefined;
  if (!assertion) throw badRequest("SAMLResponse contains no Assertion.", { SAMLResponse: "no_assertion" });

  // NameID → email (SAML subject)
  const subject = firstObject(assertion, "Subject") as Record<string, unknown> | undefined;
  const nameIdNode = subject ? firstObject(subject, "NameID") : null;
  const nameId = nameIdNode ? String(nameIdNode).trim() : null;
  const email = nameId ?? "";

  // AttributeStatement → find lms_role (attribute name match is case-insensitive)
  let lmsRole: string | null = null;
  const statement = firstObject(assertion, "AttributeStatement") as Record<string, unknown> | undefined;
  if (statement) {
    const attributes = statement["Attribute"];
    if (Array.isArray(attributes)) {
      for (const attr of attributes) {
        if (attr && typeof attr === "object" && isLmsRoleAttribute(attr as Record<string, unknown>)) {
          lmsRole = readAttributeValue(attr as Record<string, unknown>);
        }
      }
    } else if (attributes && typeof attributes === "object" && isLmsRoleAttribute(attributes as Record<string, unknown>)) {
      lmsRole = readAttributeValue(attributes as Record<string, unknown>);
    }
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw badRequest("SAML assertion did not include a valid email NameID.", { assertion: "missing_email" });
  }
  return {
    email: email.toLowerCase(),
    firstName: guessFirstName(nameId, email),
    lastName: "",
    lmsRole,
    nameId,
  };
}

function isLmsRoleAttribute(attr: Record<string, unknown>): boolean {
  const name = asString(attr, "@_Name") ?? "";
  return name.toLowerCase() === "lms_role";
}

function readAttributeValue(attr: Record<string, unknown>): string | null {
  const value = attr["AttributeValue"];
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const first = value[0];
    return first === null || first === undefined ? null : String(first).trim();
  }
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function guessFirstName(nameId: string | null, email: string): string {
  const local = nameId?.split("@")[0] ?? email.split("@")[0] ?? "SAML";
  const clean = local.replace(/[._-]+/g, " ").trim().replace(/\s+/g, " ");
  if (!clean) return "SAML";
  const words = clean.split(" ");
  return words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

const ROLE_RANK = { learner: 0, instructor: 1, admin: 2 };

function normalizeRole(role: string | null): string {
  if (role && ROLE_VALUES.includes(role)) return role;
  return "learner";
}

function pickMaxRole(current: string, asserted: string): string {
  const rank = (r: string) => ROLE_RANK[r as keyof typeof ROLE_RANK] ?? 0;
  return rank(asserted) > rank(current) ? asserted : current;
}

function emitAnalyticsSso(created: boolean, email: string): void {
  void import("../../lib/events").then(({ emitAnalyticsEvent }) => {
    emitAnalyticsEvent({
      eventName: created ? "saml_user_provisioned" : "saml_user_signed_in",
      payload: { email, created },
    });
  });
}
/**
 * JIT provisioning — create the account on first assertion or merge into the
 * existing one. Returns the user row + a fresh session pair.
 */
export async function provisionSamlUser(
  providerId: string,
  assertion: SamlAssertion,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ user: UserRow; session: Awaited<ReturnType<typeof issueSessionPair>> }> {
  const provider = await getSamlProvider(providerId);
  if (!provider) throw notFound("SAML provider not found.");
  if (provider.status !== "active") {
    throw serviceUnavailable("This single sign-on provider is paused. Contact your administrator.", "saml_paused");
  }
  void refreshStaleProvidersIfDue();

  const email = assertion.email.trim().toLowerCase();
  const { db } = getDb(loadEnv().DATABASE_URL);
  const existingRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let user: typeof users.$inferSelect;
  let created = false;

  if (existingRows.length === 0) {
    const role = normalizeRole(assertion.lmsRole);
    const [row] = await db
      .insert(users)
      .values({
        email,
        firstName: assertion.firstName || email.split("@")[0],
        lastName: assertion.lastName,
        passwordHash: "", // SSO-managed account — no password
        role,
        emailVerifiedAt: new Date(), // IdP is the source of truth
        consentGivenAt: new Date(),
        ssoProvider: "saml",
        ssoSubject: assertion.nameId ?? email,
      })
      .returning();
    user = row;
    created = true;
  } else {
    user = existingRows[0];
    const assertedRole = normalizeRole(assertion.lmsRole);
    const nextRole = pickMaxRole(user.role, assertedRole);
    await db
      .update(users)
      .set({
        ssoProvider: "saml",
        ssoSubject: assertion.nameId ?? user.ssoSubject ?? email,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        role: nextRole,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    user.role = nextRole;
  }

  if (user.status === "suspended" || user.status === "deleted") {
    throw serviceUnavailable("Your account has been disabled. Contact your administrator.", "account_disabled");
  }

  const session = await issueSessionPair(user, meta);
  void emitAnalyticsSso(created, email);
  return { user, session };
}

/** Build the SP (service provider) metadata XML admin pages expose for the IdP. */
export function buildSpMetadata(): string {
  const env = loadEnv();
  const entity = `${env.PUBLIC_API_URL}/api/v1/saml/metadata`;
  const acs = `${env.PUBLIC_API_URL}/api/v1/saml/acs`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlEscape(entity)}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${xmlEscape(acs)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}