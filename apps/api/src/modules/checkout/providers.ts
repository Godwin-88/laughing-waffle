import { createHmac, timingSafeEqual } from "node:crypto";
import type { OrderReceipt, PaymentProvider as ProviderName } from "@takwimu/shared";
import { loadEnv } from "../../config/env";
import { centsToDecimal, maskMpesaPhone, normalizeMpesaPhone } from "../../lib/orders";

/**
 * Payment provider adapters (US-2.2.2).
 *
 * Architecture mirrors the SSO scaffold: three live adapters (Stripe, M-Pesa
 * Daraja, PayPal) plus a deterministic in-process mock used when
 * PAYMENTS_MODE=mock (the dev default) — the whole checkout lifecycle can be
 * exercised without external credentials. Live adapters talk to the provider
 * APIs over HTTPS with `fetch`; card numbers are handled by Stripe.js client-side
 * (PCI-DSS — LMS servers only see a token/client secret).
 */

export interface PaymentClientMetadata {
  clientSecret?: string;
  mpesaCheckoutRequestId?: string;
  mpesaPhone?: string;
  paypalApproveUrl?: string;
}

export interface CreatePaymentInput {
  orderNumber: string;
  amountCents: number;
  currency: string;
  courseTitle: string;
  paymentToken?: string | null;
  phoneNumber?: string | null;
  returnUrl: string;
  webhookUrl: string;
}

export interface ConfirmPaymentPayload {
  orderNumber: string;
  amountCents: number;
  currency: string;
  providerSessionId: string;
  /** Raw provider webhook/callback body (already parsed where needed). */
  body?: Record<string, unknown>;
}

export interface PaymentConfirmation {
  confirmed: boolean;
  providerSessionId?: string;
  receipt: OrderReceipt;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly mode: "mock" | "live";
  createPayment(input: CreatePaymentInput): Promise<{
    providerSessionId: string;
    client: PaymentClientMetadata;
    receiptHint?: OrderReceipt;
  }>;
  confirm(input: ConfirmPaymentPayload): Promise<PaymentConfirmation>;
  poll?(input: ConfirmPaymentPayload): Promise<{ paid: boolean; receipt?: OrderReceipt; message?: string }>;
}

function mockReceipt(provider: "stripe" | "mpesa" | "paypal"): OrderReceipt {
  switch (provider) {
    case "stripe":
      return { providerFeeCents: 0, paymentMethod: "Test card", last4: "4242" };
    case "mpesa":
      return { providerFeeCents: 0, paymentMethod: "M-Pesa", mpesaReceipt: `MOCK${Math.floor(Math.random() * 1e6)}` };
    case "paypal":
      return { providerFeeCents: 0, paymentMethod: "PayPal", captureId: `MOCK-CAP-${Date.now()}` };
    default:
      return { providerFeeCents: 0, paymentMethod: "Mock" };
  }
}

class MockProvider implements PaymentProvider {
  readonly mode = "mock" as const;
  constructor(readonly name: "stripe" | "mpesa" | "paypal") {}

  async createPayment(input: CreatePaymentInput) {
    if (this.name === "mpesa") {
      const phone = normalizeMpesaPhone(input.phoneNumber ?? "254712345678");
      return {
        providerSessionId: `MOCK-STK-${Date.now()}`,
        client: { mpesaCheckoutRequestId: `MOCK-STK-${Date.now()}`, mpesaPhone: maskMpesaPhone(phone) },
      };
    }
    if (this.name === "paypal") {
      return {
        providerSessionId: `MOCK-PP-${Date.now()}`,
        client: { paypalApproveUrl: `${input.returnUrl}?mock=1` },
      };
    }
    return {
      providerSessionId: `MOCK-PI-${Date.now()}`,
      client: { clientSecret: `pi_mock_secret_${input.orderNumber}` },
    };
  }

  async confirm(input: ConfirmPaymentPayload): Promise<PaymentConfirmation> {
    return { confirmed: true, providerSessionId: input.providerSessionId, receipt: mockReceipt(this.name) };
  }
}
// ─────────────────────────────────────────────────────────────
// Stripe (PaymentIntent + webhook signature verification)
// ─────────────────────────────────────────────────────────────

const STRIPE_API = "https://api.stripe.com/v1";

