import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Méthodologie du score immobilier | Immo Score',
  description:
    'Comprendre le score Immo Score : 3 dimensions pondérées (Prix DVF 60%, DPE 10%, Risques 30%), agrégation géométrique, normalisation absolue. Sources open data.',
  alternates: {
    canonical: '/methodologie',
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-6">
      <span className="font-mono text-xs text-ink-muted">{index}</span>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <div className="flex-1 h-px bg-ink" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MethodologiePage() {
  return (
    <div className="bg-paper-soft flex-1">

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-3">
            Algorithme · v2.0 · Avril 2026
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight mb-4">
            Comment fonctionne le score ?
          </h1>
          <p className="font-sans text-lg text-ink-muted max-w-2xl leading-relaxed">
            Le score Immo Score mesure l&apos;attractivité immobilière d&apos;une commune sur
            3&nbsp;dimensions pondérées, agrégées en un indice composite 0–100.
          </p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-14">

        {/* ── Section 2 : Architecture globale ── */}
        <section>
          <SectionTitle index="01" title="Architecture globale" />

          <div className="border-2 border-ink bg-paper overflow-x-auto">
            {/* Table header */}
            <div className="grid grid-cols-4 border-b-2 border-ink divide-x-2 divide-ink">
              {['Dimension', 'Source', 'Poids', 'Métrique'].map((h) => (
                <div key={h} className="px-4 py-3 bg-ink">
                  <p className="font-mono text-xs text-paper font-bold tracking-widest uppercase">
                    {h}
                  </p>
                </div>
              ))}
            </div>

            {/* Rows */}
            {[
              {
                dim: 'Prix & marché',
                source: 'DVF — data.gouv.fr',
                poids: '60 %',
                metrique: 'Prix médian/m² + liquidité transactions',
              },
              {
                dim: 'Perf. énergétique',
                source: 'ADEME — data.ademe.fr',
                poids: '10 %',
                metrique: '% logements classés A à E (non-passoires)',
              },
              {
                dim: 'Risques naturels',
                source: 'Géorisques',
                poids: '30 %',
                metrique: 'Malus par niveau de risque recensé',
              },
            ].map((row, i) => (
              <div
                key={row.dim}
                className={`grid grid-cols-4 divide-x-2 divide-ink ${i < 2 ? 'border-b-2 border-ink' : ''}`}
              >
                <div className="px-4 py-4">
                  <p className="font-display font-semibold text-ink text-sm">{row.dim}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="font-mono text-xs text-ink-muted">{row.source}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="font-display text-xl font-bold tabular-nums text-ink">{row.poids}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="font-sans text-sm text-ink-muted leading-relaxed">{row.metrique}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 font-sans text-sm text-ink-muted border-2 border-ink bg-paper px-4 py-3">
            <span className="font-mono font-bold text-ink text-xs tracking-widest uppercase mr-2">
              Agrégation
            </span>
            Géométrique pondérée — les déséquilibres extrêmes entre dimensions sont pénalisés.
          </p>
        </section>

        {/* ── Section 3 : Prix & marché DVF ── */}
        <section>
          <SectionTitle index="02" title="Prix & marché DVF" />

          <div className="border-2 border-ink bg-paper">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                Source : Demandes de Valeurs Foncières 2024 — data.gouv.fr · Poids 60 %
              </p>
            </div>

            <div className="divide-y-2 divide-ink">
              {/* Accessibilité prix */}
              <div className="px-5 py-5">
                <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-2">
                  01 — Accessibilité prix
                </p>
                <p className="font-sans text-sm text-ink leading-relaxed mb-3">
                  Prix médian au m², normalisé sur une échelle absolue ancrée.
                </p>
                <div className="flex flex-wrap gap-4">
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil bas</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">≤ 800 €/m²</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 100/100</p>
                  </div>
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil haut</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">≥ 6 000 €/m²</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 0/100</p>
                  </div>
                </div>
              </div>

              {/* Liquidité */}
              <div className="px-5 py-5">
                <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-2">
                  02 — Liquidité
                </p>
                <p className="font-sans text-sm text-ink leading-relaxed mb-3">
                  Volume de transactions par habitant.
                </p>
                <div className="flex flex-wrap gap-4">
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil bas</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">0 tx</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 0/100</p>
                  </div>
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil haut</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">≥ 0,05 tx/hab</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 100/100</p>
                  </div>
                </div>
              </div>

              {/* Couverture */}
              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">30 510</span> communes sur{' '}
                  <span className="tabular-nums">34 875</span>{' '}
                  <span className="text-ink">(87 %)</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 4 : DPE ── */}
        <section>
          <SectionTitle index="03" title="Performance énergétique DPE" />

          <div className="border-2 border-ink bg-paper">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                Source : ADEME — Diagnostics de Performance Énergétique — data.ademe.fr · Poids 10 %
              </p>
            </div>

            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-sans text-sm text-ink leading-relaxed mb-4">
                  Métrique : part des logements classés A à E (non-passoires thermiques).
                </p>
                <div className="flex flex-wrap gap-4">
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil bas</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">≤ 40 %</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 0/100</p>
                  </div>
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Seuil haut</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">100 %</p>
                    <p className="font-mono text-xs text-ink-muted mt-1">→ 100/100</p>
                  </div>
                </div>
              </div>

              {/* Limites */}
              <div className="px-5 py-5">
                <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-2">
                  Limites connues
                </p>
                <p className="font-sans text-sm text-ink-muted leading-relaxed">
                  La base ADEME ne couvre pas l&apos;ensemble du parc immobilier — elle est biaisée
                  vers les logements mis en vente ou en location récemment. Les logements anciens
                  sont sous-représentés.
                </p>
              </div>

              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">28 668</span> communes{' '}
                  <span className="text-ink">(82 %)</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 5 : Risques ── */}
        <section>
          <SectionTitle index="04" title="Risques naturels" />

          <div className="border-2 border-ink bg-paper">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                Source : Géorisques — base GASPAR + données radon · Poids 30 %
              </p>
            </div>

            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-sans text-sm text-ink leading-relaxed mb-5">
                  Score de 100 diminué par des malus selon le niveau de risque recensé par type.
                  Score minimum : 0/100.
                </p>
                <div className="border-2 border-ink overflow-hidden">
                  <div className="grid grid-cols-2 border-b-2 border-ink divide-x-2 divide-ink bg-ink">
                    <div className="px-4 py-2">
                      <p className="font-mono text-[10px] text-paper tracking-widest uppercase">Niveau</p>
                    </div>
                    <div className="px-4 py-2">
                      <p className="font-mono text-[10px] text-paper tracking-widest uppercase">Malus</p>
                    </div>
                  </div>
                  {[
                    { level: 'Risque MOYEN', malus: '−5 points', color: 'text-score-mid' },
                    { level: 'Risque FORT', malus: '−15 points', color: 'text-score-low' },
                    { level: 'Risque TRÈS FORT', malus: '−20 points', color: 'text-score-low' },
                  ].map((row, i) => (
                    <div
                      key={row.level}
                      className={`grid grid-cols-2 divide-x-2 divide-ink ${i < 2 ? 'border-b-2 border-ink' : ''}`}
                    >
                      <div className="px-4 py-3">
                        <p className={`font-mono text-sm font-bold ${row.color}`}>{row.level}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className="font-display text-xl font-bold tabular-nums text-ink">
                          {row.malus}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">27 175</span> communes{' '}
                  <span className="text-ink">(78 %)</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 6 : Données manquantes ── */}
        <section>
          <SectionTitle index="05" title="Données manquantes" />

          <div className="border-2 border-ink bg-paper p-5">
            <p className="font-sans text-sm text-ink leading-relaxed">
              Quand une commune n&apos;a pas de données pour une dimension, cette dimension est
              exclue du calcul. Le score global est recalculé sur les seules dimensions disponibles,
              avec rééquilibrage automatique des poids. La carte correspondante est affichée en
              grisé sur la fiche commune.
            </p>
          </div>
        </section>

        {/* ── Section 7 : Changelog ── */}
        <section>
          <SectionTitle index="06" title="Changelog" />

          <div className="border-2 border-ink bg-paper divide-y-2 divide-ink">
            {[
              {
                version: 'v2.0',
                date: 'Avril 2026',
                desc: 'Refonte méthodologique complète : agrégation géométrique pondérée, échelle absolue ancrée, métrique DPE % ≤ E (non-passoires), suppression de l\'imputation médiane.',
              },
              {
                version: 'v1.0',
                date: '17 avril 2026',
                desc: 'Lancement avec 3 dimensions (DVF, DPE, Risques). Normalisation par percentile national.',
              },
            ].map((entry) => (
              <div key={entry.version} className="flex flex-col sm:flex-row sm:items-start gap-4 px-5 py-5">
                <div className="shrink-0 flex items-center gap-3">
                  <span className="border-2 border-ink bg-paper-soft px-3 py-1 font-mono text-xs font-bold">
                    {entry.version}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">{entry.date}</span>
                </div>
                <p className="font-sans text-sm text-ink-muted leading-relaxed">{entry.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 8 : Sources ── */}
        <section>
          <SectionTitle index="07" title="Sources" />

          <div className="border-2 border-ink bg-paper divide-y-2 divide-ink">
            {[
              {
                label: 'data.gouv.fr',
                desc: 'Demandes de Valeurs Foncières',
                href: 'https://www.data.gouv.fr/fr/datasets/demandes-de-valeurs-foncieres/',
              },
              {
                label: 'data.ademe.fr',
                desc: 'Diagnostics de Performance Énergétique',
                href: 'https://data.ademe.fr/datasets/dpe-v2-logements-existants',
              },
              {
                label: 'georisques.gouv.fr',
                desc: 'Risques naturels et technologiques',
                href: 'https://www.georisques.gouv.fr/',
              },
              {
                label: 'geo.api.gouv.fr',
                desc: 'Référentiel géographique des communes (COG)',
                href: 'https://geo.api.gouv.fr/communes',
              },
            ].map((src) => (
              <a
                key={src.href}
                href={src.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-5 py-4 hover:bg-paper-soft transition-colors group"
              >
                <div>
                  <p className="font-mono text-sm font-bold text-ink group-hover:text-accent transition-colors">
                    {src.label}
                  </p>
                  <p className="font-sans text-xs text-ink-muted mt-0.5">{src.desc}</p>
                </div>
                <span className="font-mono text-xs text-ink-muted group-hover:text-accent transition-colors shrink-0 ml-4">
                  ↗
                </span>
              </a>
            ))}
          </div>

          <p className="mt-4 font-mono text-xs text-ink-muted">
            Données publiques open data · Mise à jour annuelle
          </p>
        </section>

      </main>
    </div>
  );
}
