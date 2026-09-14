"use client";

import { useEffect, useState } from "react";
import type {
  QuizAttemptResult,
  QuizStatusResponse,
  StartQuizAttemptResponse,
} from "@takwimu/shared";
import { quizApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * US-3.2.2 — graded quiz at the end of a module.
 * - Timer auto-submits on expiry (server also finalises stale attempts).
 * - Question & answer order is shuffled server-side per attempt and answers are
 *   never shipped to the client before submission.
 * - Results show score, pass/fail and a per-question breakdown with explanations.
 */
export function GradedQuiz({ lessonId, courseSlug, position }: { lessonId: string; courseSlug: string; position: number }) {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<QuizStatusResponse | null>(null);
  const [attempt, setAttempt] = useState<StartQuizAttemptResponse | null>(null);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [live, setLive] = useState(true);

  // Load status once.
  useEffect(() => {
    if (loading || !user) return;
    void quizApi
      .status(courseSlug, position)
      .then(setStatus)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Could not load quiz."));
  }, [courseSlug, position, user, loading]);
// Countdown for the active attempt (auto-submit at expiry — US-3.2.2).
  useEffect(() => {
    if (!attempt || attempt.status !== "in_progress" || !attempt.expiresAt) return;
    const target = new Date(attempt.expiresAt).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && live) {
        setAutoSubmitting(true);
        void submit(answers);
      }
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.attemptId, attempt?.expiresAt, live]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    setResult(null);
    setAnswers({});
    try {
      const next = await quizApi.startAttempt(courseSlug, position);
      setAttempt(next);
      setStatus((prev) => {
        if (!prev) return prev;
        return { ...prev, attemptsUsed: prev.attemptsUsed + 1, canAttempt: false };
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not start the quiz.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (submitted: Record<string, number>) => {
    if (!attempt) return;
    setLive(false);
    setBusy(true);
    try {
      const payload = Object.entries(submitted).map(([questionId, selectedIndex]) => ({
        questionId,
        selectedIndex,
      }));
      const res = await quizApi.submitAttempt(courseSlug, position, attempt.attemptId, payload);
      setResult(res);
      setAttempt(null);
      // Refresh status so attempt counts / cooldown reflect submission.
      void quizApi.status(courseSlug, position).then(setStatus).catch(() => undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not grade the quiz. Please try again.");
      setLive(true);
      setAutoSubmitting(false);
    } finally {
      setBusy(false);
    }
  };
if (!user) {
    return (
      <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
        <p className="text-sm text-ink-600">Sign in to take this graded quiz.</p>
      </div>
    );
  }
  if (loading || !status) {
    return (
      <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
        <p className="text-sm text-ink-500">Loading quiz…</p>
      </div>
    );
  }

  const cfg = status.config;

  // ── Results (after submission) ───────────────────────────────
  if (result) {
    return (
      <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink-900">Quiz results</h2>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${
              result.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {result.passed ? "Passed ✓" : "Not passed"}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-600">
          Score{" "}
          <span className="font-semibold text-ink-900">
            {result.score}/{result.maxScore}
          </span>{" "}
          · {result.percent}% · required {cfg.passPercent}%
        </p>

        <div className="mt-5 space-y-4">
          {result.questions.map((q, qi) => (
            <div key={q.questionId} className="rounded-xl border border-ink-200 p-4">
              <p className="text-sm font-semibold text-ink-800">{qi + 1}. {q.prompt}</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {q.options.map((opt, oi) => {
                  const chosen = q.selectedIndex === oi;
                  const correct = oi === q.correctIndex;
                  const cls = correct
                    ? "border-green-500 bg-green-50 text-green-800"
                    : chosen
                      ? "border-red-400 bg-red-50 text-red-700"
                      : "border-ink-200 text-ink-600";
                  const mark = correct ? "✓" : chosen ? "✗" : "";
                  return (
                    <li key={oi} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${cls}`}>
                      <span>{opt}</span>
                      <span className="ml-auto text-xs font-bold">{mark}</span>
                    </li>
                  );
                })}
              </ul>
              {q.explanation ? (
                <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-800">
                  {q.explanation}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {status?.canAttempt ? (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="mt-6 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            {busy ? "Starting…" : "Try again"}
          </button>
        ) : status?.cooldownRemainingSeconds && status.cooldownRemainingSeconds > 0 ? (
          <p className="mt-6 text-sm text-ink-500">
            Next attempt available in {Math.ceil(status.cooldownRemainingSeconds / 60)} minute
            {Math.ceil(status.cooldownRemainingSeconds / 60) === 1 ? "" : "s"}.
          </p>
        ) : status?.maxAttemptsReached ? (
          <p className="mt-6 text-sm text-ink-500">
            You have used all {cfg.maxAttempts} allowed attempts.
          </p>
        ) : null}
      </div>
    );
  }
// ── Active attempt ───────────────────────────────────────────
  if (attempt && attempt.status === "in_progress") {
    const answered = Object.keys(answers).length;
    const allAnswered = answered >= attempt.questions.length;
    const minutes = String(Math.floor((secondsLeft ?? 0) / 60));
    const secs = String((secondsLeft ?? 0) % 60).padStart(2, "0");
    return (
      <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink-900">Graded quiz</h2>
          {secondsLeft !== null ? (
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                secondsLeft <= 60 ? "bg-red-100 text-red-700" : "bg-ink-100 text-ink-700"
              }`}
            >
              ⏱ {minutes}:{secs}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          Attempt {attempt.attemptNumber} · {attempt.questions.length} questions · required {cfg.passPercent}% to pass
        </p>

        <div className="mt-5 space-y-5">
          {attempt.questions.map((q, qi) => (
            <fieldset key={q.id} className="rounded-xl border border-ink-200 p-4">
              <legend className="px-2 text-sm font-semibold text-ink-800">{qi + 1}. {q.prompt}</legend>
              <div className="mt-2 flex flex-col gap-2">
                {q.options.map((opt, oi) => {
                  const chosen = answers[q.id] === oi;
                  return (
                    <label
                      key={oi}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        chosen ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={oi}
                        checked={chosen}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                        className="accent-brand-600"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void submit(answers)}
            disabled={!allAnswered || busy || autoSubmitting}
            className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {autoSubmitting ? "Time up — submitting…" : busy ? "Submitting…" : "Submit quiz"}
          </button>
          <span className="text-xs text-ink-400">
            {allAnswered ? `${answered}/${attempt.questions.length} answered` : `Answer all ${attempt.questions.length} questions to enable submit`}
          </span>
        </div>
        {errorMsg ? <p className="mt-2 text-xs text-red-600">{errorMsg}</p> : null}
      </div>
    );
  }

  // ── Start screen ─────────────────────────────────────────────
  const best = status.bestAttempt;
  const inCooldown = status.cooldownRemainingSeconds > 0;
  const blocked = status.maxAttemptsReached || inCooldown;
  const configSummary: string[] = [];
  if (cfg.timeLimitMinutes > 0) configSummary.push(`${cfg.timeLimitMinutes} min`);
  if (cfg.maxAttempts > 0) configSummary.push(`${cfg.maxAttempts} attempts`);
  if (cfg.attemptCooldownMinutes > 0) configSummary.push(`${cfg.attemptCooldownMinutes} min cooldown`);
  configSummary.push(`pass at ${cfg.passPercent}%`);

  return (
    <div className="mt-8 rounded-2xl border border-ink-200 bg-white p-6">
      <h2 className="text-lg font-bold text-ink-900">End-of-module quiz</h2>
      <p className="mt-1 text-sm text-ink-600">
        {status.questionCount} questions · {configSummary.join(" · ")} · answers graded server-side.
      </p>

      {best ? (
        <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-800">
            Best attempt: {best.percent}%{" "}
            {best.passed ? "(passed)" : "(not passed)"}
          </p>
          <p className="mt-1 text-xs text-brand-600">
            Attempt {best.attemptNumber} · {best.score}/{best.maxScore} · submitted{" "}
            {best.submittedAt ? new Date(best.submittedAt).toLocaleString().split(",")[0] : ""}
          </p>
        </div>
      ) : null}

      {errorMsg ? <p className="mt-2 text-xs text-red-600">{errorMsg}</p> : null}

      <button
        type="button"
        onClick={start}
        disabled={blocked || busy}
        className="mt-5 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Starting…" : status.attemptsUsed > 0 ? "Start a new attempt" : "Start quiz"}
      </button>

      {inCooldown ? (
        <p className="mt-3 text-sm text-ink-500">
          Cooldown active — next attempt available in {Math.ceil(status.cooldownRemainingSeconds / 60)} minute
          {Math.ceil(status.cooldownRemainingSeconds / 60) === 1 ? "" : "s"}.
        </p>
      ) : null}
      {status.maxAttemptsReached ? (
        <p className="mt-3 text-sm text-ink-500">
          You have used all {cfg.maxAttempts} allowed attempts for this quiz.
        </p>
      ) : null}
    </div>
  );
}