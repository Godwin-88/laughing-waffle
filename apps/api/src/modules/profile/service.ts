import { eq } from "drizzle-orm";
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_BYTES,
  BIO_MAX_LENGTH,
  INTEREST_OPTIONS,
  type InterestValue,
  type SkillLevel,
} from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { users } from "../../db/schema";
import { badRequest, notFound } from "../../lib/errors";
import { mapUserToPublic } from "../../lib/users";
import { avatarKeyFor, getStorage } from "../../storage/storage";

export interface WizardStepInput {
  step: 1 | 2 | 3;
  firstName?: string;
  lastName?: string;
  interests?: InterestValue[];
  experienceLevel?: SkillLevel;
}

const INTEREST_VALUES = new Set<string>(INTEREST_OPTIONS.map((o) => o.value));
const LEVEL_VALUES: ReadonlyArray<string> = ["beginner", "intermediate", "advanced"];

export async function completeWizardStep(
  userId: string,
  input: WizardStepInput,
): Promise<Awaited<ReturnType<typeof mapUserToPublic>>> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const existing = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (existing.length === 0) throw notFound("Account not found.");
  const current = existing[0];
  const step = input.step;

  if (step === 1) {
    const firstName = input.firstName?.trim();
    const lastName = input.lastName?.trim();
    if (!firstName || !lastName) {
      throw badRequest("First and last name are required.", { name: "required" });
    }
    const [updated] = await db
      .update(users)
      .set({ firstName, lastName, wizardStep: Math.max(current.wizardStep, 1) })
      .where(eq(users.id, userId))
      .returning();
    return mapUserToPublic(updated);
  }

  if (step === 2) {
    const interests = (input.interests ?? []).filter((i) => INTEREST_VALUES.has(i));
    if (interests.length === 0) {
      throw badRequest("Pick at least one area of interest.", { interests: "required" });
    }
    const [updated] = await db
      .update(users)
      .set({ interests, wizardStep: Math.max(current.wizardStep, 2) })
      .where(eq(users.id, userId))
      .returning();
    return mapUserToPublic(updated);
  }

  // step === 3
  if (!input.experienceLevel || !LEVEL_VALUES.includes(input.experienceLevel)) {
    throw badRequest("Select your experience level.", { experienceLevel: "required" });
  }
  const [updated] = await db
    .update(users)
    .set({
      experienceLevel: input.experienceLevel,
      wizardStep: Math.max(current.wizardStep, 3),
    })
    .where(eq(users.id, userId))
    .returning();
  return mapUserToPublic(updated);
}

export async function updateBio(
  userId: string,
  bio: string,
): Promise<Awaited<ReturnType<typeof mapUserToPublic>>> {
  const text = bio.trim();
  if (text.length > BIO_MAX_LENGTH) {
    throw badRequest(`Bio must be ${BIO_MAX_LENGTH} characters or fewer.`, { bio: "too_long" });
  }
  const { db } = getDb(loadEnv().DATABASE_URL);
  const [updated] = await db.update(users).set({ bio: text }).where(eq(users.id, userId)).returning();
  return mapUserToPublic(updated);
}

export async function uploadAvatar(userId: string, data: Buffer, contentType: string): Promise<string> {
  if (!AVATAR_ALLOWED_TYPES.includes(contentType as (typeof AVATAR_ALLOWED_TYPES)[number])) {
    throw badRequest("Avatar must be a JPEG, PNG or WebP image.", { avatar: "unsupported_type" });
  }
  if (data.byteLength > AVATAR_MAX_BYTES) {
    throw badRequest("Avatar must be 5 MB or smaller.", { avatar: "too_large" });
  }
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const storage = getStorage();
  const key = avatarKeyFor(userId, ext);
  await storage.putObject(key, data, contentType, "user-uploads");
  return storage.signUrl(key, "user-uploads", 7 * 24 * 3600);
}