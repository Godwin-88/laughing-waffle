import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadEnv } from "../../config/env";
import { isMockMode, verifyStripeSignature } from "./providers";
import { createOrder, getOrderSummary, listMyOrders, mockCompleteOrder, pollOrderStatus } from "./service";
import { confirmOrderPayment } from "./confirm";
import { unauthorized } from "../../lib/errors";

const createOrderSchema = z.object({
  courseSlug: z.string().min(2).max(200),
  provider: z.enum(["stripe", "mpesa", "paypal", "mock"]),
  paymentToken: z.string().optional(),
  phoneNumber: z.string().regex(/^\+?\d{9,15}$/).optional(),
});

function requestOrigin(req: FastifyRequest): string {
  const origin = req.headers.origin ?? req.headers.referer;
  if (origin) return origin.replace(/\/$/, "");
  return loadEnv().WEB_ORIGIN;
}

export function registerCheckoutRoutes(app: FastifyInstance) {
  // ── US-2.2.2 create a paid checkout ────────────────────────
  app.post(
    "/checkout/orders",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const body = createOrderSchema.parse(req.body);
      const result = await createOrder(req.userId, body, requestOrigin(req));
      return reply.send(result);
    },
  );

  // ── My orders / receipts (US-2.2.2 "Orders") ───────────────
  app.get(
    "/orders",
    { preHandler: [app.authenticate] },
    async (req, reply) => reply.send(await listMyOrders(req.userId)),
  );

  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId",
    { preHandler: [app.authenticate] },
    async (req, reply) => reply.send({ order: await getOrderSummary(req.userId, req.params.orderId) }),
  );

  // ── Confirmation polling (M-Pesa STK push: 90s max, 10s cadence) ──
  app.get<{ Params: { orderId: string } }>(
    "/checkout/orders/:orderId/status",
    { preHandler: [app.authenticate] },
    async (req, reply) => reply.send({ order: await pollOrderStatus(req.userId, req.params.orderId) }),
  );

  // ── Mock-mode completion (PAYMENTS_MODE=mock only) ─────────
  app.post<{ Params: { orderId: string } }>(
    "/checkout/orders/:orderId/complete",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!isMockMode()) throw unauthorized("Mock completion is only available when PAYMENTS_MODE=mock.");
      return reply.send(await mockCompleteOrder(req.userId, req.params.orderId));
    },
  );
}

async function confirmFromWebhookBody(body: Record<string, unknown>): Promise<boolean> {
  const stk = (body as { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number } } }).Body?.stkCallback;
  if (!stk?.CheckoutRequestID) return false;
  const { getDb } = await import("../../db/client");
  const { orders } = await import("../../db/schema");
  const { eq } = await import("drizzle-orm");
  const { db } = getDb(loadEnv().DATABASE_URL);
  const rows = await db.select().from(orders).where(eq(orders.providerSessionId, stk.CheckoutRequestID)).limit(1);
  if (rows.length === 0) return false;
  const order = rows[0];
  if (stk.ResultCode === 0) {
    await confirmOrderPayment(order.id, { providerSessionId: stk.CheckoutRequestID, body });
    return true;
  }
  return false;
}

async function findOrderBySessionOrNumber(orderNumber: string, providerSessionId: string) {
  const { getDb } = await import("../../db/client");
  const { orders } = await import("../../db/schema");
  const { or, eq } = await import("drizzle-orm");
  const { db } = getDb(loadEnv().DATABASE_URL);
  const terms = [eq(orders.orderNumber, orderNumber)];
  if (providerSessionId) terms.push(eq(orders.providerSessionId, providerSessionId));
  const rows = await db.select().from(orders).where(or(...terms)).limit(1);
  return rows[0] ?? null;
}

export function registerCheckoutWebhooks(app: FastifyInstance) {
  // ── Stripe webhook (signed) ────────────────────────────────
  app.post<{ Body: Record<string, unknown> }>(
    "/checkout/webhooks/stripe",
    { config: { rawBody: true } },
    async (req, reply) => {
      const env = loadEnv();
      const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
      if (env.STRIPE_WEBHOOK_SECRET) {
        const ok = verifyStripeSignature(
          raw,
          req.headers["stripe-signature"] as string | undefined,
          env.STRIPE_WEBHOOK_SECRET,
        );
        if (!ok) throw unauthorized("Invalid Stripe signature.");
      } else if (!isMockMode()) {
        throw unauthorized("Stripe webhook secret is not configured.");
      }
      const obj = (req.body ?? {}) as {
        type?: string;
        data?: { object?: { id?: string; metadata?: Record<string, string> } };
      };
      const providerSessionId = obj.data?.object?.id;
      const orderNumber = obj.data?.object?.metadata?.order_number;
      if (!orderNumber || !providerSessionId) return reply.send({ received: true });
      const order = await findOrderBySessionOrNumber(orderNumber, providerSessionId);
      if (order) await confirmOrderPayment(order.id, { providerSessionId, body: obj });
      return reply.send({ received: true });
    },
  );

  // ── M-Pesa Daraja STK push callback ───────────────────────
  app.post<{ Body: Record<string, unknown> }>(
    "/checkout/webhooks/mpesa",
    async (req, reply) => {
      const confirmed = await confirmFromWebhookBody(req.body);
      return reply.status(200).send({ ResultCode: 0, ResultDesc: confirmed ? "Success" : "Accepted (ignored)" });
    },
  );

  // ── PayPal webhook ─────────────────────────────────────────
  app.post<{ Body: Record<string, unknown> }>(
    "/checkout/webhooks/paypal",
    { config: { rawBody: true } },
    async (req, reply) => {
      const obj = (req.body ?? {}) as {
        event_type?: string;
        resource?: { id?: string; supplemental_data?: { order_id?: string } };
      };
      const orderNumber = obj.resource?.supplemental_data?.order_id;
      const providerSessionId = obj.resource?.id;
      if (obj.event_type === "CHECKOUT.ORDER.APPROVED" && orderNumber) {
        const order = await findOrderBySessionOrNumber(orderNumber, providerSessionId ?? "");
        if (order && order.provider === "paypal") {
          await confirmOrderPayment(order.id, {
            providerSessionId: order.providerSessionId ?? providerSessionId,
            body: obj,
          });
        }
      }
      return reply.send({ received: true });
    },
  );
}
