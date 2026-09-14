"use client";

import { useEffect } from "react";
import { authApi, setAccessToken } from "@/lib/api";

/**
 * SSO callback target. The API redirects here with the access token in the
 * URL fragment, e.g. /auth/callback#access_token=...
 * We capture it in memory, bootstrap /auth/me, then a full-page navigation
 * (which reloads AuthProvider) sends the learner to their dashboard, or to
 * the onboarding wizard when the profile is incomplete.
 */
export default function AuthCallbackPage() {
  useEffect(() => {
    const fragment = window.location.hash;
    const match = /#access_token=([^&]+)/.exec(fragment);
    if (!match?.[1]) {
      window.location.href = "/login";
      return;
    }
    setAccessToken(match[1]);
    void authApi
      .me()
      .then((me) => {
        const next = me.user.wizardStep !== undefined && me.user.wizardStep < 3 ? "/onboarding" : "/dashboard";
        window.location.href = next;
      })
      .catch(() => {
        window.location.href = "/login";
      });
  }, []);

  return (
    <div className="mx-auto mt-20 text-center">
      <p className="animate-pulse text-3xl">⏳</p>
      <p className="mt-3 text-ink-600">Completing sign-in…</p>
    </div>
  );
}