/**
 * /profil/investisseur — Page pillar Top 50 Investisseur national
 *
 * ISR revalidate 7 jours. Server Component pur.
 * SEO cible : "investir [ville]", "top investisseur immobilier France 2026"
 */

import { PrismaClient } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTopInvestisseurCommunes } from '@/lib/repositories/investisseur.repository';

export const revalidate = 604800; // ISR 7 jours

export const metadata: Metadata = {
  title: 'Top 50 communes pour investir en 2026 — Yield brut DVF/ANIL | CityRank',
  description:
    'Classement des 50 meilleures communes françaises pour l\'investissement locatif en 2026. Yield brut calculé depuis DVF (prix réels) et loyers ANIL/OLL. Données État.',
  alternates: {
    canonical: '/profil/investisseur',
  },
};

// ─── Prisma singleton ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma_pillar: PrismaClient | undefined;
}

const prisma = globalThis.__prisma_pillar ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma_pillar = prisma;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yieldBadgeClass(pct: number): string {
  if (pct >= 10) return 'bg-score-high text-white'
  if (pct >= 8) return 'bg-score-high text-white'
  if (pct >= 6) return 'bg-score-mid text-white'
  return 'bg-paper-soft text-ink'
}

function yieldBadgeLabel(pct: number): string {
  if (pct >= 10) return 'Extrême'
  if (pct >= 8) return 'Élevé'
  if (pct >= 6) return 'Bon'
  return 'Moyen'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProfilInvestisseurPage() {
  let communes: Awaited<ReturnType<typeof getTopInvestisseurCommunes>> = [];
  try {
    communes = await getTopInvestisseurCommunes(50, prisma);
  } catch {
    // DB indisponible au build → retourne liste vide, ISR régénère
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Top 50 communes investisseur immobilier France 2026',
    description:
      'Classement des communes françaises par rendement locatif brut calculé depuis DVF et loyers ANIL/OLL.',
    url: 'https://cityrank.fr/profil/investisseur',
    numberOfItems: communes.length,
    itemListElement: communes.slice(0, 10).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.nom,
      url: `https://cityrank.fr/communes/${c.slug}/investisseur`,
    })),
  };

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
            Profil Investisseur · Mise à jour 2026 · Données DVF + ANIL/OLL
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight mb-4">
            Top 50 communes pour investir en France
          </h1>
          <p className="font-sans text-lg text-ink-muted max-w-2xl leading-relaxed mb-6">
            Classement par <strong className="text-ink">yield brut indicatif</strong> —
            loyer annuel médian divisé par le prix médian DVF.
            Données publiques officielles : DVF (Etalab), loyers ANIL/Cerema 2023,
            OLAP Paris 2024, OLL Lyon/AMP 2024.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/methodologie#sources"
              className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink hover:bg-ink hover:text-paper transition-colors"
            >
              Méthodologie →
            </Link>
            <Link
              href="/departements"
              className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-1.5 text-ink hover:bg-ink hover:text-paper transition-colors"
            >
              Par département →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Tableau ── */}
      <main className="max-w-5xl mx-auto px-6 py-10">

        {communes.length === 0 ? (
          <div className="border-2 border-ink bg-paper px-6 py-12 text-center">
            <p className="font-mono text-sm text-ink-muted">
              Données en cours de chargement — revenez dans quelques instants.
            </p>
          </div>
        ) : (
          <>
            {/* En-tête tableau */}
            <div className="border-2 border-ink bg-paper overflow-x-auto">
              <div className="grid grid-cols-[2rem_2fr_1fr_1fr_1fr_1fr] border-b-2 border-ink divide-x-2 divide-ink min-w-[620px] bg-ink">
                {['#', 'Commune', 'Dép.', 'Yield brut', 'Prix DVF', 'Loyer'].map((h) => (
                  <div key={h} className="px-3 py-2">
                    <p className="font-mono text-[10px] text-paper tracking-widest uppercase">{h}</p>
                  </div>
                ))}
              </div>

              {communes.map((c, i) => (
                <div
                  key={c.code_insee}
                  className={`grid grid-cols-[2rem_2fr_1fr_1fr_1fr_1fr] divide-x-2 divide-ink min-w-[620px] ${i < communes.length - 1 ? 'border-b-2 border-ink' : ''} hover:bg-paper-soft transition-colors`}
                >
                  {/* Rang */}
                  <div className="px-3 py-3 flex items-center">
                    <span className="font-mono text-xs text-ink-muted tabular-nums">{i + 1}</span>
                  </div>

                  {/* Commune */}
                  <div className="px-3 py-3 flex items-center">
                    <Link
                      href={`/communes/${c.slug}/investisseur`}
                      className="font-display font-semibold text-ink hover:text-accent transition-colors text-sm"
                    >
                      {c.nom}
                    </Link>
                  </div>

                  {/* Département */}
                  <div className="px-3 py-3 flex items-center">
                    <Link
                      href={`/departements/${c.departement}/investisseur`}
                      className="font-mono text-xs text-ink-muted hover:text-ink transition-colors"
                    >
                      {c.departement}
                    </Link>
                  </div>

                  {/* Yield brut */}
                  <div className="px-3 py-3 flex items-center gap-1.5">
                    {c.yield_brut != null ? (
                      <>
                        <span className="font-display text-lg font-bold tabular-nums text-ink">
                          {c.yield_brut.toFixed(1)} %
                        </span>
                        <span className={`font-mono text-[9px] px-1.5 py-0.5 font-bold shrink-0 ${yieldBadgeClass(c.yield_brut)}`}>
                          {yieldBadgeLabel(c.yield_brut)}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-xs text-ink-muted">—</span>
                    )}
                  </div>

                  {/* Prix DVF */}
                  <div className="px-3 py-3 flex items-center">
                    <span className="font-mono text-xs tabular-nums text-ink">
                      {c.prix_m2_median != null
                        ? `${c.prix_m2_median.toLocaleString('fr-FR')} €/m²`
                        : '—'}
                    </span>
                  </div>

                  {/* Loyer */}
                  <div className="px-3 py-3 flex items-center">
                    <span className="font-mono text-xs tabular-nums text-ink">
                      {c.loyer_m2 != null
                        ? `${c.loyer_m2.toFixed(1)} €/m²`
                        : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Note bas de tableau */}
            <div className="mt-4 border-2 border-ink bg-paper p-4">
              <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
                Yield brut = loyer annuel médian (€/m²) / prix médian DVF (€/m²). Indicatif — brut avant charges,
                vacance locative et imposition. Population ≥ 1 000 habitants recommandée pour réduire la volatilité
                statistique des transactions DVF.{' '}
                <Link href="/methodologie#sources" className="underline hover:text-ink transition-colors">
                  Voir la méthode →
                </Link>
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
