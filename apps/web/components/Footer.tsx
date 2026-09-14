export function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-ink-900">Takwimu Data School</p>
            <p className="mt-1 text-sm text-ink-500">
              Practical AI & data engineering education for Africa and the world.
            </p>
          </div>
          <nav className="flex gap-6 text-sm text-ink-600">
            <a href="/courses" className="hover:text-brand-700">Courses</a>
            <a href="/login" className="hover:text-brand-700">Sign in</a>
            <a href="/register" className="hover:text-brand-700">Create account</a>
          </nav>
        </div>
        <p className="mt-8 text-xs text-ink-400">
          © {new Date().getFullYear()} Takwimu Data School · Nairobi · Built for builders.
        </p>
      </div>
    </footer>
  );
}