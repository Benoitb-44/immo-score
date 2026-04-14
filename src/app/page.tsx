export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        <p className="font-mono text-sm text-ink-muted mb-4 tracking-widest uppercase">
          MVP en construction
        </p>
        <h1 className="font-display text-5xl font-bold text-ink mb-4 leading-tight">
          Immo Score
        </h1>
        <p className="text-lg text-ink-muted mb-8">
          Le score d&apos;attractivité immobilière de chaque commune de France.
        </p>
        <div className="card-brutal p-6 text-left">
          <p className="font-mono text-xs text-ink-muted mb-2">Sprint 0 — Fondations</p>
          <ul className="space-y-1 font-mono text-sm">
            <li className="flex gap-2">
              <span className="text-score-high">✓</span>
              <span>INFRA-01 — Repo GitHub créé</span>
            </li>
            <li className="flex gap-2">
              <span className="text-score-high">✓</span>
              <span>INFRA-02 — Next.js 14 + Tailwind + TypeScript</span>
            </li>
            <li className="flex gap-2">
              <span className="text-score-high">✓</span>
              <span>INFRA-06 — Système de design Precision Brutalism</span>
            </li>
            <li className="flex gap-2">
              <span className="text-score-mid">○</span>
              <span>INFRA-03 — PostgreSQL + Prisma</span>
            </li>
            <li className="flex gap-2">
              <span className="text-score-mid">○</span>
              <span>INFRA-04 — Docker Compose + CI/CD</span>
            </li>
          </ul>
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          <a href="/design" className="underline hover:text-accent transition-colors">
            → Voir les tokens de design
          </a>
        </p>
      </div>
    </main>
  );
}
