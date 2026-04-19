import type { Metadata } from 'next';

export const revalidate = 604800; // 7 jours

export const metadata: Metadata = {
  title: 'Méthodologie du score | Immo Score',
  description:
    'Comment est calculé le score Immo Score : 4 dimensions (DVF, BPE, Risques, DPE), sources officielles, limitations transparentes. Version v3.1.',
  alternates: {
    canonical: '/methodologie',
  },
};

// ─── JSON-LD ──────────────────────────────────────────────────────────────────

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Méthodologie du score Immo Score v3.1',
  description:
    'Documentation complète de la méthode de calcul du score Immo Score : 4 dimensions, sources open data, limitations.',
  author: { '@type': 'Organization', name: 'Immo Score' },
  datePublished: '2026-04-19',
  dateModified: '2026-04-19',
  url: 'https://immorank.fr/methodologie',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ index, id, title }: { index: string; id: string; title: string }) {
  return (
    <div id={id} className="flex items-baseline gap-4 mb-6 scroll-mt-8">
      <span className="font-mono text-xs text-ink-muted">{index}</span>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <div className="flex-1 h-px bg-ink" />
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-2 border-ink bg-paper px-4 py-3 mt-4">
      <p className="font-sans text-sm text-ink-muted leading-relaxed">{children}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MethodologiePage() {
  return (
    <div className="bg-paper-soft flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-3">
            Algorithme · v3.1 · 19 avril 2026
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight mb-4">
            Méthodologie du score Immo Score
          </h1>
          <p className="font-sans text-lg text-ink-muted max-w-2xl leading-relaxed mb-6">
            Le score Immo Score attribue à chaque commune française une note sur 100 reflétant son
            attractivité immobilière globale. Il combine quatre dimensions objectives à partir de
            données publiques officielles.
          </p>
          {/* Ancres intra-page */}
          <nav aria-label="Sections de la méthodologie">
            <div className="flex flex-wrap gap-2">
              {[
                { href: '#dimensions', label: 'Dimensions' },
                { href: '#sources', label: 'Sources' },
                { href: '#limitations', label: 'Limitations' },
                { href: '#principes', label: 'Principes' },
                { href: '#versions', label: 'Versions' },
              ].map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink hover:bg-ink hover:text-paper transition-colors"
                >
                  {label}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-14">

        {/* ── 01 : Dimensions ── */}
        <section>
          <SectionTitle index="01" id="dimensions" title="Les 4 dimensions du score" />

          <p className="font-sans text-sm text-ink-muted leading-relaxed mb-6 max-w-3xl">
            Le score global est une <strong className="text-ink">moyenne géométrique pondérée</strong>{' '}
            des quatre sous-scores ci-dessous. Un score bas sur une seule dimension pénalise le score
            global — il ne peut pas être intégralement compensé par les autres.
          </p>

          {/* Tableau des dimensions */}
          <div className="border-2 border-ink bg-paper overflow-x-auto">
            <div className="grid grid-cols-[2fr_1fr_3fr] border-b-2 border-ink divide-x-2 divide-ink min-w-[480px]">
              {['Dimension', 'Poids', 'Ce qu\'elle mesure'].map((h) => (
                <div key={h} className="px-4 py-3 bg-ink">
                  <p className="font-mono text-xs text-paper font-bold tracking-widest uppercase">{h}</p>
                </div>
              ))}
            </div>
            {[
              { dim: 'DVF — Marché immobilier', poids: '45 %', mesure: 'Prix au m² et activité des transactions' },
              { dim: 'BPE — Équipements et services', poids: '25 %', mesure: 'Présence d\'écoles, commerces, santé, transports, culture' },
              { dim: 'Risques — Sécurité du territoire', poids: '20 %', mesure: 'Exposition aux inondations, séismes, radon, mouvements de terrain' },
              { dim: 'DPE — Performance énergétique', poids: '10 %', mesure: 'Part de logements correctement isolés' },
            ].map((row, i) => (
              <div
                key={row.dim}
                className={`grid grid-cols-[2fr_1fr_3fr] divide-x-2 divide-ink min-w-[480px] ${i < 3 ? 'border-b-2 border-ink' : ''}`}
              >
                <div className="px-4 py-4">
                  <p className="font-display font-semibold text-ink text-sm">{row.dim}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="font-display text-xl font-bold tabular-nums text-ink">{row.poids}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="font-sans text-sm text-ink-muted leading-relaxed">{row.mesure}</p>
                </div>
              </div>
            ))}
          </div>

          <InfoNote>
            <span className="font-mono font-bold text-ink text-xs tracking-widest uppercase mr-2">
              Agrégation
            </span>
            Géométrique pondérée — un score bas sur une dimension pénalise le résultat global et
            ne peut pas être compensé entièrement par les autres.
          </InfoNote>

          {/* DVF */}
          <div className="border-2 border-ink bg-paper mt-8">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                DVF — Marché immobilier · Poids 45 %
              </p>
            </div>
            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-2">
                  Proximité au prix médian national (70 % du sous-score)
                </p>
                <p className="font-sans text-sm text-ink leading-relaxed mb-4">
                  Une commune dont le prix au m² est proche de la médiane française est considérée
                  comme «&nbsp;accessible et désirable&nbsp;». Les communes très chères et les
                  communes où les prix sont anormalement bas perdent des points.
                </p>
                <div className="border-2 border-ink bg-paper-soft px-4 py-3 inline-block">
                  <p className="font-mono text-xs text-ink-muted mb-1">Formule</p>
                  <p className="font-mono text-sm text-ink">
                    score = 100 × exp(−0.7 × écart relatif à la médiane nationale)
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 mt-4">
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Médiane nationale 2024 — Appartements</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">2 571 €/m²</p>
                  </div>
                  <div className="border-2 border-ink px-4 py-3 bg-paper-soft">
                    <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">Médiane nationale 2024 — Maisons</p>
                    <p className="font-display text-2xl font-bold tabular-nums text-ink">1 723 €/m²</p>
                  </div>
                </div>
              </div>
              <div className="px-5 py-5">
                <p className="font-mono text-xs tracking-widest uppercase text-ink-muted mb-2">
                  Liquidité du marché (30 % du sous-score)
                </p>
                <p className="font-sans text-sm text-ink leading-relaxed">
                  Nombre de transactions rapporté à la population sur les 3 dernières années. Un
                  marché actif signale une demande réelle et une facilité à acheter ou revendre.
                </p>
              </div>
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

          {/* BPE */}
          <div className="border-2 border-ink bg-paper mt-6">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                BPE — Équipements et services · Poids 25 %
              </p>
            </div>
            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-sans text-sm text-ink leading-relaxed mb-4">
                  Le score BPE mesure la présence de <strong className="text-ink">30 équipements essentiels</strong>{' '}
                  répartis en 5 catégories pondérées également.
                </p>
                <div className="border-2 border-ink overflow-x-auto">
                  <div className="grid grid-cols-2 border-b-2 border-ink divide-x-2 divide-ink bg-ink min-w-[400px]">
                    <div className="px-4 py-2"><p className="font-mono text-[10px] text-paper tracking-widest uppercase">Catégorie</p></div>
                    <div className="px-4 py-2"><p className="font-mono text-[10px] text-paper tracking-widest uppercase">Équipements</p></div>
                  </div>
                  {[
                    { cat: 'Éducation', equip: 'Crèche, école primaire, collège, lycée, université' },
                    { cat: 'Santé', equip: 'Médecin généraliste, pharmacie, infirmier, dentiste, hôpital' },
                    { cat: 'Commerces', equip: 'Boulangerie, supermarché, bureau de poste, banque, station-service' },
                    { cat: 'Transport', equip: 'Gare SNCF, arrêt bus, piste cyclable, parking public, accès autoroute' },
                    { cat: 'Culture & sport', equip: 'Bibliothèque, cinéma, théâtre, stade, piscine, salle de sport' },
                  ].map((row, i) => (
                    <div
                      key={row.cat}
                      className={`grid grid-cols-2 divide-x-2 divide-ink min-w-[400px] ${i < 4 ? 'border-b-2 border-ink' : ''}`}
                    >
                      <div className="px-4 py-3">
                        <p className="font-display font-semibold text-ink text-sm">{row.cat}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className="font-sans text-xs text-ink-muted">{row.equip}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-2 border-ink bg-paper-soft px-4 py-3 inline-block mt-4">
                  <p className="font-mono text-xs text-ink-muted mb-1">Formule</p>
                  <p className="font-mono text-sm text-ink">
                    score = (équipements présents / 30) × 100
                  </p>
                </div>
                <p className="font-sans text-xs text-ink-muted mt-3 leading-relaxed">
                  La mesure est <strong className="text-ink">binaire</strong> (présent / absent), non
                  en densité par habitant, pour éviter de surévaluer les petites communes à fort ratio
                  ou les métropoles en valeur absolue.
                </p>
              </div>
              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">34 875</span> communes{' '}
                  <span className="text-ink">(100 %)</span>
                </p>
              </div>
            </div>
          </div>

          {/* Risques */}
          <div className="border-2 border-ink bg-paper mt-6">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                Risques — Sécurité du territoire · Poids 20 %
              </p>
            </div>
            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-sans text-sm text-ink leading-relaxed mb-5">
                  Score de 100 diminué par des malus selon l&apos;exposition de la commune. Un plancher
                  de 10 empêche qu&apos;une commune à forts risques cumulés ne voit son score global effondré.
                </p>
                <div className="border-2 border-ink overflow-x-auto">
                  <div className="grid grid-cols-2 border-b-2 border-ink divide-x-2 divide-ink bg-ink min-w-[320px]">
                    <div className="px-4 py-2"><p className="font-mono text-[10px] text-paper tracking-widest uppercase">Risque</p></div>
                    <div className="px-4 py-2"><p className="font-mono text-[10px] text-paper tracking-widest uppercase">Malus max</p></div>
                  </div>
                  {[
                    { risque: 'Inondation (PPRI très forte)', malus: '−20 points', color: 'text-score-low' },
                    { risque: 'Radon (classe 3)', malus: '−15 points', color: 'text-score-low' },
                    { risque: 'Mouvement de terrain, séismes, arrêtés CatNat', malus: 'Cumulés', color: 'text-score-mid' },
                    { risque: 'Plancher minimum', malus: '10 points', color: 'text-score-high' },
                  ].map((row, i) => (
                    <div
                      key={row.risque}
                      className={`grid grid-cols-2 divide-x-2 divide-ink min-w-[320px] ${i < 3 ? 'border-b-2 border-ink' : ''}`}
                    >
                      <div className="px-4 py-3">
                        <p className="font-sans text-sm text-ink">{row.risque}</p>
                      </div>
                      <div className="px-4 py-3">
                        <p className={`font-display text-xl font-bold tabular-nums ${row.color}`}>{row.malus}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">34 864</span> communes{' '}
                  <span className="text-ink">(99,97 %)</span>
                </p>
              </div>
            </div>
          </div>

          {/* DPE */}
          <div className="border-2 border-ink bg-paper mt-6">
            <div className="border-b-2 border-ink px-5 py-3 bg-ink">
              <p className="font-mono text-xs text-paper tracking-widest uppercase">
                DPE — Performance énergétique · Poids 10 %
              </p>
            </div>
            <div className="divide-y-2 divide-ink">
              <div className="px-5 py-5">
                <p className="font-sans text-sm text-ink leading-relaxed mb-4">
                  Mesure le pourcentage de logements <strong className="text-ink">non-passoires</strong>{' '}
                  (classes A à D) dans la commune. Son poids est volontairement modéré (10 %) en
                  raison des limitations connues de la donnée ADEME.
                </p>
                <div className="border-2 border-ink bg-paper-soft px-4 py-3 inline-block">
                  <p className="font-mono text-xs text-ink-muted mb-1">Formule</p>
                  <p className="font-mono text-sm text-ink">
                    score = clamp((pct_non_passoires − 40) / (100 − 40) × 100, 0, 100)
                  </p>
                </div>
              </div>
              <div className="px-5 py-3 bg-paper-soft">
                <p className="font-mono text-xs text-ink-muted">
                  Couverture :{' '}
                  <span className="font-bold text-ink tabular-nums">31 664</span> communes{' '}
                  <span className="text-ink">(91 %)</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 02 : Sources ── */}
        <section>
          <SectionTitle index="02" id="sources" title="Sources de données" />

          <p className="font-sans text-sm text-ink-muted leading-relaxed mb-6">
            Toutes les données sont <strong className="text-ink">publiques et officielles</strong>.
            Les mises à jour suivent le rythme des opérateurs publics.
          </p>

          <div className="border-2 border-ink bg-paper overflow-x-auto">
            <div className="grid grid-cols-[2fr_1.5fr_1fr_1.5fr] border-b-2 border-ink divide-x-2 divide-ink min-w-[600px]">
              {['Source', 'Opérateur', 'Millésime', 'Couverture'].map((h) => (
                <div key={h} className="px-4 py-3 bg-ink">
                  <p className="font-mono text-xs text-paper font-bold tracking-widest uppercase">{h}</p>
                </div>
              ))}
            </div>
            {[
              { source: 'DVF Etalab — transactions', operateur: 'Ministère de l\'Économie', millesime: '2024', couverture: '30 510 communes (87 %)' },
              { source: 'BPE — équipements', operateur: 'INSEE', millesime: '2024', couverture: '34 875 communes (100 %)' },
              { source: 'Géorisques GASPAR — risques', operateur: 'BRGM / Min. Transition écologique', millesime: '2025', couverture: '34 864 communes (99,97 %)' },
              { source: 'DPE — performance énergétique', operateur: 'ADEME', millesime: '2021–2025', couverture: '31 664 communes (91 %)' },
              { source: 'Code Officiel Géographique', operateur: 'INSEE', millesime: '2026', couverture: '34 875 communes' },
            ].map((row, i) => (
              <div
                key={row.source}
                className={`grid grid-cols-[2fr_1.5fr_1fr_1.5fr] divide-x-2 divide-ink min-w-[600px] ${i < 4 ? 'border-b-2 border-ink' : ''}`}
              >
                <div className="px-4 py-3">
                  <p className="font-display font-semibold text-ink text-sm">{row.source}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="font-sans text-xs text-ink-muted">{row.operateur}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="font-mono text-sm tabular-nums text-ink">{row.millesime}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="font-mono text-xs text-ink-muted">{row.couverture}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-2 border-ink bg-paper divide-y-2 divide-ink mt-6">
            {[
              { label: 'DVF — files.data.gouv.fr/geo-dvf', href: 'https://files.data.gouv.fr/geo-dvf' },
              { label: 'BPE — insee.fr/fr/statistiques/8217527', href: 'https://www.insee.fr/fr/statistiques/8217527' },
              { label: 'Géorisques — georisques.gouv.fr', href: 'https://georisques.gouv.fr' },
              { label: 'DPE — data.ademe.fr/datasets/dpe03existant', href: 'https://data.ademe.fr/datasets/dpe03existant' },
            ].map((src) => (
              <a
                key={src.href}
                href={src.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-5 py-4 hover:bg-paper-soft transition-colors group"
              >
                <p className="font-mono text-sm font-bold text-ink group-hover:text-accent transition-colors">
                  {src.label}
                </p>
                <span className="font-mono text-xs text-ink-muted group-hover:text-accent transition-colors shrink-0 ml-4">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ── 03 : Limitations ── */}
        <section>
          <SectionTitle index="03" id="limitations" title="Limitations connues" />

          <p className="font-sans text-sm text-ink-muted leading-relaxed mb-6 max-w-3xl">
            La rigueur méthodologique impose d&apos;expliciter ce que le score{' '}
            <strong className="text-ink">ne dit pas</strong>.
          </p>

          <div className="space-y-4">
            {[
              {
                id: '01',
                titre: 'Communes d\'Alsace-Moselle (57, 67, 68)',
                texte: 'Ces trois départements utilisent le livre foncier local et ne figurent pas dans la base DVF nationale. Le score DVF est imputé par la médiane du score DVF du Grand Est hors Alsace-Moselle (Ardennes, Aube, Marne, Haute-Marne, Meurthe-et-Moselle, Meuse, Vosges). Environ 900 communes sont concernées. Leur page affiche explicitement « Score DVF imputé ».',
              },
              {
                id: '02',
                titre: 'Biais ADEME sur les grandes villes',
                texte: 'Le dataset DPE ADEME ne reflète pas le parc total mais uniquement les diagnostics effectivement réalisés — majoritairement lors de ventes ou locations récentes, sur-représentées par les logements anciens soumis à la loi Climat. Paris et les métropoles historiques obtiennent des scores DPE artificiellement bas. Le poids modéré de 10 % limite l\'impact de ce biais sur le score global.',
              },
              {
                id: '03',
                titre: 'Couverture BPE communale : 67 %',
                texte: 'La BPE INSEE au niveau communal couvre environ 23 500 communes sur 34 875. Les 11 000 communes absentes sont majoritairement des villages de moins de 200 habitants. Pour ces communes, un score BPE plancher de 10 est appliqué pour ne pas les pénaliser excessivement. Cette limitation sera résolue dans une version future par l\'intégration des données BPE au niveau « bassin de vie » (INSEE BV2022).',
              },
              {
                id: '04',
                titre: 'Communes de moins de 500 habitants',
                texte: 'Pour les communes très peu peuplées, le ratio « transactions / population » est statistiquement instable — quelques ventes suffisent à faire apparaître un marché artificiellement très liquide. Un score de liquidité plancher de 5 est appliqué. Environ 7 000 communes rurales sont concernées.',
              },
              {
                id: '05',
                titre: 'Départements et régions d\'outre-mer (DROM)',
                texte: 'Les DROM disposent de données partielles (DVF limité, DPE partiel, BPE couvrant les principales communes). Les communes isolées peuvent présenter des scores atypiques reflétant soit un vrai déséquilibre local soit une limitation des données disponibles.',
              },
              {
                id: '06',
                titre: 'Communes fusionnées ou récentes',
                texte: 'Le Code Officiel Géographique est mis à jour annuellement. Les fusions de communes sont intégrées au plus tard 12 mois après leur officialisation.',
              },
            ].map((item) => (
              <div key={item.id} className="border-2 border-ink bg-paper">
                <div className="flex items-start gap-4 px-5 py-4">
                  <span className="font-mono text-xs text-ink-muted shrink-0 mt-0.5">{item.id}</span>
                  <div>
                    <p className="font-display font-semibold text-ink mb-2">{item.titre}</p>
                    <p className="font-sans text-sm text-ink-muted leading-relaxed">{item.texte}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 04 : Principes ── */}
        <section>
          <SectionTitle index="04" id="principes" title="Principes méthodologiques" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                num: '1',
                titre: 'Transparence radicale',
                desc: 'Toutes les pondérations, formules et imputations sont documentées et justifiables publiquement.',
              },
              {
                num: '2',
                titre: 'Robustesse avant précision',
                desc: 'Préférence pour une méthode stable sur 34 000 communes plutôt qu\'une méthode parfaite sur un échantillon.',
              },
              {
                num: '3',
                titre: 'Versionnage explicite',
                desc: 'Chaque évolution de la méthode incrémente la version (v1 → v2 → v3.1). Les versions antérieures sont conservées pour audit.',
              },
              {
                num: '4',
                titre: 'Validation distributionnelle',
                desc: 'Chaque nouvelle version est validée sur 25 communes témoins diversifiées avant déploiement public.',
              },
              {
                num: '5',
                titre: 'Explicabilité',
                desc: 'Chaque commune peut être expliquée par ses 4 sous-scores, consultables sur sa fiche individuelle.',
              },
            ].map((p) => (
              <div key={p.num} className="border-2 border-ink bg-paper p-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs text-ink-muted shrink-0 mt-0.5">{p.num}</span>
                  <div>
                    <p className="font-display font-semibold text-ink mb-1">{p.titre}</p>
                    <p className="font-sans text-sm text-ink-muted">{p.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 05 : Versions ── */}
        <section>
          <SectionTitle index="05" id="versions" title="Historique des versions" />

          <div className="border-2 border-ink bg-paper divide-y-2 divide-ink">
            {[
              {
                version: 'v3.1',
                date: '19 avril 2026',
                current: true,
                desc: 'Version actuelle. Intégration de la BPE INSEE, refonte du score DVF en gaussienne centrée médiane, imputation régionale pour Alsace-Moselle et DROM, garde-fous liquidité.',
              },
              {
                version: 'v2',
                date: '17 avril 2026',
                current: false,
                desc: 'Scoring composite DVF / DPE / Risques avec agrégation géométrique et échelle absolue.',
              },
              {
                version: 'v1',
                date: '16 avril 2026',
                current: false,
                desc: 'Premier scoring opérationnel basé sur percentiles relatifs. Déprécié suite à audit.',
              },
            ].map((entry) => (
              <div key={entry.version} className="flex flex-col sm:flex-row sm:items-start gap-4 px-5 py-5">
                <div className="shrink-0 flex items-center gap-3">
                  <span className={`border-2 px-3 py-1 font-mono text-xs font-bold ${entry.current ? 'border-ink bg-ink text-paper' : 'border-ink bg-paper-soft text-ink'}`}>
                    {entry.version}
                  </span>
                  <span className="font-mono text-xs text-ink-muted">{entry.date}</span>
                  {entry.current && (
                    <span className="font-mono text-[10px] tracking-widest uppercase text-score-high border-2 border-score-high px-2 py-0.5">
                      Actuelle
                    </span>
                  )}
                </div>
                <p className="font-sans text-sm text-ink-muted leading-relaxed">{entry.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contact ── */}
        <section className="border-2 border-ink bg-paper px-6 py-6">
          <p className="font-display font-semibold text-ink mb-2">Contact</p>
          <p className="font-sans text-sm text-ink-muted leading-relaxed">
            Pour toute question méthodologique, signaler une erreur sur une commune, ou proposer
            une amélioration :{' '}
            <a
              href="mailto:contact@immorank.fr"
              className="font-mono text-sm text-ink underline hover:text-accent transition-colors"
            >
              contact@immorank.fr
            </a>
          </p>
        </section>

      </main>
    </div>
  );
}
