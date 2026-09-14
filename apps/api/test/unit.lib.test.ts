import { describe, expect, it } from "vitest";
import { isStrongPassword, passwordError, EMAIL_RE, INTEREST_OPTIONS } from "@takwimu/shared";
import { hashOpaqueToken, issueOpaqueToken, msToSeconds, signAccessToken, verifyAccessToken } from "../src/lib/tokens";
import { computeProfileStats } from "../src/lib/users";

describe("password policy (spec US-1.1.1)", () => {
  it("accepts a strong password", () => {
    expect(isStrongPassword("Takwimu123")).toBe(true);
    expect(isStrongPassword("aBcdefgh9")).toBe(true);
  });

  it("rejects weak passwords", () => {
    expect(isStrongPassword("short1A")).toBe(false); // 7 chars
    expect(isStrongPassword("alllowercase1")).toBe(false);
    expect(isStrongPassword("NoDigitsHere")).toBe(false);
    expect(isStrongPassword("")).toBe(false);
  });

  it("produces a user-friendly message", () => {
    const msg = passwordError();
    expect(msg).toContain("8");
    expect(msg).toContain("uppercase");
    expect(msg).toContain("number");
  });
});

describe("email validation", () => {
  it("matches plausible email addresses", () => {
    expect(EMAIL_RE.test("demo@takwimu.school")).toBe(true);
    expect(EMAIL_RE.test("a+b@gmail.com")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(EMAIL_RE.test("not-an-email")).toBe(false);
    expect(EMAIL_RE.test("a@b")).toBe(false);
    expect(EMAIL_RE.test("@gmail.com")).toBe(false);
  });
});

describe("opaque tokens", () => {
  it("issues unique raw tokens and hashes them deterministically", () => {
    const a = issueOpaqueToken();
    const b = issueOpaqueToken();
    expect(a).not.toBe(b);
    expect(hashOpaqueToken(a)).toBe(hashOpaqueToken(a));
    expect(hashOpaqueToken(a)).not.toBe(hashOpaqueToken(b));
    expect(hashOpaqueToken(a)).not.toContain(a);
  });
});

describe("JWT access tokens", () => {
  it("signs and verifies a token with the correct sub/role", async () => {
    const SECRET = "test-secret-that-is-definitely-long-enough-123";
    const { token, expiresInSeconds } = await signAccessToken(SECRET, "user-123", "learner", "15m");
    expect(expiresInSeconds).toBe(15 * 60);
    const claims = await verifyAccessToken(SECRET, token);
    expect(claims.sub).toBe("user-123");
    expect(claims.role).toBe("learner");
  });

  it("rejects tokens signed with a different secret", async () => {
    const a = await signAccessToken("secret-one-1234567890abcdef", "u1", "learner", "1h");
    const { token } = a;
    await expect(verifyAccessToken("secret-two-1234567890abcdef", token)).rejects.toThrow();
  });

  it("parses TTL strings", () => {
    expect(msToSeconds("15m")).toBe(900);
    expect(msToSeconds("2h")).toBe(7200);
    expect(msToSeconds("7d")).toBe(604800);
  });
});

describe("profile completeness (US-1.2.1)", () => {
  it("starts empty for a fresh account", () => {
    const { wizardStep, profileCompleteness } = computeProfileStats({});
    expect(wizardStep).toBe(0);
    expect(profileCompleteness).toBe(0);
  });

  it("reaches 100% with name, interests and level", () => {
    const stats = computeProfileStats({
      firstName: "Demo",
      lastName: "Learner",
      interests: ["ai-engineering"],
      experienceLevel: "beginner",
    });
    expect(stats.wizardStep).toBe(3);
    expect(stats.profileCompleteness).toBe(100);
  });

  it("exposes the curated interest taxonomy", () => {
    expect(INTEREST_OPTIONS.length).toBeGreaterThanOrEqual(6);
    expect(INTEREST_OPTIONS.map((o) => o.value)).toContain("ai-engineering");
  });
});