async function stripeRequest(secretKey: string, path: string, form: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (Array.isArray(value)) value.forEach((v) => body.append(key, v));
    else body.append(key, value);
  }
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${json?.error?.message ?? text}`);
  return json;
}

class StripeProvider implements PaymentProvider {
  readonly name: ProviderName = "stripe";
  readonly mode = "live" as const;

  async createPayment(input: CreatePaymentInput) {
    const env = loadEnv();
    if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured.");
    const intent = await stripeRequest(env.STRIPE_SECRET_KEY, "/payment_intents", {
      amount: String(input.amountCents),
      currency: input.currency.toLowerCase(),
      "payment_method_types[]": "card",
      description: `Takwimu Data School — ${input.courseTitle} (${input.orderNumber})`,
      "metadata[order_number]": input.orderNumber,
    });
    return {
      providerSessionId: intent.id,
      client: { clientSecret: intent.client_secret },
    };
  }

  /** For signed Stripe webhooks — payment_intent.succeeded is the grant event. */
  async confirm(input: ConfirmPaymentPayload): Promise<PaymentConfirmation> {
    const obj = (input.body ?? {}) as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const type = obj.type;
    const intent = obj.data?.object;
    if (type === "payment_intent.succeeded" && intent?.id === input.providerSessionId) {
      const charges = (intent?.charges as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [];
      const card =
        (charges[0]?.payment_method_details as { card?: Record<string, unknown> } | undefined)?.card ?? {};
      const brand = typeof card.brand === "string" ? card.brand : "Card";
      const last4 = typeof card.last4 === "string" ? card.last4 : "4242";
      const fee = charges[0]?.fee_details as Array<Record<string, unknown>> | undefined;
      const providerFeeCents = Array.isArray(fee)
        ? fee.reduce((sum, f) => sum + Number(f.amount ?? 0), 0)
        : undefined;
      return {
        confirmed: true,
        providerSessionId: String(intent.id),
        receipt: {
          providerFeeCents,
          paymentMethod: branchTitle(brand),
          last4,
        },
      };
    }
    return {
      confirmed: false,
      providerSessionId: input.providerSessionId,
      receipt: {},
      reason: type === "payment_intent.payment_failed" ? "payment_failed" : "unhandled",
    };
  }
}

function branchTitle(brand: string): string {
  const map: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "Amex",
    discover: "Discover",
  };
  return `${map[brand.toLowerCase()] ?? "Card"} card`;
}

// ─────────────────────────────────────────────────────────────
// M-Pesa — Daraja STK push (Safaricom)
// ─────────────────────────────────────────────────────────────

const DARAJA_BASE = "https://sandbox.safaricom.co.ke";

function mpesaTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

async function darajaToken(env: ReturnType<typeof loadEnv>): Promise<string> {
  const res = await fetch(`${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString("base64")}`,
    },
  });
  const json = (await res.json()) as { access_token?: string; errorMessage?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Daraja auth failed (${res.status}): ${json.errorMessage ?? "no token"}`);
  }
  return json.access_token;
}

class MpesaProvider implements PaymentProvider {
  readonly name: ProviderName = "mpesa";
  readonly mode = "live" as const;

  async createPayment(input: CreatePaymentInput) {
    const env = loadEnv();
    if (!env.MPESA_CONSUMER_KEY || !env.MPESA_CONSUMER_SECRET || !env.MPESA_PASSKEY || !env.MPESA_SHORTCODE) {
      throw new Error("M-Pesa Daraja credentials are not configured.");
    }
    const token = await darajaToken(env);
    const timestamp = mpesaTimestamp();
    const password = Buffer.from(
      `${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`,
    ).toString("base64");
    const phone = normalizeMpesaPhone(input.phoneNumber ?? "");
    const payload = {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: String(input.amountCents),
      PartyA: phone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: env.MPESA_CALLBACK_URL ?? input.webhookUrl,
      AccountReference: input.orderNumber,
      TransactionDesc: `Course purchase: ${input.courseTitle}`,
    };
    const res = await fetch(`${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      ResponseCode?: string;
      CheckoutRequestID?: string;
      ResponseDescription?: string;
    };
    if (!res.ok || json.ResponseCode !== "0") {
      throw new Error(`M-Pesa STK push failed (${res.status}): ${json.ResponseDescription ?? "unknown"}`);
    }
    return {
      providerSessionId: json.CheckoutRequestID!,
      client: { mpesaCheckoutRequestId: json.CheckoutRequestID, mpesaPhone: maskMpesaPhone(phone) },
    };
  }

  /** Called from the Daraja STK push callback — ResultCode 0 confirms payment. */
  async confirm(input: ConfirmPaymentPayload): Promise<PaymentConfirmation> {
    const body = (input.body ?? {}) as { Body?: { stkCallback?: Record<string, unknown> } };
    const stk = body.Body?.stkCallback;
    const resultCode = Number(stk?.ResultCode ?? -1);
    if (stk && resultCode === 0) {
      const metadata = (stk.CallbackMetadata as { Item?: Array<{ Name?: string; Value?: unknown }> } | undefined)?.Item ?? [];
      const find = (key: string) => metadata.find((i) => i.Name === key)?.Value;
      const mpesaReceipt = String(find("MpesaReceiptNumber") ?? `X${Date.now()}`);
      const phone = String(find("PhoneNumber") ?? "");
      return {
        confirmed: true,
        providerSessionId: String(stk.CheckoutRequestID ?? input.providerSessionId),
        receipt: {
          paymentMethod: "M-Pesa",
          mpesaReceipt,
          last4: phone ? phone.slice(-4) : undefined,
        },
      };
    }
    return {
      confirmed: false,
      providerSessionId: String(stk?.CheckoutRequestID ?? input.providerSessionId),
      receipt: {},
      reason: stk ? `mpesa_result_${resultCode}` : "unhandled",
    };
  }

  /** US-2.2.2 STK push confirmation polling (Daraja Query endpoint). */
  async poll(input: ConfirmPaymentPayload) {
    const env = loadEnv();
    if (!env.MPESA_SHORTCODE || !env.MPESA_PASSKEY) {
      return { paid: false, message: "M-Pesa not configured" };
    }
    const token = await darajaToken(env);
    const timestamp = mpesaTimestamp();
    const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString("base64");
    const res = await fetch(`${DARAJA_BASE}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: input.providerSessionId,
      }),
    });
    const json = (await res.json()) as { ResultCode?: string; ResultDesc?: string };
    return {
      paid: String(json.ResultCode ?? "") === "0",
      receipt: { paymentMethod: "M-Pesa", mpesaReceipt: `X${Date.now()}` },
      message: json.ResultDesc,
    };
  }
}
// ─────────────────────────────────────────────────────────────
// PayPal (Orders v2 + capture)
// ─────────────────────────────────────────────────────────────

