import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NotFoundPage() {
  return (
    <div className="mx-auto mt-20 max-w-md text-center">
      <p className="text-6xl">🧭</p>
      <h1 className="mt-4 text-3xl font-extrabold text-ink-900">Page not found</h1>
      <p className="mt-2 text-ink-600">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <Link href="/" className="mt-6 inline-block rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700">
        Back to home
      </Link>
    </div>
  );
}