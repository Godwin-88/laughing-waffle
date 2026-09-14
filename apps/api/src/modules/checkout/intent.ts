import type { OrderReceipt, PaymentProvider } from "@takwimu/shared";
import { getPaymentProvider, type PaymentClientMetadata } from "./providers";

export interface OrderForPayment {
  orderNumber: string;
  amountCents: number;
  currency: string;
  courseTitle: string;
}

export interface CreateIntentInput {
  provider: PaymentProvider;
  order: OrderForPayment;
  paymentToken?: string | null;
  phoneNumber?: string | null;
  returnUrl: string;
  webhookUrl: string;
}

export async function createPaymentIntent(input: CreateIntentInput): Promise<{
  providerSessionId: string;
  client: PaymentClientMetadata;
  receiptHint?: OrderReceipt;
}> {
  const provider = getPaymentProvider(input.provider);
  return provider.createPayment({
    orderNumber: input.order.orderNumber,
    amountCents: input.order.amountCents,
    currency: input.order.currency,
    courseTitle: input.order.courseTitle,
    paymentToken: input.paymentToken ?? null,
    phoneNumber: input.phoneNumber ?? null,
    returnUrl: input.returnUrl,
    webhookUrl: input.webhookUrl,
  });
}