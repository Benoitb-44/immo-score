import { PrismaClient } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { deptName } from '@/lib/departments';

export const dynamic = 'force-dynamic';

// ─── Prisma singleton ─────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}
const prisma = globalThis.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: 'Explorer par département | ImmoRank',
  description:
    "Comparez les communes de France par département. Scores d'attractivité immobilière basés sur DVF, DPE et Géorisques.",
  alternates: { canonical: '/departements' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

type DeptRow = {
  departement: string;
  region: string;
  nb: bigint;
};

export default async function DepartementsPage() {
  const depts = await prisma.$queryRaw<DeptRow[]>`
    SELECT departement, region, COUNT(*) AS nb
    FROM immo_score.communes
    GROUP BY departement, region
    ORDER BY departement
  `;

  // Regrouper par région pour l'affichage
  const byRegion = new Map<string, DeptRow[]>();
  for (const d of depts) {
    const arr = byRegion.get(d.region) ?? [];
    arr.push(d);
    byRegion.set(d.region, arr);
  }
  const regions = Array.from(byRegion.entries()).sort(([a], [b]) =>
    a.localeCompare(b, 'fr'),
  );

  return (
    <div className="bg-paper-soft flex-1">

      {/* ── Hero ── */}
      <div className="border-b-2 border-ink bg-paper">
        <div className="max-w-5xl mx-auto px-6 py-8">

          <nav aria-label="Fil d'Ariane" className="font-mono text-xs text-ink-muted mb-5">
            <Link href="/" className="hover:text-ink transition-colors">Accueil</Link>
            <span className="mx-2">/</span>
            <span className="text-ink font-bold">Départements</span>
          </nav>

          <h1 className="font-display text-4xl sm:text-5xl font-bold text-ink leading-tight">
            Explorer par département
          </h1>
          <p className="font-mono text-sm text-ink-muted mt-3 tabular-nums">
            {depts.length} départements · {depts
              .reduce((acc, d) => acc + Number(d.nb), 0)
              .toLocaleString('fr-FR')}{' '}
            communes
          </p>
        </div>
      </div>

      {/* ── Grille par région ── */}
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        {regions.map(([region, regionDepts]) => (
          <section key={region}>
            <div className="flex items-baseline gap-4 mb-4">
              <h2 className="font-display text-lg font-bold text-ink">{region}</h2>
              <div className="flex-1 h-px bg-ink" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {regionDepts.map((d) => (
                <Link
                  key={d.departement}
                  href={`/departements/${d.departement}`}
                  className="border-2 border-ink bg-paper p-4 flex flex-col gap-1 hover:bg-ink hover:text-paper transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tracking-widest uppercase border border-ink group-hover:border-paper px-1.5 py-0.5 leading-none shrink-0 transition-colors">
                      {d.departement}
                    </span>
                    <span className="font-display font-semibold text-sm text-ink group-hover:text-paper transition-colors truncate">
                      {deptName(d.departement)}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-ink-muted group-hover:text-paper/70 transition-colors tabular-nums">
                    {Number(d.nb).toLocaleString('fr-FR')} communes
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </main>

    </div>
  );
}
