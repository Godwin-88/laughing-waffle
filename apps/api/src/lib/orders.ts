import { randomBytes } from "node:crypto";

/** Human-friendly order number: TDS-20260914-3F2A */
export function generateOrderNumber(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(2).toString("hex").toUpperCase();
  return `TDS-${ymd}-${suffix}`;
}

/** Public certificate id: TDS-CERT-9F3A21C4 */
export function generateCertificateNumber(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(4).toString("hex").toUpperCase();
  return `TDS-CERT-${ymd}-${suffix}`;
}

/** E.164 → 254712345678 (M-Pesa PartyA / PhoneNumber). */
export function normalizeMpesaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254")) return digits;
  return `254${digits}`;
}

/** 254712345678 → 2547••12345678 (never expose the full number). */
export function maskMpesaPhone(phone: string): string {
  const normalized = normalizeMpesaPhone(phone);
  return `${normalized.slice(0, 4)}••${normalized.slice(-8)}`;
}

/** 39700 USD → "397.00" (PayPal decimal amount). */
export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** LinkedIn "Add to Profile" deep link (certification section). */
export function linkedinCertificationLink(input: {
  name: string;
  organizationName: string;
  issueYear: number;
  issueMonth: number;
  certId: string;
  certUrl: string;
}): string {
  const params = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: input.name,
    organizationName: input.organizationName,
    issueYear: String(input.issueYear),
    issueMonth: String(input.issueMonth),
    certificationId: input.certId,
    certificationUrl: input.certUrl,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}