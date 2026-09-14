"use client";

import { useState } from "react";
import type { QuizQuestion } from "@takwimu/shared";

export function QuickCheck({ questions }: { questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false);

  if (questions.length === 0) return null;

  const score = questions.filter((q) => answers[q.id] === q.correctIndex).length;

  return (
    <div className="mt-10 rounded-2xl border border-ink-200 bg-white p-6">
      <h2 className="text-lg font-bold text-ink-900">Quick check</h2>
      <p className="mt-1 text-sm text-ink-500">
        {questions.length} questions · answers explained below.
      </p>
      <div className="mt-5 space-y-6">
        {questions.map((q, qi) => (
          <fieldset key={q.id} className="rounded-xl border border-ink-200 p-4">
            <legend className="px-2 text-sm font-semibold text-ink-800">
              {qi + 1}. {q.prompt}
            </legend>
            <div className="mt-2 flex flex-col gap-2">
              {q.options.map((opt, oi) => {
                const chosen = answers[q.id] === oi;
                const isCorrect = oi === q.correctIndex;
                const show = revealed;
                const cls = !show
                  ? "border-ink-200 hover:border-brand-400"
                  : isCorrect
                    ? "border-green-500 bg-green-50"
                    : chosen
                      ? "border-red-400 bg-red-50"
                      : "border-ink-200 opacity-60";
                return (
                  <label key={oi} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={oi}
                      disabled={revealed}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                      className="accent-brand-600"
                    />
                    {opt}
                    {show && isCorrect ? <span className="ml-auto text-xs font-bold text-green-600">✓</span> : null}
                    {show && chosen && !isCorrect ? <span className="ml-auto text-xs font-bold text-red-500">✗</span> : null}
                  </label>
                );
              })}
            </div>
            {revealed ? (
              <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm leading-relaxed text-brand-800">
                {q.explanation}
              </p>
            ) : null}
          </fieldset>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRevealed(true)}
          disabled={Object.keys(answers).length < questions.length}
          className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check answers
        </button>
        {revealed ? (
          <span className={`text-sm font-semibold ${score === questions.length ? "text-green-600" : "text-ink-700"}`}>
            You scored {score}/{questions.length}
            {score === questions.length ? " — excellent! 🎉" : " — review the explanations above."}
          </span>
        ) : null}
      </div>
    </div>
  );
}