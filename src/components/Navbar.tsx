import Link from 'next/link'

const PROFIL_LINKS = [
  { label: 'Investisseur', href: '/profil/investisseur', available: true },
  { label: 'Primo-accédant', href: '/profil/primo', available: false },
  { label: 'Famille', href: '/profil/famille', available: false },
  { label: 'Retraité', href: '/profil/retraite', available: false },
]

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-paper">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 group"
          aria-label="CityRank — Accueil"
        >
          <span className="font-display text-lg font-bold text-ink tracking-tight group-hover:text-accent transition-colors">
            CityRank
          </span>
          <span className="font-mono text-[9px] tracking-widest uppercase border-2 border-ink bg-ink text-paper px-1.5 py-0.5 leading-none">
            BETA
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {/* Profils dropdown — CSS-only via group-hover */}
          <div className="relative group">
            <button
              type="button"
              className="font-mono text-xs text-ink-muted hover:text-ink border-2 border-transparent hover:border-ink px-2.5 py-1.5 transition-colors flex items-center gap-1"
              aria-haspopup="true"
            >
              Profils
              <span className="text-[8px] leading-none">▾</span>
            </button>
            {/* Dropdown panel */}
            <div className="absolute right-0 top-full mt-0.5 w-44 border-2 border-ink bg-paper hidden group-hover:block z-10">
              {PROFIL_LINKS.map(({ label, href, available }) => (
                available ? (
                  <Link
                    key={href}
                    href={href}
                    className="block font-mono text-xs px-4 py-2.5 text-ink hover:bg-ink hover:text-paper transition-colors border-b border-ink last:border-b-0"
                  >
                    {label}
                  </Link>
                ) : (
                  <span
                    key={href}
                    className="block font-mono text-xs px-4 py-2.5 text-ink-muted border-b border-ink last:border-b-0 cursor-not-allowed"
                  >
                    {label}
                    <span className="ml-1 text-[9px] opacity-60">bientôt</span>
                  </span>
                )
              ))}
            </div>
          </div>

          <Link
            href="/departements"
            className="font-mono text-xs text-ink-muted hover:text-ink border-2 border-transparent hover:border-ink px-2.5 py-1.5 transition-colors"
          >
            Départements
          </Link>
        </nav>
      </div>
    </header>
  )
}
