/**
 * /departements/[code]/investisseur — Top 20 investisseur d'un département
 *
 * ISR revalidate 7 jours. Server Component pur.
 */

import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { deptName } from '@/lib/departments';
import { getTopInvestisseurByDept } from '@/lib/repositories/investisseur.repository';

export const revalidate = 604800; // ISR 7 jours

// ─── Prisma singleton ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma_dept_inv: PrismaClient | undefined;
}

const prisma = globalThis.__prisma_dept_inv ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma_dept_inv = prisma;

// ─── generateStaticParams ─────────────────────────────────────────────────────

export async function generateStaticParams() {
  try {
    const depts = await prisma.commune.findMany({
      distinct: ['departement'],
      select: { departement: true },
    });
    return depts.map((d) => ({ code: d.departement }));
  } catch {
    return [];
  }
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  const nom = deptName(params.code);
  return {
    title: `Investir en ${nom} (${params.code}) — Top 20 communes par yield brut | CityRank`,
    description: `Classement des 20 meilleures communes du département ${nom} pour l'investissement locatif. Yield brut calculé depuis DVF et loyers ANIL/OLL.`,
    alternates: {
      canonical: `/departements/${params.code}/investisseur`,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function yieldBadgeClass(pct: number): string {
  if (pct >= 8) return 'bg-score-high text-white'
  if (pct >= 6) return 'bg-score-mid text-white'
  return 'bg-paper-soft text-ink'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DeptInvestisseurPage({
  params,
}: {
  params: { code: string };
}) {
  const nom = deptName(params.code);

  // Vérifie que le département existe
  const exists = await prisma.commune.findFirst({
    where: { departement: params.code },
    select: { departement: true },
  });

  if (!exists) notFound();

  let communes: Awaited<ReturnType<typeof getTopInvestisseurByDept>> = [];
  try {
    communes = await getTopInvestisseurByDept(params.code, 20, prisma);
  } catch {
    // DB indisponible → ISR régénère
  }

  return (
    <div className="bg-paper-soft flex-1">

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-10">

          {/* Breadcrumb */}
          <nav aria-label="Fil d'Ariane" className="font-mono text-xs text-ink-muted mb-5">
            <Link href="/" className="hover:text-ink transition-colors">Accueil</Link>
            <span className="mx-2">/</span>
            <Link href="/departements" className="hover:text-ink transition-colors">Départements</Link>
            <span className="mx-2">/</span>
            <Link href={`/departements/${params.code}`} className="hover:text-ink transition-colors">
              {nom}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-ink font-bold">Investisseur</span>
          </nav>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="border-2 border-ink bg-paper-soft px-3 py-1 font-mono text-xs font-bold">
              Dép. {params.code}
            </span>
            <span className="border-2 border-ink bg-ink text-paper px-3 py-1 font-mono text-[9px] tracking-widest uppercase">
              PROFIL INVESTISSEUR
            </span>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight mb-3">
            Investir en {nom}
          </h1>
          <p className="font-sans text-lg text-ink-muted max-w-2xl leading-relaxed">
            Top 20 communes du département {params.code} classées par yield brut calculé
            depuis les données DVF et loyers ANIL/OLL.
          </p>
        </div>
      </div>

      {/* ── Tableau ── */}
      <main className="max-w-5xl mx-auto px-6 py-10">

        {communes.length === 0 ? (
          <div className="border-2 border-ink bg-paper px-6 py-12 text-center">
            <p className="font-mono text-sm text-ink-muted">
              Données insuffisantes pour ce département (DVF ou loyers manquants).
            </p>
          </div>
        ) : (
          <div className="border-2 border-ink bg-paper overflow-x-auto">
            <div className="grid grid-cols-[2rem_2fr_1fr_1fr_1fr] border-b-2 border-ink divide-x-2 divide-ink min-w-[560px] bg-ink">
              {['#', 'Commune', 'Yield brut', 'Prix DVF', 'Loyer'].map((h) => (
                <div key={h} className="px-3 py-2">
                  <p className="font-mono text-[10px] text-paper tracking-widest uppercase">{h}</p>
                </div>
              ))}
            </div>

            {communes.map((c, i) => (
              <div
                key={c.code_insee}
                className={`grid grid-cols-[2rem_2fr_1fr_1fr_1fr] divide-x-2 divide-ink min-w-[560px] ${i < communes.length - 1 ? 'border-b-2 border-ink' : ''} hover:bg-paper-soft transition-colors`}
              >
                <div className="px-3 py-3 flex items-center">
                  <span className="font-mono text-xs text-ink-muted tabular-nums">{i + 1}</span>
                </div>
                <div className="px-3 py-3 flex items-center">
                  <Link
                    href={`/communes/${c.slug}/investisseur`}
                    className="font-display font-semibold text-ink hover:text-accent transition-colors text-sm"
                  >
                    {c.nom}
                  </Link>
                </div>
                <div className="px-3 py-3 flex items-center gap-1.5">
                  {c.yield_brut != null ? (
                    <>
                      <span className="font-display text-lg font-bold tabular-nums text-ink">
                        {c.yield_brut.toFixed(1)} %
                      </span>
                      <span className={`font-mono text-[9px] px-1 py-0.5 font-bold shrink-0 ${yieldBadgeClass(c.yield_brut)}`}>
                        {c.yield_brut >= 8 ? 'Élevé' : c.yield_brut >= 6 ? 'Bon' : 'Moyen'}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-xs text-ink-muted">—</span>
                  )}
                </div>
                <div className="px-3 py-3 flex items-center">
                  <span className="font-mono text-xs tabular-nums text-ink">
                    {c.prix_m2_median != null ? `${c.prix_m2_median.toLocaleString('fr-FR')} €/m²` : '—'}
                  </span>
                </div>
                <div className="px-3 py-3 flex items-center">
                  <span className="font-mono text-xs tabular-nums text-ink">
                    {c.loyer_m2 != null ? `${c.loyer_m2.toFixed(1)} €/m²` : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/departements/${params.code}`}
            className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors"
          >
            ← Toutes les communes — Dép. {params.code}
          </Link>
          <Link
            href="/profil/investisseur"
            className="font-mono text-xs tracking-wider uppercase border-2 border-ink px-3 py-2 text-ink hover:bg-ink hover:text-paper transition-colors"
          >
            Top 50 Investisseur national →
          </Link>
        </div>
      </main>
    </div>
  );
}
