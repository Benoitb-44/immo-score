import Link from 'next/link'
import SearchBar from '@/components/SearchBar'

const EXAMPLE_COMMUNES = [
  { label: 'Bordeaux', slug: 'bordeaux' },
  { label: 'Lyon', slug: 'lyon' },
  { label: 'Rennes', slug: 'rennes' },
  { label: 'Nantes', slug: 'nantes' },
  { label: 'Toulouse', slug: 'toulouse' },
]

const STATS = [
  { value: '34 875', label: 'communes' },
  { value: '3', label: 'sources de données' },
  { value: '0–100', label: 'score national' },
]

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl w-full">

        <p className="font-mono text-xs text-ink-muted mb-4 tracking-widest uppercase">
          Données publiques open data
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-bold text-ink mb-4 leading-tight">
          Explorez l&apos;attractivité immobilière de chaque commune
        </h1>
        <p className="text-lg text-ink-muted mb-10">
          Un score 0–100 basé sur les prix, le DPE, la fiscalité, les équipements et les risques — pour chaque commune de France.
        </p>

        <SearchBar />

        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLE_COMMUNES.map(({ label, slug }) => (
            <Link
              key={slug}
              href={`/communes/${slug}`}
              className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink hover:bg-ink hover:text-paper transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="mt-16 grid grid-cols-3 border-2 border-ink divide-x-2 divide-ink">
          {STATS.map(({ value, label }) => (
            <div key={label} className="px-4 py-5 text-center">
              <p className="font-display text-2xl font-bold text-ink">{value}</p>
              <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted mt-1">{label}</p>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
