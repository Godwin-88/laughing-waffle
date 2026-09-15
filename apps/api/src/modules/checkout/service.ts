import { and, desc, eq } from "drizzle-orm";
import type { CheckoutOrderResponse, CreateOrderPayload, OrderListResponse, OrderSummary, PaymentGateway, PaymentProvider } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { getDb } from "../../db/client";
import { courses, enrolments, orders, users } from "../../db/schema";
import { badRequest, notFound, unauthorized } from "../../lib/errors";
import { emitAnalyticsEvent } from "../../lib/events";
import { generateOrderNumber } from "../../lib/orders";
import { getConfig } from "../../lib/config";
import { createPaymentIntent } from "./intent";
import { confirmOrderPayment, refreshPendingOrder } from "./confirm";
import type { PaymentClientMetadata } from "./providers";

export interface OrderSummaryRow {
  order: typeof orders.$inferSelect;
  courseSlug: string;
  courseTitle: string;
  userEmail: string;
  userFirstName: string;
}

export async function createOrder(
  userId: string,
  input: CreateOrderPayload,
  requestOrigin: string,
): Promise<CheckoutOrderResponse> {
  const { db } = getDb(loadEnv().DATABASE_URL);

  const courseRows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, input.courseSlug), eq(courses.status, "published")))
    .limit(1);
  const course = courseRows[0];
  if (!course) throw notFound("Course not found.");
  if (course.priceCents <= 0) throw badRequest("This course is free — enrol directly.");

  // US-7.1.2 payment-gateway toggles: block disabled providers at checkout.
  if (input.provider !== "mock") {
    const cfg = await getConfig();
    if (!cfg.payments.enabledGateways.includes(input.provider as PaymentGateway)) {
      throw badRequest("This payment method is currently unavailable. Choose another.", {
        code: "provider_disabled",
        provider: input.provider,
      });
    }
  }

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw unauthorized();

  const enrolled = await db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, course.id)))
    .limit(1);
  if (enrolled.length > 0) {
    throw badRequest("You are already enrolled in this course.", { code: "already_enrolled" });
  }

  // Reuse an existing pending order instead of creating a duplicate checkout.
  const dup = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.courseId, course.id), eq(orders.status, "pending")))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (dup[0]) {
    return orderResponse(dup[0], course.slug, course.title, user.email, user.firstName);
  }

  const orderNumber = generateOrderNumber();
  const env = loadEnv();
  const webhookBase = `${env.PUBLIC_API_URL}/api/v1/checkout/webhooks`;
  const returnUrl = `${requestOrigin}/courses/${course.slug}/checkout?success=1`;

  const created = await createPaymentIntent({
    provider: input.provider as PaymentProvider,
    order: {
      orderNumber,
      amountCents: course.priceCents,
      currency: course.currency,
      courseTitle: course.title,
    },
    paymentToken: input.paymentToken ?? null,
    phoneNumber: input.phoneNumber ?? null,
    returnUrl,
    webhookUrl: `${webhookBase}/${providerWebhookName(input.provider as PaymentProvider)}`,
  });

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber,
      userId,
      courseId: course.id,
      provider: input.provider as PaymentProvider,
      providerSessionId: created.providerSessionId,
      amountCents: course.priceCents,
      currency: course.currency,
      status: "pending",
    })
    .returning();

  emitAnalyticsEvent({
    eventName: "checkout_started",
    userId,
    courseId: course.id,
    payload: { provider: input.provider, amountCents: course.priceCents },
  });

  return orderResponse(order, course.slug, course.title, user.email, user.firstName, created.client);
}

function providerWebhookName(provider: PaymentProvider): string {
  if (provider === "mpesa") return "mpesa";
  if (provider === "paypal") return "paypal";
  return "stripe";
}

async function orderResponse(
  order: typeof orders.$inferSelect,
  courseSlug: string,
  courseTitle: string,
  userEmail: string,
  userFirstName: string,
  client: PaymentClientMetadata = {},
): Promise<CheckoutOrderResponse> {
  const env = loadEnv();
  return {
    order: toSummary({ order, courseSlug, courseTitle, userEmail, userFirstName }),
    mode: env.PAYMENTS_MODE,
    client: {
      clientSecret: client.clientSecret,
      mpesaCheckoutRequestId: client.mpesaCheckoutRequestId,
      mpesaPhone: client.mpesaPhone,
      paypalApproveUrl: client.paypalApproveUrl,
    },
    paid: order.status === "paid",
  };
}

export function toSummary(row: OrderSummaryRow): OrderSummary {
  return {
    id: row.order.id,
    orderNumber: row.order.orderNumber,
    courseSlug: row.courseSlug,
    courseTitle: row.courseTitle,
    provider: row.order.provider as OrderSummary["provider"],
    amountCents: row.order.amountCents,
    currency: row.order.currency,
    status: row.order.status as OrderSummary["status"],
    failureReason: row.order.failureReason,
    receipt: row.order.receipt ?? {},
    paidAt: row.order.paidAt ? row.order.paidAt.toISOString() : null,
    createdAt: row.order.createdAt.toISOString(),
  };
}
export async function getOrderSummary(userId: string, orderId: string): Promise<OrderSummary> {
  const row = await loadMine(userId, orderId);
  if (!row) throw notFound("Order not found.");
  return toSummary(row);
}

/** GET /checkout/orders/:id/status — the US-2.2.2 confirmation polling endpoint. */
export async function pollOrderStatus(userId: string, orderId: string): Promise<OrderSummary> {
  const { db } = getDb(loadEnv().DATABASE_URL);
  const row = await loadMine(userId, orderId);
  if (!row) throw notFound("Order not found.");

  if (row.order.status === "pending" && row.order.providerSessionId) {
    const outcome = await refreshPendingOrder(row);
    if (outcome === "confirmed") {
      await confirmOrderPayment(orderId, { userId, providerSessionId: row.order.providerSessionId ?? undefined, force: true });
      const fresh = await loadMine(userId, orderId);
      return toSummary(fresh ?? row);
    }
    if (outcome === "failed") {
      await db.update(orders).set({ status: "failed", updatedAt: new Date() }).where(eq(orders.id, row.order.id));
    }
  }

  const fresh = await loadMine(userId, orderId);
  return toSummary(fresh ?? row);
}

async function loadMine(userId: string, orderId: string): Promise<OrderSummaryRow | null> {
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
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listMyOrders(userId: string): Promise<OrderListResponse> {
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
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));
  return { items: rows.map(toSummary) };
}

/** Mock-mode completion used by the dev/dev-complete route and local e2e tests. */
export async function mockCompleteOrder(userId: string, orderId: string): Promise<{ order: OrderSummary; confirmed: boolean }> {
  const result = await confirmOrderPayment(orderId, { userId, force: true });
  return { order: toSummary(result.order), confirmed: result.confirmed };
}