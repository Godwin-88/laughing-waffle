import Link from "next/link";
import { catalogueApi } from "@/lib/api";
import { CourseCard } from "@/components/CourseCard";

export const dynamic = "force-dynamic";

const PROGRAMS = [
  {
    icon: "🎓",
    title: "AWS AI Certification Track",
    text: "Two certifications (AIF-C01 + MLA-C01) in one 12-week build-first path: Bedrock, SageMaker, RAG, agents, and MLOps.",
  },
  {
    icon: "🧠",
    title: "AI Engineering",
    text: "From first prompt to production agent: retrieval, tool use, evaluation, and the guardrails that make AI trustworthy.",
  },
  {
    icon: "📊",
    title: "Data & Financial Engineering",
    text: "Python foundations, data wrangling, and the quantitative skills behind modern data-driven products.",
  },
  {
    icon: "🌍",
    title: "Built for African Excellence",
    text: "Practical, affordable, career-first education — taught by practitioners, in English, French, and Swahili.",
  },
];

async function featured() {
  const res = await catalogueApi.list({ sort: "rating", page: 1, pageSize: 3 });
  return res.items;
}

export default async function HomePage() {
  const courses = await featured();

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="grid overflow-hidden rounded-3xl border border-ink-200 bg-gradient-to-br from-ink-900 via-brand-900 to-brand-700 lg:grid-cols-2">
        <div className="p-8 sm:p-12">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100">
            🌍 Takwimu Data School · Nairobi
          </p>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight text-white sm:text-5xl">
            Learn AI the way it&apos;s actually built.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-brand-100">
            Hands-on courses that take you from fundamentals to AWS
            certifications — with real pipelines, real agents, and real
            engineering judgment. <span className="font-semibold text-white">Not flashcards. Systems.</span>
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/courses"
              className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50"
            >
              Browse courses
            </Link>
            <Link
              href="/register"
              className="rounded-xl border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Create free account
            </Link>
          </div>
          <ul className="mt-6 flex flex-wrap gap-2 text-xs text-brand-100">
            <li className="rounded-full bg-white/10 px-3 py-1">🏅 AIF-C01 + MLA-C01</li>
            <li className="rounded-full bg-white/10 px-3 py-1">🧪 50+ hands-on labs</li>
            <li className="rounded-full bg-white/10 px-3 py-1">⌛ Self-paced, 12 weeks</li>
          </ul>
        </div>
        <div className="border-l border-ink-200 p-8 sm:p-12" data-spec="school-info">
          <h2 className="text-sm font-bold uppercase tracking-wider text-brand-100">Why Takwimu Data School</h2>
          <p className="mt-4 text-base leading-relaxed text-brand-50">
            Takwimu means <em className="not-italic font-semibold">data</em> — and our mission is to turn Africa&apos;s
            curiosity into engineering careers. We teach the why before the
            console: every AWS service, every model, every pattern is
            introduced through a problem that motivated its existence.
          </p>
          <p className="mt-3 text-base leading-relaxed text-brand-50">
            Our certification track embeds exam preparation into a
            build-first curriculum, so credentials follow capability — not
            the other way around.
          </p>
        </div>
      </section>

      {/* ── Programs ─────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="text-2xl font-bold text-ink-900">Learning paths</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROGRAMS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-ink-200 bg-white p-5 transition hover:border-brand-300">
              <span className="text-3xl">{p.icon}</span>
              <h3 className="mt-2 text-base font-bold text-ink-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Featured courses ─────────────────────────────────── */}
      {courses.length > 0 ? (
        <section className="mt-14">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-ink-900">Top-rated courses</h2>
            <Link href="/courses" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              View all →
            </Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}