const PAYPAL_API = "https://api-m.sandbox.paypal.com";

async function paypalToken(env: ReturnType<typeof loadEnv>): Promise<string> {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`PayPal auth failed (${res.status}): ${json.error_description ?? "no token"}`);
  }
  return json.access_token;
}

class PayPalProvider implements PaymentProvider {
  readonly name: ProviderName = "paypal";
  readonly mode = "live" as const;

  async createPayment(input: CreatePaymentInput) {
    const env = loadEnv();
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new Error("PayPal credentials are not configured.");
    }
    const token = await paypalToken(env);
    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.orderNumber,
            description: `Takwimu Data School — ${input.courseTitle}`,
            amount: { currency_code: input.currency, value: centsToDecimal(input.amountCents) },
          },
        ],
        application_context: {
          brand_name: "Takwimu Data School",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.returnUrl,
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`PayPal create order failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { id: string; links?: Array<{ rel: string; href: string }> };
    const approve = json.links?.find((l) => l.rel === "approve")?.href;
    return {
      providerSessionId: json.id,
      client: { paypalApproveUrl: approve },
    };
  }

  /** After redirect, the learner returns with ?token=ORDER_ID; capture here. */
  async confirm(input: ConfirmPaymentPayload): Promise<PaymentConfirmation> {
    const env = loadEnv();
    if (!env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_CLIENT_ID) {
      return { confirmed: false, providerSessionId: input.providerSessionId, receipt: {}, reason: "not_configured" };
    }
    const token = await paypalToken(env);
    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${input.providerSessionId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    });
    if (!res.ok) {
      return {
        confirmed: false,
        providerSessionId: input.providerSessionId,
        receipt: {},
        reason: `paypal_capture_${res.status}`,
      };
    }
    const json = (await res.json()) as { status: string; purchase_units?: Array<Record<string, unknown>> };
    const purchaseUnits = json.purchase_units as Array<Record<string, unknown>> | undefined;
    const payments = (
      (purchaseUnits?.[0]?.["payments"] as { captures?: Array<Record<string, unknown>> } | undefined) ?? undefined
    );
    const capture = payments?.captures?.[0];
    return {
      confirmed: json.status === "COMPLETED",
      providerSessionId: input.providerSessionId,
      receipt: {
        paymentMethod: "PayPal",
        captureId: typeof capture?.id === "string" ? capture.id : undefined,
      },
    };
  }
}

/**
 * Verify the raw `Stripe-Signature` header value against our webhook secret
 * (HMAC-SHA256 over `timestamp.payload`, constant-time comparison).
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const parts = new Map<string, string>();
  for (const pair of signatureHeader.split(",")) {
    const [k, v] = pair.trim().split("=");
    if (k && v) parts.set(k, v);
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature) return false;
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getPaymentProvider(provider: ProviderName): PaymentProvider {
  const env = loadEnv();
  if (env.PAYMENTS_MODE === "mock") {
    if (provider === "stripe" || provider === "mpesa" || provider === "paypal") {
      return new MockProvider(provider);
    }
  }
  switch (provider) {
    case "stripe":
      return new StripeProvider();
    case "mpesa":
      return new MpesaProvider();
    case "paypal":
      return new PayPalProvider();
    case "mock":
      return new MockProvider("stripe");
  }
}

export function isMockMode(): boolean {
  return loadEnv().PAYMENTS_MODE === "mock";
}

