"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AppNotification } from "@takwimu/shared";
import { notificationsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.max(1, Math.round(diff / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);

  if (!user) return null;

  const refresh = async () => {
    try {
      const res = await notificationsApi.list(20);
      setItems(res.items);
      setUnread(res.unread);
    } catch {
      /* notifications are best-effort */
    }
  };

  useEffect(() => {
    if (!user) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [user?.id]);

  const openPanel = async () => {
    if (!open) void refresh();
    setOpen(!open);
  };

  const markRead = async (item: AppNotification) => {
    if (item.readAt) return;
    try {
      await notificationsApi.markRead([item.id]);
      void refresh();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void openPanel()}
        aria-label="Notifications"
        className="relative rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm text-ink-700 transition hover:border-brand-400 hover:text-brand-700"
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-96 rounded-2xl border border-ink-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-900">Notifications</h3>
            <Link href="/settings/notifications" className="text-xs font-semibold text-brand-700 hover:underline">
              Preferences
            </Link>
          </div>
          {unread > 0 ? (
            <button
              type="button"
              onClick={() => void notificationsApi.markAllRead().then(() => refresh())}
              className="mt-1 text-xs font-semibold text-ink-500 hover:text-brand-700"
            >
              Mark all as read
            </button>
          ) : null}
          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-3 text-sm text-ink-500">You're all caught up.</p>
            ) : (
              items.map((item) => {
                const node = (
                  <div
                    onClick={() => void markRead(item)}
                    className={`rounded-xl border p-3 text-sm ${item.readAt ? "border-ink-100 bg-white" : "border-brand-200 bg-brand-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink-800">{item.title}</span>
                      <span className="shrink-0 text-xs text-ink-400">{relativeTime(item.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-ink-600">{item.body}</p>
                  </div>
                );
                return item.link ? (
                  <Link key={item.id} href={item.link} className="block">
                    {node}
                  </Link>
                ) : (
                  <div key={item.id} className="block">
                    {node}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}