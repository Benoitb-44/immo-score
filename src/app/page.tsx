import Link from 'next/link'
import SearchBar from '@/components/SearchBar'

const PROFIL_CARDS = [
  {
    id: 'investisseur',
    label: 'Investisseur',
    badge: 'YIELD',
    headline: 'Rendement locatif brut',
    kpis: 'DVF · loyer médian · taxe foncière',
    desc: 'Identifiez les communes à fort rendement brut (>6 %) avec un marché DVF actif et une fiscalité maîtrisée. Classement par yield brut calculé sur données d\'État.',
    cta: 'Top Investisseur 2026 →',
    href: '/profil/investisseur',
    available: true,
  },
  {
    id: 'primo',
    label: 'Primo-accédant',
    badge: 'ACCÈS',
    headline: 'Accessibilité financière',
    kpis: 'Median Multiple · prix DVF · apport',
    desc: 'Trouvez les communes où le prix d\'achat reste accessible — Median Multiple < 4 — pour un premier achat sans sur-endettement.',
    cta: 'Communes accessibles →',
    href: '/profil/primo',
    available: false,
  },
  {
    id: 'famille',
    label: 'Famille',
    badge: 'VIE',
    headline: 'Équipements & sécurité',
    kpis: 'BPE · écoles · risques naturels',
    desc: 'Localisez les communes bien équipées en écoles, médecins et transports, peu exposées aux risques naturels (Géorisques).',
    cta: 'Communes familles →',
    href: '/profil/famille',
    available: false,
  },
  {
    id: 'retraite',
    label: 'Retraité',
    badge: 'QUALITÉ',
    headline: 'Santé & douceur de vie',
    kpis: 'BPE santé · risques · accessibilité',
    desc: 'Sélectionnez les communes combinant offre de soins complète, risques faibles et prix immobiliers modérés.',
    cta: 'Communes retraite →',
    href: '/profil/retraite',
    available: false,
  },
] as const

const STATS = [
  { value: '35 000', label: 'communes' },
  { value: '6', label: 'sources open data' },
  { value: '4', label: 'profils acheteurs' },
]

const POURQUOI_ITEMS = [
  {
    num: '1',
    titre: 'Les mêmes données, 4 lectures différentes',
    desc: 'Un appartement à Bordeaux n\'est pas « bon » de la même façon pour un investisseur cherchant 6 % brut et pour une famille cherchant une école primaire à 300 m. CityRank pondère différemment les 4 dimensions selon votre profil.',
  },
  {
    num: '2',
    titre: 'Données d\'État, pas d\'estimation',
    desc: 'Yield brut calculé depuis DVF (transactions réelles) et loyers ANIL/Cerema. Taxe foncière OFGL REI 2024. DPE ADEME. Aucun algorithme propriétaire — les sources sont citées sur chaque page.',
  },
  {
    num: '3',
    titre: 'Classement objectif 35 000 communes',
    desc: 'Pas de sélection éditoriale. Chaque commune de France métropolitaine et DROM dispose d\'une fiche avec ses KPI bruts, son rang national et son rang dans le département.',
  },
]

export default function HomePage() {
  return (
    <main className="flex flex-col">

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-14 sm:py-20">
          <p className="font-mono text-xs text-ink-muted mb-4 tracking-widest uppercase">
            Données publiques open data · DVF · DGFiP · INSEE · Cerema
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-ink leading-tight mb-5 max-w-3xl">
            Le score immobilier des 35 000 communes, par profil d&apos;acheteur.
          </h1>
          <p className="text-lg text-ink-muted mb-8 max-w-2xl leading-relaxed">
            Investissez avec les chiffres de l&apos;État. Rendement, taxe foncière, loyer, DPE — calculés à partir de DVF, DGFiP, INSEE et Cerema.
          </p>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-10">
            <Link
              href="/profil/investisseur"
              className="font-mono text-sm font-bold tracking-wider uppercase border-2 border-ink bg-ink text-paper px-5 py-3 hover:bg-paper hover:text-ink transition-colors"
            >
              Voir le top Investisseur 2026 →
            </Link>
            <span className="font-mono text-xs text-ink-muted">
              ou cherchez une commune
            </span>
          </div>

          <SearchBar />
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="border-b-2 border-ink bg-paper-soft">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-3 divide-x-2 divide-ink">
            {STATS.map(({ value, label }) => (
              <div key={label} className="px-4 py-5 text-center">
                <p className="font-display text-2xl sm:text-3xl font-bold text-ink tabular-nums">{value}</p>
                <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 4 Cartes Profils ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-baseline gap-4 mb-8">
            <span className="font-mono text-xs text-ink-muted">PROFILS</span>
            <h2 className="font-display text-2xl font-bold text-ink">Quel est votre projet ?</h2>
            <div className="flex-1 h-px bg-ink" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PROFIL_CARDS.map((card) => (
              <div
                key={card.id}
                className={`border-2 border-ink bg-paper flex flex-col${!card.available ? ' opacity-60' : ''}`}
              >
                {/* Card header */}
                <div className="border-b-2 border-ink px-5 py-3 flex items-center justify-between bg-paper-soft">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-widest uppercase border border-ink px-1.5 py-0.5 text-ink-muted">
                      {card.badge}
                    </span>
                    <p className="font-display font-bold text-ink">{card.label}</p>
                  </div>
                  {!card.available && (
                    <span className="font-mono text-[9px] tracking-widest uppercase text-ink-muted border border-ink-muted px-1.5 py-0.5">
                      Bientôt
                    </span>
                  )}
                </div>

                {/* Card body */}
                <div className="px-5 py-5 flex-1 flex flex-col gap-3">
                  <p className="font-display font-semibold text-ink">{card.headline}</p>
                  <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">{card.kpis}</p>
                  <p className="font-sans text-sm text-ink-muted leading-relaxed flex-1">{card.desc}</p>
                  {card.available ? (
                    <Link
                      href={card.href}
                      className="font-mono text-xs font-bold tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors self-start mt-2"
                    >
                      {card.cta}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-ink-muted mt-2">{card.cta}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pourquoi par profil ? ── */}
      <div className="border-b-2 border-ink bg-paper-soft">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-baseline gap-4 mb-8">
            <span className="font-mono text-xs text-ink-muted">MÉTHODE</span>
            <h2 className="font-display text-2xl font-bold text-ink">Pourquoi par profil ?</h2>
            <div className="flex-1 h-px bg-ink" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {POURQUOI_ITEMS.map((item) => (
              <div key={item.num} className="border-2 border-ink bg-paper p-5">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs text-ink-muted shrink-0 mt-0.5">{item.num}</span>
                  <div>
                    <p className="font-display font-semibold text-ink mb-2">{item.titre}</p>
                    <p className="font-sans text-sm text-ink-muted leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/methodologie"
              className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink-muted hover:text-ink hover:border-ink transition-colors"
            >
              Lire la méthodologie →
            </Link>
            <Link
              href="/departements"
              className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink-muted hover:text-ink hover:border-ink transition-colors"
            >
              Explorer par département →
            </Link>
          </div>
        </div>
      </div>

    </main>
  )
}
