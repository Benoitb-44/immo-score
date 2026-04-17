import Link from 'next/link'

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-paper">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
        <Link
          href="/"
          className="flex items-center gap-2.5 group"
          aria-label="ImmoRank — Accueil"
        >
          <span className="font-display text-lg font-bold text-ink tracking-tight group-hover:text-accent transition-colors">
            ImmoRank
          </span>
          <span className="font-mono text-[9px] tracking-widest uppercase border-2 border-ink bg-ink text-paper px-1.5 py-0.5 leading-none">
            BETA
          </span>
        </Link>
      </div>
    </header>
  )
}
