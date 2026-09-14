"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { OrderSummary, PaymentProvider } from "@takwimu/shared";
import { checkoutApi, formatPrice, providerLabel } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * US-2.2.2 — checkout & confirmation. The order is created from the course
 * page, then the learner confirms the payment here. In mock mode (dev default)
 * the "Pay" button simulates a successful capture via POST /complete; live
 * production mode would drive Stripe.js / PayPal checkout / M-Pesa STK push —
 * the same server-side confirm path is exercised either way.
 */
export default function CheckoutPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const { user, loading } = useAuth();

  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const [paid, setPaid] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider>("stripe");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (deep = false) => {
    try {
      const res = await (deep ? checkoutApi.status(orderId) : checkoutApi.summary(orderId));
      setOrder(res.order);
      if (res.order.status === "paid") {
        setPaid(true);
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not load the order.");
    }
  }, [orderId]);

  useEffect(() => {
    if (!user || !orderId) return;
    if (user.emailVerified === false) {
      setNotice("Verify your email first — orders need a verified account.");
    }
    void load();
    // US-2.2.2 confirmation polling cadence (~5s while pending).
    pollRef.current = window.setInterval(() => {
      void load(true);
    }, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [user, orderId, load]);

  useEffect(() => {
    if (!loading && !user) return;
    if (order?.provider) setProvider(order.provider);
  }, [loading, user, order]);

  const pay = async () => {
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const done = await checkoutApi.complete(orderId);
      setOrder(done.order);
      setPaid(done.order.status === "paid");
      if (done.order.status !== "paid") setErrorMsg("Payment did not confirm yet — try again.");
      if (mode === "live") {
        setNotice("Live provider capture is handled by the provider iframe — check the order status shortly.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong during payment.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-16 text-ink-500">Loading…</div>;
  if (!user) {
    return (
      <div className="mx-auto mt-16 max-w-md px-4 text-center">
        <h1 className="text-2xl font-extrabold text-ink-900">Sign in to complete your order</h1>
        <p className="mt-2 text-sm text-ink-500">You need an account to pay for course access.</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/checkout/${orderId}`)}`}
          className="mt-6 inline-block rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white hover:bg-brand-700"
        >
          Sign in or create an account
        </Link>
      </div>
    );
  }

  const price = order ? formatPrice(order.amountCents, order.currency) : "…";

  return (
    <div className="mx-auto mt-10 max-w-3xl px-4 sm:px-6">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Secure checkout</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">{order?.courseTitle ?? "Your order"}</h1>
        <p className="mt-1 text-sm text-ink-500">
          Order {order?.orderNumber ?? orderId.slice(0, 8)} · {order ? providerLabel(order.provider) : "…"}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-ink-50 p-4 text-sm">
          <dt className="text-ink-500">Course access</dt>
          <dd className="font-semibold text-ink-900">Lifetime · certificate included</dd>
          <dt className="text-ink-500">Amount due</dt>
          <dd className="text-xl font-extrabold text-brand-700">{price}</dd>
          <dt className="text-ink-500">Status</dt>
          <dd className="font-semibold text-ink-900">
            {paid ? (
              <span className="text-green-600">Paid ✓</span>
            ) : order?.status === "pending" ? (
              "Awaiting payment"
            ) : (
              (order?.status ?? "…")
            )}
          </dd>
        </dl>

        {notice ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{notice}</p> : null}
        {errorMsg ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{errorMsg}</p> : null}

        {!paid ? (
          <div className="mt-6">
            <div className="flex flex-wrap gap-2">
              {(["stripe", "mpesa", "paypal"] as PaymentProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    provider === p ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:border-brand-300"
                  }`}
                >
                  {providerLabel(p)}
                </button>
              ))}
            </div>

            {provider === "mpesa" ? (
              <label className="mt-4 block text-sm font-medium text-ink-700">
                M-Pesa phone number
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="254712345678"
                  className="mt-1 block w-full rounded-xl border border-ink-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </label>
            ) : null}

            <button
              type="button"
              onClick={pay}
              disabled={busy || (provider === "mpesa" && phone.length < 9)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Processing payment…" : mode === "mock" ? `Pay ${price} (simulated)` : `Pay ${price}`}
            </button>
            <p className="mt-3 text-center text-xs text-ink-400">
              {mode === "mock" ? "Mock payments mode — no real charge is made." : "Payments are processed by the selected provider."}
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-center">
            <p className="text-lg font-extrabold text-green-700">Payment confirmed 🎉</p>
            <p className="mt-1 text-sm text-green-700/80">
              You now have lifetime access to <span className="font-semibold">{order?.courseTitle}</span>.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                href={`/courses/${order?.courseSlug}/lessons/1`}
                className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
              >
                Start learning →
              </Link>
              <Link href="/orders" className="rounded-xl border border-ink-200 bg-white px-5 py-2.5 text-sm font-semibold text-ink-700 hover:border-brand-400">
                View receipt
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}