"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NotificationPreferences } from "@takwimu/shared";
import { notificationsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const LABELS: Array<{ key: keyof NotificationPreferences; label: string; hint: string }> = [
  { key: "discussionReply", label: "Discussion replies", hint: "When someone replies to your question or post." },
  { key: "assignmentGraded", label: "Assignment graded", hint: "When your quiz or assignment result is published." },
  { key: "courseContentAdded", label: "New course content", hint: "When an instructor you're enrolled with adds a lesson." },
  { key: "certificateIssued", label: "Certificate issued", hint: "When you earn a certificate of completion." },
  { key: "paymentReceipt", label: "Payment receipts", hint: "Order confirmations and receipts for purchases." },
  { key: "streakReminder", label: "Learning streak reminders", hint: "A nudge when you've been active lately." },
  { key: "instructorAnnouncement", label: "Instructor announcements", hint: "Broadcasts sent by your course instructor." },
  { key: "marketing", label: "Marketing & product news", hint: "Occasional updates about the school." },
];

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void notificationsApi
      .preferences()
      .then((res) => setPrefs(res.preferences))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load preferences."));
  }, []);

  if (!prefs) {
    return <p className="py-10 text-sm text-ink-500">Loading notification preferences…</p>;
  }

  const toggle = async (key: keyof NotificationPreferences) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaved(false);
    setError(null);
    try {
      await notificationsApi.updatePreferences({ [key]: next[key] });
      setSaved(true);
    } catch (err) {
      setPrefs(prefs);
      setError(err instanceof Error ? err.message : "Could not save the change.");
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <nav className="text-sm text-ink-500">
        <Link href="/dashboard" className="hover:text-brand-700">← Dashboard</Link>
      </nav>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">Notification settings</h1>
      <p className="mt-1 text-sm text-ink-500">
        Control which notifications you receive by email and in-app (unsubscribe from all at once below).
      </p>

      {saved ? <p className="mt-2 rounded-xl bg-green-50 p-2 text-sm text-green-700">Saved ✓</p> : null}
      {error ? <p className="mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}

      <div className="mt-5 overflow-hidden rounded-3xl border border-ink-200 bg-white">
        {LABELS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 last:border-0">
            <div>
              <p className="font-semibold text-ink-800">{label}</p>
              <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[key]}
              onClick={() => void toggle(key)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                prefs[key] ? "bg-brand-600" : "bg-ink-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  prefs[key] ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void notificationsApi.updatePreferences(LABELS.map((l) => l.key).reduce((acc, k) => ({ ...acc, [k]: false }), {} as NotificationPreferences)).then(() => void notificationsApi.preferences().then((res) => setPrefs(res.preferences)).then(() => setSaved(true)))}
        className="mt-4 rounded-xl border border-ink-200 px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-400"
      >
        Unsubscribe from all notifications
      </button>

      {user ? (
        <p className="mt-6 text-xs text-ink-400">
          One-click unsubscribe link (CAN-SPAM / GDPR Art. 21):{" "}
          <a href={`/api/v1/notifications/unsubscribe?userId=${user.id}`} className="font-mono text-ink-500">
            /api/v1/notifications/unsubscribe?userId={user.id}
          </a>
        </p>
      ) : null}
    </div>
  );
}