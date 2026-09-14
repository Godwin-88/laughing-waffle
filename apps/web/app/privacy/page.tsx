import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · Takwimu Data School" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <div className="prose prose-ink">
        <h1>Privacy Policy</h1>
        <p className="lead">Takwimu Data School — how we collect, use, and protect your data.</p>

        <h2>1. What we store</h2>
        <p>
          When you create an account we store your name, email (always hashed for
          password login), profile interests, and learning progress. Passwords
          are never stored — we keep a salted argon2id hash.
        </p>

        <h2>2. Google &amp; Microsoft sign-in</h2>
        <p>
          Optional SSO never exposes your password to us. We receive only your
          verified email and name from the identity provider, and you can always
          unlink it in your profile.
        </p>

        <h2>3. Payment &amp; certificates</h2>
        <p>
          Payments are processed by a PCI-compliant provider; we never see or
          store card numbers. Certificates include your legal name and email.
        </p>

        <h2>4. Your rights (GDPR)</h2>
        <p>
          You may request access, correction, or deletion of your data at any
          time by contacting{" "}
          <a className="underline" href="mailto:privacy@takwimu.school">privacy@takwimu.school</a>.
        </p>
      </div>
      <p className="mt-8 text-sm text-ink-500">
        Questions?{" "}
        <Link href="/contact" className="font-semibold text-brand-600 hover:text-brand-700">
          Contact us
        </Link>
      </p>
    </div>
  );
}