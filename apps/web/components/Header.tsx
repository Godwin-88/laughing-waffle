"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function Header() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  const nav = [
    { href: "/", label: "Home" },
    { href: "/courses", label: "Courses" },
    { href: "/dashboard", label: "My Learning" },
    ...(user?.role === "instructor" || user?.role === "admin"
      ? [{ href: "/studio", label: "Studio" }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">
            T
          </span>
          <span className="text-base font-bold tracking-tight text-ink-900">
            Takwimu <span className="text-brand-600">Data School</span>
          </span>
        </Link>

        <nav className="flex items-center gap-5 text-sm font-medium text-ink-700">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`transition hover:text-brand-700 ${active ? "font-semibold text-brand-600" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
          <span className="h-px w-px" />
          {loading ? (
            <span className="text-sm text-ink-400">…</span>
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="hidden rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700 sm:inline-flex">
                {user.profileCompleteness}%
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:border-brand-400 hover:text-brand-700"
              >
                {user.firstName} · Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}