/**
 * /communes/[slug] — Page commune
 *
 * ISR revalidate 24h. Server Component pur (pas de 'use client').
 * generateStaticParams : top 1 000 communes par score_global.
 * generateMetadata     : titre + description dynamiques pour le SEO.
 */

import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const revalidate = 86400; // ISR 24h

// ─── Prisma singleton (évite les connexions multiples au hot-reload) ──────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = globalThis.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

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
    description: `${commune.nom} obtient un score Immo Score de ${score ?? '—'}/100. Analyse complète : prix DVF, diagnostic énergétique DPE, risques naturels. Données open data actualisées.`,
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
    include: { score: true },
  });

  if (!commune) notFound();

  const score = commune.score;
  const globalScore = score?.score_global ?? null;
  const globalRounded = globalScore != null ? Math.round(globalScore) : null;
  const color =
    globalRounded != null ? scoreColor(globalRounded) : { bg: 'bg-ink-muted', text: 'text-white' };

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
        name: 'Score Immo Score',
        value: globalRounded,
        minValue: 0,
        maxValue: 100,
      },
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
            <span>Communes</span>
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
        </div>
      </div>

      {/* ── Sous-scores ── */}
      <main className="max-w-5xl mx-auto px-6 py-10">

        <SectionTitle index="01" title="Détail des dimensions" />

        <div className="border-2 border-ink divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-ink flex flex-col sm:flex-row">
          <ScoreCard
            index="01"
            label="Prix immobilier DVF"
            source="data.gouv.fr"
            score={score?.score_dvf ?? null}
            description="Percentile national du prix médian au m² + liquidité du marché."
            weight="50 %"
          />
          <ScoreCard
            index="02"
            label="Performance énergétique"
            source="ADEME"
            score={score?.score_dpe ?? null}
            description="Part des logements classés A ou B sur le total des DPE déposés."
            weight="30 %"
          />
          <ScoreCard
            index="03"
            label="Risques naturels"
            source="Géorisques"
            score={score?.score_risques ?? null}
            description="Score de 100 diminué par les malus de risques recensés (MOYEN −5, FORT −15, TRÈS FORT −20)."
            weight="20 %"
          />
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

        {/* Source notice */}
        <div className="mt-8 border-2 border-ink bg-paper p-4 flex flex-col sm:flex-row items-start gap-3">
          <span className="font-mono text-xs font-bold shrink-0">SOURCES</span>
          <span className="hidden sm:block w-px h-4 bg-ink shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-ink-muted">
            DVF — Demandes de Valeurs Foncières (data.gouv.fr) ·{' '}
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

function ScoreCard({
  index,
  label,
  source,
  score,
  description,
  weight,
}: {
  index: string;
  label: string;
  source: string;
  score: number | null | undefined;
  description: string;
  weight: string;
}) {
  const hasScore = score != null;
  const rounded = hasScore ? Math.round(score) : null;
  const color = rounded != null ? scoreColor(rounded) : null;

  return (
    <div className="flex-1 bg-paper">
      {/* Card header */}
      <div className="border-b-2 border-ink px-5 py-3">
        <p className="font-mono text-[10px] text-ink-muted tracking-widest uppercase mb-0.5">
          {index} — Poids {weight}
        </p>
        <p className="font-display font-semibold text-ink">{label}</p>
      </div>

      {/* Score */}
      <div className="p-5">
        {hasScore && rounded != null && color ? (
          <div
            className={`${color.bg} ${color.text} inline-flex items-baseline gap-1 px-5 py-3 border-2 border-ink`}
          >
            <span className="font-display text-4xl font-bold tabular-nums leading-none">
              {rounded}
            </span>
            <span className="font-mono text-sm">/100</span>
          </div>
        ) : (
          <div className="border-2 border-ink bg-paper-soft inline-flex items-center px-4 py-3">
            <span className="font-mono text-xs text-ink-muted">Données non disponibles</span>
          </div>
        )}

        <p className="font-sans text-sm text-ink-muted mt-3 leading-relaxed">{description}</p>
        <p className="font-mono text-[10px] text-ink-muted mt-3 tracking-widest uppercase">
          Source : {source}
        </p>
      </div>
    </div>
  );
}
