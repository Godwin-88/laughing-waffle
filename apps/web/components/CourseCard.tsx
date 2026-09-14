import Link from "next/link";
import type { CourseSummary } from "@takwimu/shared";
import { formatPrice, skillLabel } from "@/lib/api";

export function CourseCard({ course }: { course: CourseSummary }) {
  return (
    <Link
      href={`/courses/${course.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md"
    >
      <div className="grid aspect-[16/9] w-full place-items-center bg-ink-100">
        {course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.coverImageUrl} alt={course.title} className="h-full w-full object-cover" />
        ) : (
          <span className="text-4xl">📘</span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-1.5 text-[11px] font-medium">
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
            {skillLabel(course.skillLevel)}
          </span>
          {course.certificationLabel ? (
            <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-accent-600">
              🏅 {course.certificationLabel}
            </span>
          ) : null}
        </div>
        <h3 className="text-base font-bold leading-snug text-ink-900 group-hover:text-brand-700">
          {course.title}
        </h3>
        <p className="line-clamp-2 text-sm text-ink-500">{course.tagline}</p>
        <div className="mt-auto flex items-center justify-between text-xs text-ink-500">
          <span>{course.durationWeeks} weeks · {course.instructor}</span>
          <span className="font-semibold text-brand-700">{formatPrice(course.priceCents, course.currency)}</span>
        </div>
        {course.ratingCount > 0 ? (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-accent-500">★</span>
            <span className="font-medium text-ink-700">{course.rating.toFixed(1)}</span>
            <span className="text-ink-400">({course.ratingCount})</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}