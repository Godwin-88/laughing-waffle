import type { Metadata } from "next";
import Link from "next/link";
import { catalogueApi } from "@/lib/api";
import { CourseCard } from "@/components/CourseCard";

export const metadata: Metadata = { title: "Courses · Takwimu Data School" };
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  categories?: string;
  levels?: string;
  durations?: string;
  price?: string;
  sort?: string;
  page?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

function parseFilters(sp: SearchParams) {
  const page = Math.max(1, Number(sp.page ?? 1));
  return {
    q: sp.q,
    categories: sp.categories?.split(",").filter(Boolean) ?? [],
    levels: sp.levels?.split(",").filter(Boolean) ?? [],
    durations: sp.durations?.split(",").filter(Boolean) ?? [],
    price: (sp.price ?? "all") as "free" | "paid" | "all",
    sort: (sp.sort ?? "rating") as string,
    page,
    pageSize: 9,
  };
}

export default async function CoursesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const page = filters.page;

  const data = await catalogueApi.list(filters as never);
  const { items, meta, facets } = data;

  const qs = (patch: Record<string, unknown> = {}) => {
    const params = new URLSearchParams();
    const all: Record<string, string> = {
      q: sp.q ?? "",
      categories: sp.categories ?? "",
      levels: sp.levels ?? "",
      durations: sp.durations ?? "",
      price: sp.price ?? "all",
      sort: sp.sort ?? "rating",
    };
    for (const [k, v] of Object.entries({ ...all, ...patch })) {
      if (v === undefined || v === null || v === "" || v === "all") continue;
      if (k === "page" && String(v) === "1") continue;
      params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `/courses?${s}` : "/courses";
  };

  const toggle = (key: "categories" | "levels" | "durations", value: string) => {
    const current = (sp[key] ?? "").split(",").filter(Boolean);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    return next.join(",");
  };

  const facetHref = (key: "categories" | "levels" | "durations", value: string) =>
    qs({ [key]: toggle(key, value) });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="mt-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Course catalogue</h1>
        <p className="mt-2 text-ink-500">
          {meta.total} course{meta.total === 1 ? "" : "s"} · filter by level, topic, and more.
        </p>
      </header>

      <form method="get" action="/courses" className="mt-6 flex flex-wrap items-center gap-3">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search courses…"
          className="h-10 w-full rounded-xl border border-ink-200 bg-white px-4 text-sm outline-none focus:border-brand-500 sm:w-80"
        />
        <select name="sort" defaultValue={sp.sort ?? "rating"} className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm">
          <option value="rating">Highest rated</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
        <button type="submit" className="h-10 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      <div className="mt-8 grid gap-6 lg:grid-cols-[210px_1fr]">
        <aside className="space-y-4 rounded-2xl border border-ink-200 bg-white p-4">
          <FacetGroup title="Category" items={facets.categories} active={filters.categories} hrefFor={(v) => facetHref("categories", v)} />
          <FacetGroup title="Level" items={facets.levels} active={filters.levels} hrefFor={(v) => facetHref("levels", v)} />
          <FacetGroup title="Duration" items={facets.durationBands} active={filters.durations} hrefFor={(v) => facetHref("durations", v)} />
          <PriceFilter current={filters.price} qs={qs} />
        </aside>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-16 rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-10 text-center">
          <p className="text-lg font-semibold text-ink-700">No courses match those filters.</p>
          <Link href="/courses" className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
            Clear all filters →
          </Link>
        </div>
      ) : null}

      {meta.total > 9 ? (
        <div className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={qs({ page: String(page - 1) })} className="rounded-lg border border-ink-200 px-3 py-1.5 text-ink-600 hover:border-brand-400">
              ← Previous
            </Link>
          ) : null}
          <span className="rounded-lg bg-brand-50 px-3 py-1.5 font-semibold text-brand-800">
            Page {meta.page} of {Math.max(1, Math.ceil(meta.total / 9))}
          </span>
          {meta.hasMore ? (
            <Link href={qs({ page: String(page + 1) })} className="rounded-lg border border-ink-200 px-3 py-1.5 text-ink-600 hover:border-brand-400">
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
function FacetGroup({
  title,
  items,
  active,
  hrefFor,
}: {
  title: string;
  items: { value: string; label: string; count: number }[];
  active: string[];
  hrefFor: (value: string) => string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">{title}</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        {items.map((f) => {
          const on = active.includes(f.value);
          return (
            <Link key={f.value} href={hrefFor(f.value)} className={`rounded-full px-2.5 py-1 ${on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}>
              {f.label} <span className="opacity-60">·{f.count}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PriceFilter({ current, qs }: { current: string; qs: (p: Record<string, unknown>) => string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">Price</h3>
      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { value: "", label: "All" },
          { value: "free", label: "Free" },
          { value: "paid", label: "Paid" },
        ].map((opt) => (
          <Link
            key={opt.value || "all"}
            href={qs({ price: opt.value })}
            className={`rounded-full px-3 py-1 ${current === (opt.value || "all") ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
          >
            {opt.label}
          </Link>
        ))}
      </div>
    </div>
  );
}