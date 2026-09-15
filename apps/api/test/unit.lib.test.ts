import { describe, expect, it } from "vitest";
import { isStrongPassword, passwordError, EMAIL_RE, INTEREST_OPTIONS } from "@takwimu/shared";
import { hashOpaqueToken, issueOpaqueToken, msToSeconds, signAccessToken, verifyAccessToken } from "../src/lib/tokens";
import { computeProfileStats } from "../src/lib/users";
import { fisherYates, gradeQuizSnapshot } from "../src/modules/quizzes/service";
import { requireAdmin } from "../src/modules/admin/service";
import { defaultConfig } from "../src/lib/config";
import { hasCompletedExport } from "../src/modules/gdpr/service";

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
describe("graded quiz grading (US-3.2.2)", () => {
  const snapshot = [
    { id: "q1", prompt: "P1", options: ["a", "b"], correctIndex: 1, explanation: "E1" },
    { id: "q2", prompt: "P2", options: ["a", "b", "c"], correctIndex: 0, explanation: "E2" },
  ];

  it("scores correct answers and persists a pass/fail decision", () => {
    const result = gradeQuizSnapshot(snapshot, [
      { questionId: "q1", selectedIndex: 1 },
      { questionId: "q2", selectedIndex: 0 },
    ], 70);
    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(2);
    expect(result.percent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.questions.every((q) => q.correct)).toBe(true);
  });

  it("fails when the score is below the pass threshold", () => {
    const result = gradeQuizSnapshot(snapshot, [
      { questionId: "q1", selectedIndex: 0 },
      { questionId: "q2", selectedIndex: 0 },
    ], 70);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(false);
    expect(result.questions[0].correct).toBe(false);
    expect(result.questions[0].correctIndex).toBe(1);
    expect(result.questions[0].explanation).toBe("E1");
  });

  it("masks unanswered questions as incorrect with a null selection", () => {
    const result = gradeQuizSnapshot(snapshot, [], 70);
    expect(result.score).toBe(0);
    expect(result.questions[0].selectedIndex).toBeNull();
  });

  it("shuffles deterministically when given a seeded RNG", () => {
    const input = [1, 2, 3, 4, 5];
    const a = fisherYates(input, () => 0.42);
    const b = fisherYates(input, () => 0.42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(input.length);
  });
});
describe("Sprint 7 — admin guard (US-7.1.1)", () => {
  it("permits only the admin role", () => {
    expect(() => requireAdmin("admin")).not.toThrow();
    expect(() => requireAdmin("learner")).toThrow(/Admin access required/);
    expect(() => requireAdmin("instructor")).toThrow(/Admin access required/);
  });
});

describe("Sprint 7 — platform config defaults (US-7.1.2)", () => {
  it("ships conservative defaults with all gateways + features enabled", () => {
    const cfg = defaultConfig();
    expect(cfg.platform.name).toBe("Takwimu Data School");
    expect(cfg.maintenance.enabled).toBe(false);
    expect(cfg.payments.enabledGateways).toEqual(["stripe", "mpesa", "paypal"]);
    expect(cfg.features.certificates).toBe(true);
    expect(cfg.platform.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("Sprint 7 — GDPR export prerequisite (US-7.2.1)", () => {
  it("requires a completed export before any deletion", () => {
    expect(hasCompletedExport([{ type: "export", status: "completed" }])).toBe(true);
    expect(hasCompletedExport([{ type: "export", status: "processing" }])).toBe(false);
    expect(hasCompletedExport([{ type: "delete", status: "completed" }])).toBe(false);
    expect(hasCompletedExport([])).toBe(false);
  });
});