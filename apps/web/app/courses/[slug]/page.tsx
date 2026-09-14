import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CourseDetail } from "@takwimu/shared";
import { catalogueApi, formatPrice, skillLabel } from "@/lib/api";
import { EnrollCard } from "@/components/EnrollCard";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const course = await catalogueApi.detail(slug);
    return { title: `${course.title} · Takwimu Data School`, description: course.tagline };
  } catch {
    return { title: "Course · Takwimu Data School" };
  }
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug } = await params;
  let course: CourseDetail | undefined;
  try {
    course = await catalogueApi.detail(slug);
  } catch {
    notFound();
  }
  if (!course) notFound();

  const totalLessons = course.modules.reduce((n, m) => n + m.lessonCount, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="mt-6 overflow-hidden rounded-3xl border border-ink-200 bg-gradient-to-br from-ink-900 to-brand-900 p-8 sm:p-10">
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded-full bg-white/15 px-3 py-1 text-brand-100">
            {skillLabel(course.skillLevel)}
          </span>
          {course.certificationLabel ? (
            <span className="rounded-full bg-accent-500/20 px-3 py-1 text-accent-500">🏅 {course.certificationLabel}</span>
          ) : null}
          {course.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full bg-white/10 px-3 py-1 text-brand-100">#{t}</span>
          ))}
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{course.title}</h1>
        <p className="mt-3 text-lg text-brand-100">{course.tagline}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="#syllabus" className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-brand-700 transition hover:bg-brand-50">
            View syllabus
          </Link>
          <span className="text-sm text-brand-100">
            {course.durationWeeks} weeks · {totalLessons > 0 ? `${totalLessons} lesson${totalLessons === 1 ? "" : "s"}` : "content in progress"} · {course.instructor}
          </span>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <h2 className="text-xl font-bold text-ink-900">What you&apos;ll learn</h2>
          <ul className="mt-3 space-y-2">
            {course.objectives.map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-[15px] leading-relaxed text-ink-700">
                <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-black text-white">✓</span>
                {o}
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-xl font-bold text-ink-900">About the instructor</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-700">
            <span className="font-semibold text-ink-900">{course.instructor}.</span> {course.instructorBio}
          </p>
        </div>

        <EnrollCard course={course} />
      </section>

      <section id="syllabus" className="mt-10 scroll-mt-20">
        <h2 className="text-2xl font-bold text-ink-900">Syllabus</h2>
        <p className="mt-1 text-sm text-ink-500">
          {course.modules.length} modules · {totalLessons > 0 ? `${totalLessons} published lesson${totalLessons === 1 ? "" : "s"}` : "lessons being authored"} · self-paced
        </p>
        <div className="mt-6 space-y-3">
          {course.modules.map((m) => (
            <details key={m.id} className="group rounded-2xl border border-ink-200 bg-white open:bg-brand-50">
              <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl p-4 text-left">
                <span className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-sm font-bold text-brand-700">
                    {m.position}
                  </span>
                  <span className="font-semibold text-ink-900">{m.title}</span>
                </span>
                <span className="flex items-center gap-1 text-xs text-ink-500">
                  {m.examCoverage ? <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-accent-600">{m.examCoverage}</span> : null}
                  {m.lessonCount > 0 ? <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-600">{m.lessonCount} lesson{m.lessonCount === 1 ? "" : "s"}</span> : <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-500">in progress</span>}
                  <span className="text-ink-400">⌄</span>
                </span>
              </summary>
              <div className="border-t border-ink-200 p-4 text-sm leading-relaxed text-ink-700">
                <p className="font-medium text-ink-900">{m.hook}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {m.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
                {m.week ? <p className="mt-2 text-xs text-ink-400">Scheduled for week {m.week} · ~{m.hoursEstimate ?? "—"} hrs</p> : null}
                {m.lessonCount > 0 ? (
                  <Link href={`/courses/${course.slug}/lessons/1`} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                    ▶&nbsp; Start Lesson 1
                  </Link>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </section>

      {course.related.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink-900">Related courses</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {course.related.map((r) => (
              <Link key={r.id} href={`/courses/${r.slug}`} className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-400 hover:text-brand-700">
                {r.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}