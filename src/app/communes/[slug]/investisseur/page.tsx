/**
 * /communes/[slug]/investisseur — Page Investisseur MVP V0
 *
 * ISR revalidate 7 jours. Server Component pur (pas de 'use client').
 * generateStaticParams : top 500 communes par volume DVF × loyer disponible.
 * Pré-remplit RentalCalculator avec les données de la commune.
 */

import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import InvestisseurKPI from '@/components/InvestisseurKPI';
import RentalCalculator from '@/components/RentalCalculator';
import { getInvestisseurKPI, getStaticParamsTop500 } from '@/lib/repositories/investisseur.repository';
import { getLoyerForCommune } from '@/lib/repositories/loyer.repository';
import { getTaxeFonciereForCommune } from '@/lib/repositories/taxe-fonciere.repository';
import { getRpLogementForCommune } from '@/lib/repositories/rp-logement';
import { DEFAULT_SURFACE } from '@/lib/constants/market-rates';

export const revalidate = 604800; // ISR 7 jours

// ─── Prisma singleton ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma_inv: PrismaClient | undefined;
}

const prisma = globalThis.__prisma_inv ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma_inv = prisma;

// ─── generateStaticParams ─────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    return await getStaticParamsTop500(prisma);
  } catch {
    return [];
  }
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const commune = await prisma.commune.findUnique({
    where: { slug: params.slug },
    select: { nom: true, departement: true },
  });

  if (!commune) return { title: 'Commune introuvable' };

  return {
    title: `Investir à ${commune.nom} (${commune.departement}) : Yield, Loyer, Taxe foncière — KPI Investisseur 2026`,
    description: `Données investisseur pour ${commune.nom} : yield brut DVF/ANIL, prix médian, loyer observé, taxe foncière OFGL. Simulateur de rentabilité locative intégré.`,
    alternates: {
      canonical: `/communes/${params.slug}/investisseur`,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommuneInvestisseurPage({
  params,
}: {
  params: { slug: string };
}) {
  const commune = await prisma.commune.findUnique({
    where: { slug: params.slug },
    select: {
      code_insee: true,
      nom: true,
      departement: true,
      region: true,
      population: true,
      slug: true,
      lat: true,
      lng: true,
    },
  });

  if (!commune) notFound();

  const [kpi, loyer, taxeFonciere, rpLogement, filosofiData] = await Promise.all([
    getInvestisseurKPI(commune.code_insee, prisma),
    getLoyerForCommune(commune.code_insee, prisma),
    getTaxeFonciereForCommune(commune.code_insee, prisma),
    getRpLogementForCommune(commune.code_insee, prisma).catch(() => null),
    prisma.$queryRaw<{ nb_logements: number | null; surface_moy: number | null }[]>`
      SELECT nb_logements, surface_moy
      FROM immo_score.insee_filosofi
      WHERE code_commune = ${commune.code_insee}
      LIMIT 1
    `.catch(() => [] as { nb_logements: number | null; surface_moy: number | null }[]),
  ]);

  const filosofiRow = Array.isArray(filosofiData) ? filosofiData[0] ?? null : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: commune.nom,
    description: `Données investisseur immobilier pour ${commune.nom} (${commune.departement})`,
    ...(commune.lat != null && commune.lng != null && {
      geo: {
        '@type': 'GeoCoordinates',
        latitude: commune.lat,
        longitude: commune.lng,
      },
    }),
    additionalProperty: [
      ...(kpi?.yield_brut != null ? [{
        '@type': 'PropertyValue',
        name: 'Rendement locatif brut',
        value: kpi.yield_brut,
        unitCode: 'P1',
        unitText: '%',
        description: `Yield brut ${commune.nom} calculé depuis DVF × loyer ${kpi.loyer_source ?? 'ANIL'} — surface ${DEFAULT_SURFACE} m²`,
      }] : []),
      ...(kpi?.prix_m2_median != null ? [{
        '@type': 'PropertyValue',
        name: 'Prix médian DVF',
        value: kpi.prix_m2_median,
        unitCode: 'EUR',
        unitText: '€/m²',
      }] : []),
    ],
  };

  return (
    <div className="bg-paper-soft flex-1">

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-8">

          {/* Breadcrumb */}
          <nav aria-label="Fil d'Ariane" className="font-mono text-xs text-ink-muted mb-5">
            <Link href="/" className="hover:text-ink transition-colors">Accueil</Link>
            <span className="mx-2">/</span>
            <Link href={`/communes/${commune.slug}`} className="hover:text-ink transition-colors">
              {commune.nom}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-ink font-bold">Investisseur</span>
          </nav>

          <div className="flex flex-col sm:flex-row items-start gap-6">

            {/* Badge yield */}
            {kpi?.yield_brut != null ? (
              <div className="border-2 border-ink shrink-0">
                <div className="bg-ink text-paper px-8 py-6 text-center min-w-[120px]">
                  <p className="font-display text-5xl font-bold tabular-nums leading-none">
                    {kpi.yield_brut.toFixed(1)}
                  </p>
                  <p className="font-mono text-sm mt-1 tracking-widest opacity-80">% brut</p>
                </div>
                <div className="bg-paper border-t-2 border-ink px-4 py-2 text-center">
                  <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
                    Yield indicatif
                  </p>
                </div>
              </div>
            ) : (
              <div className="border-2 border-ink shrink-0">
                <div className="bg-paper-soft px-8 py-6 text-center min-w-[120px]">
                  <p className="font-display text-5xl font-bold text-ink-muted leading-none">—</p>
                  <p className="font-mono text-sm mt-1 tracking-widest opacity-60">% brut</p>
                </div>
              </div>
            )}

            {/* Commune info */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="border-2 border-ink bg-paper-soft px-3 py-1 font-mono text-xs font-bold">
                  Dép. {commune.departement}
                </span>
                <span className="border-2 border-ink bg-ink text-paper px-3 py-1 font-mono text-[9px] tracking-widest uppercase">
                  PROFIL INVESTISSEUR
                </span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight">
                Investir à {commune.nom}
              </h1>
              <p className="font-mono text-sm text-ink-muted mt-2">
                Yield brut · Prix DVF · Loyer observé · Taxe foncière — données d&apos;État 2024
              </p>
              {commune.population != null && (
                <p className="font-mono text-xs text-ink-muted mt-2 tabular-nums">
                  {commune.population.toLocaleString('fr-FR')} habitants · INSEE {commune.code_insee}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-12">

        {/* ── 01 : KPI Investisseur ── */}
        <section>
          <SectionTitle index="01" title="4 KPI Investisseur" />
          {kpi ? (
            <InvestisseurKPI kpi={kpi} />
          ) : (
            <div className="border-2 border-ink bg-paper px-6 py-10 text-center">
              <p className="font-mono text-sm text-ink-muted">
                Données investisseur insuffisantes pour cette commune (DVF ou loyer manquant).
              </p>
            </div>
          )}
        </section>

        {/* ── 02 : Simulateur ── */}
        <section>
          <SectionTitle index="02" title="Simulateur investisseur locatif" />
          <RentalCalculator
            commune={{
              code_insee: commune.code_insee,
              nom: commune.nom,
              departement: commune.departement,
              population: commune.population ?? null,
            }}
            loyer={loyer}
            taxeFonciere={taxeFonciere}
            prixM2Dvf={kpi?.prix_m2_median ?? null}
            surfaceMoyFilosofi={filosofiRow?.surface_moy ?? null}
            nbLogementsFilosofi={filosofiRow?.nb_logements ?? null}
            rpLogement={rpLogement}
          />
        </section>

        {/* ── 03 : Liens croisés ── */}
        <section className="flex flex-wrap gap-3">
          <Link
            href={`/communes/${commune.slug}`}
            className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors"
          >
            ← Fiche globale {commune.nom}
          </Link>
          <Link
            href={`/departements/${commune.departement}/investisseur`}
            className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors"
          >
            Top Investisseur — Dép. {commune.departement} →
          </Link>
          <Link
            href="/profil/investisseur"
            className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors"
          >
            Top 50 Investisseur national →
          </Link>
        </section>

        {/* ── Sources ── */}
        <div className="border-2 border-ink bg-paper p-4 flex flex-col sm:flex-row items-start gap-3">
          <span className="font-mono text-xs font-bold shrink-0">SOURCES</span>
          <span className="hidden sm:block w-px h-4 bg-ink shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-ink-muted">
            DVF — Demandes de Valeurs Foncières (data.gouv.fr) ·{' '}
            Loyers — ANIL/Cerema 2023 · OLAP Paris 2024 · OLL Lyon/AMP 2024 ·{' '}
            Taxe foncière — OFGL REI 2024 (data.ofgl.fr) ·{' '}
            Données open data, mise à jour annuelle.
          </p>
        </div>

      </main>
    </div>
  );
}

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
