/**
 * /communes/[slug] — Page commune
 *
 * ISR revalidate 24h. Server Component pur (pas de 'use client').
 * generateStaticParams : top 1 000 communes par score_global.
 * generateMetadata     : titre + description dynamiques pour le SEO.
 */

import { PrismaClient, NiveauRisque, type BpeCommune, type Prisma } from '@prisma/client';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BPE_CODES } from '@/lib/bpe-codes';
import SousScoreV4, { type NiveauFallback } from '@/components/SousScoreV4';
import RentalCalculator from '@/components/RentalCalculator';
import { getLoyerForCommune } from '@/lib/repositories/loyer.repository';
import { getTaxeFonciereForCommune } from '@/lib/repositories/taxe-fonciere.repository';
import { DEFAULT_SURFACE } from '@/lib/constants/market-rates';

export const revalidate = 86400; // ISR 24h

// ─── Prisma singleton (évite les connexions multiples au hot-reload) ──────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = globalThis.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ─── Types ────────────────────────────────────────────────────────────────────

type RisqueItem = {
  type_risque: string;
  niveau: NiveauRisque;
  description: string | null;
};

type NavCommune = { nom: string; slug: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 70) return { bg: 'bg-score-high', text: 'text-white' };
  if (score >= 40) return { bg: 'bg-score-mid', text: 'text-white' };
  return { bg: 'bg-score-low', text: 'text-white' };
}

function scoreLabel(score: number): string {
  if (score >= 70) return 'Attractif';
  if (score >= 40) return 'Moyen';
  return 'Faible';
}

function scoreInterpretation(score: number): string {
  if (score >= 70)
    return 'Commune bien classée — marché accessible, bâti de qualité énergétique et faible exposition aux risques.';
  if (score >= 40)
    return 'Commune dans la moyenne nationale — profil équilibré sans signal fort positif ni négatif.';
  return 'Commune en dessous de la médiane nationale — accessibilité prix, performance énergétique ou risques limitants.';
}

const NIVEAU_SORT: Record<NiveauRisque, number> = {
  [NiveauRisque.TRES_FORT]: 0,
  [NiveauRisque.FORT]: 1,
  [NiveauRisque.MOYEN]: 2,
  [NiveauRisque.FAIBLE]: 3,
};

const NIVEAU_LABEL: Record<NiveauRisque, string> = {
  [NiveauRisque.TRES_FORT]: 'Très fort',
  [NiveauRisque.FORT]: 'Fort',
  [NiveauRisque.MOYEN]: 'Moyen',
  [NiveauRisque.FAIBLE]: 'Faible',
};

const NIVEAU_CLASS: Record<NiveauRisque, string> = {
  [NiveauRisque.TRES_FORT]: 'bg-score-low text-white',
  [NiveauRisque.FORT]: 'bg-orange-500 text-white',
  [NiveauRisque.MOYEN]: 'bg-score-mid text-white',
  [NiveauRisque.FAIBLE]: 'bg-score-high text-white',
};

