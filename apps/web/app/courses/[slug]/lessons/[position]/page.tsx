import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catalogueApi } from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { QuickCheck } from "@/components/QuickCheck";
import { VideoPlayer } from "@/components/VideoPlayer";
import { MarkCompleteButton } from "@/components/MarkCompleteButton";
import { GradedQuiz } from "@/components/GradedQuiz";
import { TextLessonCompletion } from "@/components/TextLessonCompletion";
import { DiscussionBoard } from "@/components/DiscussionBoard";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string; position: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, position } = await params;
  try {
    const lesson = await catalogueApi.lesson(slug, Number(position));
    return { title: `${lesson.title} · Takwimu Data School` };
  } catch {
    return { title: "Lesson · Takwimu Data School" };
  }
}

export default async function LessonPage({ params }: Props) {
  const { slug, position } = await params;
  let lesson;
  try {
    lesson = await catalogueApi.lesson(slug, Number(position));
  } catch {
    notFound();
  }
  if (!lesson) notFound();

  const nextPos = lesson.position + 1;
  const hasNext = lesson.totalLessons === null || lesson.position < lesson.totalLessons;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <nav className="text-sm text-ink-500">
        <Link href={`/courses/${slug}`} className="hover:text-brand-700">
          ← Course overview
        </Link>
        <span className="mx-2 text-ink-300">·</span>
        <span>
          Lesson {lesson.lessonNumber ?? lesson.position}
          {lesson.totalLessons ? ` of ${lesson.totalLessons}` : ""}
        </span>
      </nav>

      <article className="mt-6 rounded-3xl border border-ink-200 bg-white p-6 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">{lesson.title}</h1>
        <p className="mt-2 text-brand-700">{lesson.summary}</p>
        <hr className="mt-4 border-ink-200" />
        <div className="mt-6">
          {lesson.kind === "video" && lesson.video ? (
            <div className="mb-8">
              <VideoPlayer lesson={lesson} courseSlug={slug} />
            </div>
          ) : null}
          {/* US-3.2.2 — graded quizzes render the quiz experience (answers never
              ship via the catalogue payload; the attempt API serves them). */}
          {lesson.kind === "quiz" ? (
            <GradedQuiz lessonId={lesson.id} courseSlug={slug} position={lesson.position} />
          ) : (
            <MarkdownView lesson={lesson} />
          )}
        </div>
        <hr className="mt-8 border-ink-200" />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/courses/${slug}`} className="rounded-xl border border-ink-200 px-5 py-2.5 text-sm font-semibold text-ink-700 hover:border-brand-400">
            ← Back to syllabus
          </Link>
          <div className="flex items-center gap-3">
            {lesson.kind === "text" ? <TextLessonCompletion lesson={lesson} courseSlug={slug} /> : null}
            {/* notebook / lab lessons keep a manual control; text/video/quiz auto-complete (US-5.1.1). */}
            {lesson.kind === "notebook" || lesson.kind === "lab" ? (
              <MarkCompleteButton lesson={lesson} courseSlug={slug} />
            ) : null}
            {hasNext ? (
              <Link href={`/courses/${slug}/lessons/${nextPos}`} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
                Next lesson →
              </Link>
            ) : null}
          </div>
        </div>
      </article>

      {lesson.kind !== "quiz" ? <QuickCheck questions={lesson.quizQuestions} /> : null}

      {lesson.kind !== "quiz" ? (
        /* US-6.1.1 — threaded course discussion pinned beneath the lesson content. */
        <DiscussionBoard lessonId={lesson.id} courseSlug={slug} lessonPosition={lesson.position} />
      ) : null}
    </div>
  );
}