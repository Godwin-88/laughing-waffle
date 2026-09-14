import { and, eq } from "drizzle-orm";
import type { OrderReceipt, PaymentProvider } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, orders, users } from "../../db/schema";
import { emitAnalyticsEvent } from "../../lib/events";
import { getMailer } from "../../mail/mailer";
import { formatMoney } from "../../lib/orders";
import type { OrderSummaryRow } from "./service";
import { getPaymentProvider } from "./providers";

/**
 * Payment confirmation core (US-2.2.2).
 * Every entry point — webhook, mock-complete route, or polling refresh —
 * funnels through confirmOrderPayment which is idempotent: a second
 * confirmation for the same order simply returns the already-paid summary.
 */

export async function loadOrderRow(orderId: string, userId?: string): Promise<OrderSummaryRow> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db
    .select({
      order: orders,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      userEmail: users.email,
      userFirstName: users.firstName,
    })
    .from(orders)
    .innerJoin(courses, eq(orders.courseId, courses.id))
    .innerJoin(users, eq(orders.userId, users.id))
    .where(and(eq(orders.id, orderId), userId ? eq(orders.userId, userId) : undefined))
    .limit(1);
  return rows[0] ?? null;
}

export async function confirmOrderPayment(
  orderId: string,
  opts: {
    userId?: string;
    providerSessionId?: string;
    body?: Record<string, unknown>;
    /** Force-confirm regardless of provider (mock-mode dev shortcut). */
    force?: boolean;
  } = {},
): Promise<{ order: OrderSummaryRow; confirmed: boolean; alreadyPaid: boolean }> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const row = await loadOrderRow(orderId, opts.userId);
  if (!row) throw Object.assign(new Error("Order not found."), { statusCode: 404 });

  if (row.order.status === "paid") {
    return { order: row, confirmed: true, alreadyPaid: true };
  }
  if (row.order.status === "refunded") {
    return { order: row, confirmed: false, alreadyPaid: false };
  }

  let receipt: OrderReceipt = {};
  let confirmed = Boolean(opts.force);

  if (!confirmed) {
    const provider = getPaymentProvider(row.order.provider as PaymentProvider);
    const result = await provider.confirm({
      orderNumber: row.order.orderNumber,
      amountCents: row.order.amountCents,
      currency: row.order.currency,
      providerSessionId: opts.providerSessionId ?? row.order.providerSessionId ?? "",
      body: opts.body,
    });
    confirmed = result.confirmed;
    receipt = result.receipt ?? {};
  }

  if (!confirmed) {
    await db
      .update(orders)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(orders.id, row.order.id));
    return { order: row, confirmed: false, alreadyPaid: false };
  }

  const mergedReceipt = { ...row.order.receipt, ...receipt };
  await db
    .update(orders)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date(), receipt: mergedReceipt })
    .where(eq(orders.id, row.order.id));

  await db
    .insert(enrolments)
    .values({
      userId: row.order.userId,
      courseId: row.order.courseId,
      status: "enrolled",
      pricePaidCents: row.order.amountCents,
    })
    .onConflictDoNothing({ target: [enrolments.userId, enrolments.courseId] });

  emitAnalyticsEvent({
    eventName: "course_enrolled",
    userId: row.order.userId,
    courseId: row.order.courseId,
    payload: {
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      provider: row.order.provider,
      amountCents: row.order.amountCents,
    },
  });

  // US-2.2.2 — purchase confirmation email within 60 seconds of payment.
  const env = loadEnv();
  try {
    await getMailer().sendEmail({
      to: row.userEmail,
      subject: `Your ${row.courseTitle} receipt (${row.order.orderNumber})`,
      text:
        `Hi ${row.userFirstName},\n\n` +
        `Thank you for purchasing ${row.courseTitle}!\n\n` +
        `Order:   ${row.order.orderNumber}\n` +
        `Amount:  ${formatMoney(row.order.amountCents, row.order.currency)}\n` +
        `Payment: ${row.order.provider}\n` +
        `Reference: ${row.order.providerSessionId ?? "-"}\n\n` +
        `Access has been granted to your account. This email is your receipt — ` +
        `it is also stored under Orders in your dashboard.\n\n` +
        `— ${env.SMTP_FROM}`,
    });
  } catch (err) {
    console.warn("[checkout] receipt email failed:", err);
  }

  return { order: { ...row, order: { ...row.order, status: "paid", paidAt: new Date(), receipt: mergedReceipt } }, confirmed: true, alreadyPaid: false };
}

/** Refresh a pending order against the live provider (M-Pesa polling). */
export async function refreshPendingOrder(row: OrderSummaryRow): Promise<"confirmed" | "failed" | "pending"> {
  const provider = getPaymentProvider(row.order.provider as PaymentProvider);
  if (row.order.provider !== "mpesa" || !provider?.poll) return "pending";
  const result = await provider.poll({
    orderNumber: row.order.orderNumber,
    amountCents: row.order.amountCents,
    currency: row.order.currency,
    providerSessionId: row.order.providerSessionId ?? "",
  });
  if (result.paid) return "confirmed";
  if (result.message) {
    const message = String(result.message).toLowerCase();
    if (message.includes("request cancelled") || message.includes("failed")) return "failed";
  }
  return "pending";
}