// ─── generateStaticParams ─────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const top = await prisma.score.findMany({
      orderBy: { score_global: 'desc' },
      take: 1000,
      select: {
        commune: {
          select: { slug: true },
        },
      },
    });

    return top
      .filter((s: { commune: { slug: string } | null }) => s.commune?.slug)
      .map((s: { commune: { slug: string } | null }) => ({ slug: s.commune!.slug }));
  } catch {
    // DB indisponible au build (ex : docker build sans DB) → ISR génère les pages à la demande
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
    select: {
      nom: true,
      departement: true,
      score: { select: { score_global: true } },
    },
  });

  if (!commune) return { title: 'Commune introuvable' };

  const score =
    commune.score?.score_global != null
      ? Math.round(commune.score.score_global)
      : null;

  return {
    title: `Immobilier ${commune.nom} (${commune.departement}) : Score ${score ?? '—'}/100, Prix, DPE, Risques`,
    description: `${commune.nom} obtient un score CityRank de ${score ?? '—'}/100. Analyse complète : prix DVF, diagnostic énergétique DPE, risques naturels. Données open data actualisées.`,
    alternates: {
      canonical: `/communes/${params.slug}`,
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CommunePage({
  params,
}: {
  params: { slug: string };
}) {
  const commune = await prisma.commune.findUnique({
    where: { slug: params.slug },
    include: { score: true, bpe: true, score_commune: true },
  });

  if (!commune) notFound();

  const currentGlobalScore = commune.score?.score_global ?? null;

  const [dvfRows, dpeRows, risquesList, sameDeptCommunes, similarScoreCommunes, loyer, taxeFonciere, filosofiData] = await Promise.all([
    prisma.$queryRaw<{ prix_m2_median: string | null; tx_per_hab: string | null }[]>`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2)::text AS prix_m2_median,
        (COUNT(*)::float / NULLIF(c.population, 0))::text             AS tx_per_hab
      FROM immo_score.dvf_prix d
      JOIN immo_score.communes c ON c.code_insee = d.code_commune
      WHERE d.code_commune = ${commune.code_insee}
        AND d.prix_m2 IS NOT NULL
        AND d.prix_m2 > 0
      GROUP BY c.population
    `,
    prisma.$queryRaw<{ pct_non_passoire: string | null }[]>`
      SELECT
        (SUM(CASE WHEN classe_dpe IN ('A','B','C','D','E') THEN nb_logements ELSE 0 END)::float
          / NULLIF(SUM(nb_logements), 0) * 100)::text AS pct_non_passoire
      FROM immo_score.dpe_communes
      WHERE code_commune = ${commune.code_insee}
    `,
    prisma.risque.findMany({
      where: { code_commune: commune.code_insee },
      select: { type_risque: true, niveau: true, description: true },
    }),
    prisma.commune.findMany({
      where: {
        departement: commune.departement,
        NOT: { code_insee: commune.code_insee },
      },
      orderBy: { population: 'desc' },
      take: 5,
      select: { nom: true, slug: true },
    }),
    currentGlobalScore != null
      ? prisma.$queryRaw<NavCommune[]>`
          SELECT c.nom, c.slug
          FROM immo_score.communes c
          JOIN immo_score.scores s ON s.code_commune = c.code_insee
          WHERE c.departement != ${commune.departement}
            AND c.code_insee != ${commune.code_insee}
            AND s.score_global BETWEEN ${currentGlobalScore - 5} AND ${currentGlobalScore + 5}
          ORDER BY ABS(s.score_global - ${currentGlobalScore})
          LIMIT 4
        `
      : Promise.resolve([] as NavCommune[]),
    getLoyerForCommune(commune.code_insee, prisma),
    getTaxeFonciereForCommune(commune.code_insee, prisma),
    // Filosofi : nb_logements + surface_moy via raw SQL (colonnes hors schéma Prisma si disponibles)
    prisma.$queryRaw<{ nb_logements: number | null; surface_moy: number | null }[]>`
      SELECT nb_logements, surface_moy
      FROM immo_score.insee_filosofi
      WHERE code_commune = ${commune.code_insee}
      LIMIT 1
    `.catch(() => [] as { nb_logements: number | null; surface_moy: number | null }[]),
  ]);

  const prixM2Median = dvfRows[0]?.prix_m2_median
    ? Math.round(parseFloat(dvfRows[0].prix_m2_median))
    : null;
  const txPerHab = dvfRows[0]?.tx_per_hab
    ? parseFloat(dvfRows[0].tx_per_hab)
    : null;
  const pctNonPassoire = dpeRows[0]?.pct_non_passoire
    ? Math.round(parseFloat(dpeRows[0].pct_non_passoire))
    : null;

  const score = commune.score;
  const globalScore = score?.score_global ?? null;

  // ── Données calculateur investisseur ─────────────────────────────────────────
  const filosofiRow = Array.isArray(filosofiData) ? filosofiData[0] ?? null : null;
  const nbLogementsFilosofi = filosofiRow?.nb_logements ?? null;
  const surfaceMoyFilosofi = filosofiRow?.surface_moy ?? null;

  // ── Score v4 — Accessibilité financière ──────────────────────────────────────
  const scoreCommune = commune.score_commune;
  const scoreAccessFin = scoreCommune?.score_accessibilite_fin ?? null;

  function deriveNiveauFallback(sc: typeof scoreCommune): NiveauFallback | null {
    if (!sc) return null;
    const methods = sc.imputation_methods as Prisma.JsonObject | null;
    const method = typeof methods?.method === 'string' ? methods.method : null;
    if (method === 'cerema_aav_d5_2022_2024') return 'N1';
    if (method === 'dvf_filosofi') return 'N2';
    if (method === 'regional_median') return 'N3';
    if (method === 'national_median') return 'N4';
    // Si pas d'imputation enregistrée et non imputé → N1
    return sc.accessibilite_imputed ? 'N3' : 'N1';
  }

  const niveauAccessFin = deriveNiveauFallback(scoreCommune);
  const globalRounded = globalScore != null ? Math.round(globalScore) : null;
  const color =
    globalRounded != null ? scoreColor(globalRounded) : { bg: 'bg-ink-muted', text: 'text-white' };

  // Yield brut indicatif pour JSON-LD (uniquement si loyer N1/N1bis et DVF disponible)
  const loyerPourJsonLd = loyer?.niveau != null && ['N1', 'N1bis'].includes(loyer.niveau) ? loyer : null;
  const yieldBrutJsonLd = loyerPourJsonLd && prixM2Median
    ? Math.round(((loyerPourJsonLd.loyer_m2 * DEFAULT_SURFACE * 12) / (prixM2Median * DEFAULT_SURFACE)) * 1000) / 10
    : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: commune.nom,
    description: `Score d'attractivité immobilière de ${commune.nom} : ${globalRounded ?? '—'}/100`,
    ...(commune.lat != null &&
      commune.lng != null && {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: commune.lat,
          longitude: commune.lng,
        },
      }),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Score CityRank',
        value: globalRounded,
        minValue: 0,
        maxValue: 100,
      },
      ...(yieldBrutJsonLd != null ? [{
        '@type': 'PropertyValue',
        name: 'Rendement locatif brut indicatif',
        value: yieldBrutJsonLd,
        unitCode: 'P1',
        unitText: '%',
        description: `Loyer médian observé (${loyerPourJsonLd?.source}) rapporté au prix DVF médian — surface ${DEFAULT_SURFACE} m²`,
      }] : []),
    ],
  };

  return (
    <div className="bg-paper-soft flex-1">

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-8">

          {/* Breadcrumb */}
          <nav aria-label="Fil d'Ariane" className="font-mono text-xs text-ink-muted mb-5">
            <a href="/" className="hover:text-ink transition-colors">Accueil</a>
            <span className="mx-2">/</span>
            <a href="/" className="hover:text-ink transition-colors">Communes</a>
            <span className="mx-2">/</span>
            <span className="text-ink font-bold">{commune.nom}</span>
          </nav>

          <div className="flex flex-col sm:flex-row items-start gap-6 sm:gap-8">

            {/* Score badge */}
            <div className="border-2 border-ink shrink-0">
              <div className={`${color.bg} ${color.text} px-8 py-6 text-center min-w-[120px]`}>
                {globalRounded != null ? (
                  <>
                    <p className="font-display text-6xl font-bold tabular-nums leading-none">
                      {globalRounded}
                    </p>
                    <p className="font-mono text-sm mt-1 tracking-widest opacity-80">/100</p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-5xl font-bold leading-none">—</p>
                    <p className="font-mono text-sm mt-1 tracking-widest opacity-80">/100</p>
                  </>
                )}
              </div>
              <div className="bg-paper border-t-2 border-ink px-4 py-2 text-center">
                <p className="font-mono text-[10px] tracking-widest uppercase text-ink-muted">
                  {globalRounded != null ? scoreLabel(globalRounded) : 'N/A'}
                </p>
              </div>
            </div>

            {/* Commune info */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="border-2 border-ink bg-paper-soft px-3 py-1 font-mono text-xs font-bold">
                  Dép. {commune.departement}
                </span>
              </div>
              <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight">
                {commune.nom}
              </h1>
              <div className="flex flex-wrap gap-4 mt-3 font-mono text-sm text-ink-muted tabular-nums">
                {commune.population != null && (
                  <span>{commune.population.toLocaleString('fr-FR')} hab.</span>
                )}
                <span>INSEE {commune.code_insee}</span>
              </div>
            </div>
          </div>

          {globalRounded != null && (
            <p className="font-mono text-xs text-neutral-500 mt-4">
              {scoreInterpretation(globalRounded)}{' '}
              <span>Médiane nationale : ~55/100</span>
            </p>
          )}
        </div>
      </div>

      {/* ── Sous-scores ── */}
      <main className="max-w-5xl mx-auto px-6 py-10">

        <SectionTitle index="01" title="Détail des dimensions" />

        {/* Layout v3.1 : DVF → BPE → Risques | DPE */}
        <div className="border-2 border-ink">

          {/* DVF — pleine largeur, 45 % */}
          <DvfCard
            score={score?.score_dvf ?? null}
            prixM2Median={prixM2Median}
            txPerHab={txPerHab}
            imputed={score?.dvf_imputed ?? false}
          />

          {/* BPE — pleine largeur, 25 % */}
          <BpeCard
            score={score?.score_bpe ?? null}
            bpe={commune.bpe}
          />

          {/* Risques + DPE côte à côte */}
          <div className="flex flex-col sm:flex-row divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-ink">
            <RisquesCard
              score={score?.score_risques ?? null}
              risques={risquesList}
            />
            <DpeCard
              score={score?.score_dpe ?? null}
              pctNonPassoire={pctNonPassoire}
            />
          </div>
        </div>

        {/* Légende couleurs */}
        <div className="mt-4 flex flex-wrap gap-5 font-mono text-xs text-ink-muted">
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 bg-score-high border border-ink" />
            70–100 — Attractif
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 bg-score-mid border border-ink" />
            40–69 — Moyen
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 bg-score-low border border-ink" />
            0–39 — Faible
          </span>
        </div>

        {/* ── Score CityRank v4 — Accessibilité financière ── */}
        <div className="mt-12">
          <SectionTitle index="02" title="Score CityRank v4 — Accessibilité financière" />

          <SousScoreV4
            titre="Accessibilité financière"
            valeur={scoreAccessFin}
            niveau={niveauAccessFin}
            source="Cerema DV3F 2022-2024 · DVF + Filosofi"
            lienMethodo="/methodologie#v4-accessibilite"
          />

          <p className="font-mono text-[10px] text-ink-muted mt-3 leading-relaxed">
            Score v4 en déploiement progressif — coexiste avec le score v3.1 ci-dessus pendant la transition.{' '}
            <a href="/methodologie#v4-accessibilite" className="underline hover:text-ink">
              Voir la méthode complète
            </a>.
          </p>
        </div>

        {/* ── Calculateur d'investissement locatif (UX-v4-CALC) ── */}
        <div className="mt-12">
          <SectionTitle index="03" title="Simulateur investisseur locatif" />
          <RentalCalculator
            commune={{
              code_insee: commune.code_insee,
              nom: commune.nom,
              departement: commune.departement,
              population: commune.population ?? null,
            }}
            loyer={loyer}
            taxeFonciere={taxeFonciere}
            prixM2Dvf={prixM2Median}
            surfaceMoyFilosofi={surfaceMoyFilosofi}
            nbLogementsFilosofi={nbLogementsFilosofi}
          />
        </div>

        {/* ── Navigation — même département ── */}
        {sameDeptCommunes.length > 0 && (
          <div className="mt-10">
            <p className="font-mono text-xs uppercase tracking-widest text-ink-muted mb-3">
              Dans le même département
            </p>
            <div className="flex flex-wrap gap-2">
              {sameDeptCommunes.map((c) => (
                <a
                  key={c.slug}
                  href={`/communes/${c.slug}`}
                  className="border-2 border-ink font-mono text-xs px-3 py-1.5 hover:bg-ink hover:text-paper transition-colors"
                >
                  {c.nom}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Navigation — score similaire ── */}
        {similarScoreCommunes.length > 0 && (
          <div className="mt-6">
            <p className="font-mono text-xs uppercase tracking-widest text-ink-muted mb-3">
              Score similaire
            </p>
            <div className="flex flex-wrap gap-2">
              {similarScoreCommunes.map((c) => (
                <a
                  key={c.slug}
                  href={`/communes/${c.slug}`}
                  className="border-2 border-ink font-mono text-xs px-3 py-1.5 hover:bg-ink hover:text-paper transition-colors"
                >
                  {c.nom}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Source notice */}
        <div className="mt-8 border-2 border-ink bg-paper p-4 flex flex-col sm:flex-row items-start gap-3">
          <span className="font-mono text-xs font-bold shrink-0">SOURCES</span>
          <span className="hidden sm:block w-px h-4 bg-ink shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-ink-muted">
            DVF — Demandes de Valeurs Foncières (data.gouv.fr) ·{' '}
            INSEE BPE — Base Permanente des Équipements (insee.fr) ·{' '}
            DPE ADEME — Diagnostics de Performance Énergétique (data.ademe.fr) ·{' '}
            Géorisques — risques naturels et technologiques (georisques.gouv.fr) ·{' '}
            Données open data, mise à jour annuelle.
          </p>
        </div>

      </main>

      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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

// ─── DVF Card — pleine largeur, score en grand ────────────────────────────────

function DvfCard({
  score,
  prixM2Median,
  txPerHab,
  imputed,
}: {
  score: number | null;
  prixM2Median: number | null;
  txPerHab: number | null;
  imputed: boolean;
}) {
  const hasScore = score != null;
  const rounded = hasScore ? Math.round(score) : null;
  const color = rounded != null ? scoreColor(rounded) : null;

  return (
    <div className={`border-b-2 border-ink bg-paper${!hasScore ? ' opacity-40' : ''}`}>
      {/* Header */}
      <div className="border-b-2 border-ink px-6 py-3 flex items-center justify-between">
        <div>
          <p className="font-display font-semibold text-ink">Prix immobilier DVF</p>
          <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mt-0.5">
            Source : data.gouv.fr
          </p>
        </div>
        <span className="font-mono text-xs text-ink-muted tabular-nums">Poids : 45 %</span>
      </div>

      {/* Body */}
      {!hasScore ? (
        <div className="px-6 py-10 flex items-center justify-center">
          <p className="font-mono text-sm text-ink-muted">Données insuffisantes</p>
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {color && rounded != null && (
            <div
              className={`${color.bg} ${color.text} border-2 border-ink px-8 py-5 flex items-baseline gap-2 shrink-0`}
            >
              <span className="font-display text-6xl font-bold tabular-nums leading-none">
                {rounded}
              </span>
              <span className="font-mono text-base">/100</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {prixM2Median != null && (
              <p className="font-mono text-sm text-ink">
                Prix médian :{' '}
                <span className="font-bold">
                  {prixM2Median.toLocaleString('fr-FR')} €/m²
                </span>
              </p>
            )}
            {txPerHab != null && (
              <p className="font-mono text-sm text-ink">
                Liquidité :{' '}
                <span className="font-bold">{txPerHab.toFixed(3)} tx/hab</span>
              </p>
            )}
            {imputed && (
              <p className="font-mono text-[10px] text-ink-muted border border-ink-muted px-2 py-0.5 inline-block self-start">
                Score imputé — données DVF insuffisantes, estimation régionale utilisée
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BPE Card — pleine largeur, 25 % ─────────────────────────────────────────

const BPE_CAT_LABELS: Record<string, string> = {
  education: 'Éducation',
  sante: 'Santé',
  commerces: 'Commerces & Services',
  transport: 'Transport',
  cultureSport: 'Culture & Sport',
};

function BpeCard({
  score,
  bpe,
}: {
  score: number | null;
  bpe: BpeCommune | null;
}) {
  const hasScore = score != null;
  const rounded = hasScore ? Math.round(score) : null;
  const color = rounded != null ? scoreColor(rounded) : null;

  type CategorySummary = { label: string; present: string[]; total: number };
  const categories: CategorySummary[] = Object.entries(BPE_CAT_LABELS).map(([key, label]) => {
    const codes = BPE_CODES.filter((c) => c.category === key);
    const present = bpe
      ? codes.filter((c) => (bpe as unknown as Record<string, boolean>)[c.flag]).map((c) => c.label)
      : [];
    return { label, present, total: codes.length };
  });

  return (
    <div className={`border-b-2 border-ink bg-paper${!hasScore ? ' opacity-40' : ''}`}>
      {/* Header */}
      <div className="border-b-2 border-ink px-6 py-3 flex items-center justify-between">
        <div>
          <p className="font-display font-semibold text-ink">Équipements & Services BPE</p>
          <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mt-0.5">
            Source : INSEE BPE
          </p>
        </div>
        <span className="font-mono text-xs text-ink-muted tabular-nums">Poids : 25 %</span>
      </div>

      {/* Body */}
      {!hasScore ? (
        <div className="px-6 py-10 flex items-center justify-center">
          <p className="font-mono text-sm text-ink-muted">Données insuffisantes</p>
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col sm:flex-row items-start gap-6">
          {color && rounded != null && (
            <div
              className={`${color.bg} ${color.text} border-2 border-ink px-8 py-5 flex items-baseline gap-2 shrink-0`}
            >
              <span className="font-display text-6xl font-bold tabular-nums leading-none">
                {rounded}
              </span>
              <span className="font-mono text-base">/100</span>
            </div>
          )}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map(({ label, present, total }) => (
              <div key={label} className="border border-ink p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="font-mono text-xs font-bold text-ink">{label}</p>
                  <span className="font-mono text-[10px] text-ink-muted tabular-nums">
                    {present.length}/{total}
                  </span>
                </div>
                {present.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {present.map((name) => (
                      <li key={name} className="font-mono text-[10px] text-ink-muted flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-score-high inline-block shrink-0" />
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-[10px] text-ink-muted">Aucun équipement recensé</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Risques Card — 2/3 largeur ───────────────────────────────────────────────

function RisquesCard({
  score,
  risques,
}: {
  score: number | null;
  risques: RisqueItem[];
}) {
  const hasScore = score != null;
  const rounded = hasScore ? Math.round(score) : null;
  const color = rounded != null ? scoreColor(rounded) : null;
  const isClean = rounded === 100;

  const sortedRisques = [...risques].sort(
    (a, b) => NIVEAU_SORT[a.niveau] - NIVEAU_SORT[b.niveau],
  );

  return (
    <div className={`flex-[2] bg-paper${!hasScore ? ' opacity-40' : ''}`}>
      {/* Header */}
      <div className="border-b-2 border-ink px-5 py-3 flex items-center justify-between">
        <div>
          <p className="font-display font-semibold text-ink">Risques naturels</p>
          <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mt-0.5">
            Source : Géorisques
          </p>
        </div>
        <span className="font-mono text-xs text-ink-muted tabular-nums">Poids : 20 %</span>
      </div>

      {/* Body */}
      {!hasScore ? (
        <div className="p-5 flex items-center justify-center min-h-[100px]">
          <p className="font-mono text-sm text-ink-muted">Données insuffisantes</p>
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-4">
          {color && rounded != null && (
            <div
              className={`${color.bg} ${color.text} inline-flex items-baseline gap-1 px-5 py-3 border-2 border-ink`}
            >
              <span className="font-display text-4xl font-bold tabular-nums leading-none">
                {rounded}
              </span>
              <span className="font-mono text-sm">/100</span>
            </div>
          )}
          {isClean ? (
            <p className="font-mono text-xs text-ink-muted">Aucun risque majeur recensé.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sortedRisques.map((r, i) => (
                <li key={i} className="flex items-start gap-2 font-mono text-xs">
                  <span
                    className={`${NIVEAU_CLASS[r.niveau]} px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase shrink-0`}
                  >
                    {NIVEAU_LABEL[r.niveau]}
                  </span>
                  <span className="text-ink-muted">{r.description ?? r.type_risque}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DPE Card — 1/3 largeur ───────────────────────────────────────────────────

function DpeCard({
  score,
  pctNonPassoire,
}: {
  score: number | null;
  pctNonPassoire: number | null;
}) {
  const hasScore = score != null;
  const rounded = hasScore ? Math.round(score) : null;
  const color = rounded != null ? scoreColor(rounded) : null;

  return (
    <div className={`flex-[1] bg-paper${!hasScore ? ' opacity-40' : ''}`}>
      {/* Header */}
      <div className="border-b-2 border-ink px-5 py-3 flex items-center justify-between">
        <div>
          <p className="font-display font-semibold text-ink">Perf. énergétique</p>
          <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mt-0.5">
            Source : ADEME
          </p>
        </div>
        <span className="font-mono text-xs text-ink-muted tabular-nums">Poids : 10 %</span>
      </div>

      {/* Body */}
      {!hasScore ? (
        <div className="p-5 flex items-center justify-center min-h-[100px]">
          <p className="font-mono text-sm text-ink-muted">Données insuffisantes</p>
        </div>
      ) : (
        <div className="p-5 flex flex-col gap-3">
          {color && rounded != null && (
            <div
              className={`${color.bg} ${color.text} inline-flex items-baseline gap-1 px-5 py-3 border-2 border-ink`}
            >
              <span className="font-display text-4xl font-bold tabular-nums leading-none">
                {rounded}
              </span>
              <span className="font-mono text-sm">/100</span>
            </div>
          )}
          {pctNonPassoire != null && (
            <p className="font-mono text-sm text-ink">
              <span className="font-bold">{pctNonPassoire} %</span>{' '}
              de logements non-passoires (≤ étiquette E)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
