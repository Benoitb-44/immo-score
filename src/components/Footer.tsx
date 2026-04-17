export default function Footer() {
  return (
    <footer className="border-t-2 border-ink bg-paper">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
        <p className="font-mono text-xs text-ink-muted">
          © {new Date().getFullYear()} ImmoRank — Données publiques open data
        </p>
        <div className="flex items-center gap-4 flex-wrap">
          <a
            href="/methodologie"
            className="font-mono text-xs text-ink-muted hover:text-ink transition-colors"
          >
            Méthodologie
          </a>
          <p className="font-mono text-xs text-ink-muted">
            Sources : DVF · ADEME · INSEE · Géorisques
          </p>
        </div>
      </div>
    </footer>
  )
}
