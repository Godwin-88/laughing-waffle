"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OrderSummary } from "@takwimu/shared";
import { checkoutApi, formatPrice, providerLabel } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/** US-2.2.2 — my orders & receipts (paid checkout history). */
export default function OrdersPage() {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    checkoutApi
      .mine()
      .then((res) => setOrders(res.items))
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Could not load orders."));
  }, [user]);

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) return null;

  const statusBadge = (status: OrderSummary["status"]) => {
    const styles: Record<OrderSummary["status"], string> = {
      pending: "bg-amber-50 text-amber-700 border-amber-200",
      paid: "bg-green-50 text-green-700 border-green-200",
      failed: "bg-red-50 text-red-700 border-red-200",
      refunded: "bg-ink-100 text-ink-500 border-ink-200",
    };
    return (
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="mx-auto mt-10 max-w-4xl px-4 sm:px-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Your orders</h1>
        <p className="mt-1 text-sm text-ink-500">Receipts for every course purchase at Takwimu Data School.</p>
      </header>

      {errorMsg ? <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</p> : null}

      <div className="mt-6 space-y-4">
        {orders === null ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-10 text-center">
            <p className="text-lg font-bold text-ink-800">No orders yet</p>
            <p className="mt-1 text-sm text-ink-500">When you buy a course, your receipts will appear here.</p>
            <Link href="/courses" className="mt-4 inline-block rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
              Browse courses →
            </Link>
          </div>
        ) : (
          orders.map((o) => (
            <div key={o.id} className="rounded-2xl border border-ink-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-ink-900">{o.courseTitle}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {o.orderNumber} · {providerLabel(o.provider)} · {o.currency}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-extrabold text-brand-700">{formatPrice(o.amountCents, o.currency)}</span>
                  {statusBadge(o.status)}
                </div>
              </div>
              {o.receipt?.paymentMethod ? (
                <p className="mt-3 text-xs text-ink-500">
                  Paid with {o.receipt.paymentMethod}
                  {o.receipt.last4 ? ` ····· ${o.receipt.last4}` : ""}
                  {o.receipt.mpesaReceipt ? ` · ${o.receipt.mpesaReceipt}` : ""}
                  {o.paidAt ? ` · ${new Date(o.paidAt).toLocaleDateString()}` : ""}
                </p>
              ) : null}
              {o.status === "pending" ? (
                <Link
                  href={`/checkout/${o.id}`}
                  className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
                >
                  Continue payment →
                </Link>
              ) : (
                <Link href={`/courses/${o.courseSlug}/lessons/1`} className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:text-brand-700">
                  Go to course →
                </Link>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}