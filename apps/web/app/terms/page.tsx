import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms · Takwimu Data School" };

export default function TermsPage() {
  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <div className="prose prose-ink">
        <h1>Terms of Service</h1>
        <p className="lead">The ground rules for using Takwimu Data School.</p>

        <h2>1. Accounts</h2>
        <p>
          One person, one account. You&apos;re responsible for keeping your
          credentials private and for all activity under your account.
        </p>

        <h2>2. Courses &amp; certificates</h2>
        <p>
          Certificates are issued when you complete the required lessons and
          assessments. They verify achievement of the listed learning objectives,
          not attendance at any particular institution.
        </p>

        <h2>3. Acceptable use</h2>
        <p>
          Don&apos;t share your access, resell course material, or use the
          platform to harass staff or fellow learners.
        </p>

        <h2>4. Changes</h2>
        <p>
          We may update these terms as the platform evolves. Material changes
          will be emailed to your registered address.
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