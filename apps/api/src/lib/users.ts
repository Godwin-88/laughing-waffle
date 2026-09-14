import type { InterestValue, PublicUser, SkillLevel, UserRole } from "@takwimu/shared";
import { getStorage } from "../storage/storage";

/** Drizzle row shape for `users` (camelCase column mapping). */
export interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  role: string;
  avatarKey: string | null;
  bio: string;
  status: string;
  emailVerifiedAt: Date | string | null;
  consentGivenAt: Date | string | null;
  interests: string[] | null;
  experienceLevel: string | null;
  wizardStep: number;
  createdAt: Date | string;
}

export function computeProfileStats(user: {
  firstName?: string;
  lastName?: string;
  interests?: string[] | null;
  experienceLevel?: string | null;
}): { wizardStep: number; profileCompleteness: number } {
  let steps = 0;
  if ((user.firstName ?? "").trim() && (user.lastName ?? "").trim()) steps++;
  if ((user.interests ?? []).length > 0) steps++;
  if (user.experienceLevel) steps++;
  return { wizardStep: steps, profileCompleteness: Math.round((steps / 3) * 100) };
}

export async function mapUserToPublic(row: UserRow): Promise<PublicUser> {
  const { wizardStep, profileCompleteness } = computeProfileStats(row);
  const storage = getStorage();
  const avatarUrl = row.avatarKey
    ? await storage.signUrl(row.avatarKey, "user-uploads", 7 * 24 * 3600)
    : null;
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    firstName: row.firstName,
    lastName: row.lastName,
    avatarUrl,
    bio: row.bio,
    emailVerified: row.emailVerifiedAt !== null,
    interests: (row.interests ?? []) as InterestValue[],
    experienceLevel: (row.experienceLevel as SkillLevel | null) ?? null,
    wizardStep,
    profileCompleteness,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}