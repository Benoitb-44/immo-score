/**
 * aggregate-dvf-prix-tx.ts
 * Calcule le prix de transaction médian sur 3 ans glissants par commune
 * depuis la table dvf_prix et met à jour Commune.prix_tx_median3y.
 *
 * Prix de transaction = valeur_fonciere (prix total du bien, pas prix/m²).
 * On filtre les appartements et maisons avec surface > 0 et valeur > 0.
 *
 * Ce champ sert au Median Multiple v4 :
 *   MM = prix_tx_median3y / (median_uc × 1.5)
 *
 * Usage :
 *   npm run aggregate:dvf-prix-tx
 *   npm run aggregate:dvf-prix-tx -- --test
 *   npm run aggregate:dvf-prix-tx -- --depts=33,69
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_MODE  = process.argv.includes('--test');
const DEPTS_ARG  = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;
const BATCH_SIZE = 500;

// Fenêtre cible : 2022-2024 (cohérence avec Cerema DV3F 2022-2024).
// Si le DVF en base ne couvre pas 2024, on bascule sur 2021-2023.
const DVF_WINDOW_PRIMARY  = { start: '2022-01-01', end: '2024-12-31' };
const DVF_WINDOW_FALLBACK = { start: '2021-01-01', end: '2023-12-31' };

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommunePrixTxRow {
  code_commune:     string;
  prix_tx_median3y: string | null; // PERCENTILE_CONT retourne text via cast
  nb_transactions:  string;
}

// ─── Calcul SQL en batch ──────────────────────────────────────────────────────

/**
 * Détermine la fenêtre temporelle DVF à utiliser.
 * Priorité : 2022-2024 (cohérence Cerema). Fallback : 2021-2023 si DVF < 2024.
 */
async function resolveDvfWindow(): Promise<{ start: string; end: string; label: string }> {
  const res = await prisma.$queryRaw<[{ max_date: Date | null }]>`
    SELECT MAX(date_mutation) AS max_date FROM immo_score.dvf_prix
  `;
  const maxDate = res[0].max_date;
  if (maxDate && maxDate >= new Date('2024-07-01')) {
    console.log(`[aggregate-dvf] DVF couvre jusqu'à ${maxDate.toISOString().slice(0, 10)} → fenêtre 2022-2024`);
    return { ...DVF_WINDOW_PRIMARY, label: '2022-2024' };
  }
  console.log(
    `[aggregate-dvf] DVF max=${maxDate?.toISOString().slice(0, 10) ?? 'null'} < 2024-07-01` +
    ` → fallback fenêtre 2021-2023`,
  );
  return { ...DVF_WINDOW_FALLBACK, label: '2021-2023' };
}

/**
 * Calcule en une seule requête SQL le prix médian de transaction sur la fenêtre
 * choisie pour toutes les communes (ou un sous-ensemble si FILTER_DEPTS).
 */
async function computePrixTxMedians(): Promise<Map<string, number>> {
  const window = await resolveDvfWindow();
  console.log(`[aggregate-dvf] Calcul médianes prix transaction (fenêtre ${window.label})...`);

  const startDate = new Date(window.start);
  const endDate   = new Date(window.end);

  let rows: CommunePrixTxRow[];

  if (FILTER_DEPTS) {
    const deptPatterns = FILTER_DEPTS.map(d => d.padEnd(2, '0').substring(0, 2));
    rows = await prisma.$queryRaw<CommunePrixTxRow[]>`
      SELECT
        code_commune,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere)::text AS prix_tx_median3y,
        COUNT(*)::text AS nb_transactions
      FROM immo_score.dvf_prix
      WHERE type_local IN ('Appartement', 'Maison')
        AND valeur_fonciere > 0
        AND surface_reelle_bati > 0
        AND date_mutation BETWEEN ${startDate} AND ${endDate}
        AND LEFT(code_commune, 2) = ANY(${deptPatterns}::text[])
      GROUP BY code_commune
      HAVING COUNT(*) >= 3
    `;
  } else if (TEST_MODE) {
    rows = await prisma.$queryRaw<CommunePrixTxRow[]>`
      SELECT
        code_commune,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere)::text AS prix_tx_median3y,
        COUNT(*)::text AS nb_transactions
      FROM immo_score.dvf_prix
      WHERE type_local IN ('Appartement', 'Maison')
        AND valeur_fonciere > 0
        AND surface_reelle_bati > 0
        AND date_mutation BETWEEN ${startDate} AND ${endDate}
      GROUP BY code_commune
      HAVING COUNT(*) >= 3
      LIMIT 500
    `;
  } else {
    rows = await prisma.$queryRaw<CommunePrixTxRow[]>`
      SELECT
        code_commune,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY valeur_fonciere)::text AS prix_tx_median3y,
        COUNT(*)::text AS nb_transactions
      FROM immo_score.dvf_prix
      WHERE type_local IN ('Appartement', 'Maison')
        AND valeur_fonciere > 0
        AND surface_reelle_bati > 0
        AND date_mutation BETWEEN ${startDate} AND ${endDate}
      GROUP BY code_commune
      HAVING COUNT(*) >= 3
    `;
  }

  console.log(`[aggregate-dvf] ${rows.length} communes avec médiane calculée`);

  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.prix_tx_median3y) continue;
    const v = parseFloat(row.prix_tx_median3y);
    if (isNaN(v) || v <= 0) continue;
    result.set(row.code_commune, Math.round(v));
  }
  return result;
}

// ─── Mise à jour en base ──────────────────────────────────────────────────────

async function updatePrixTxMedians(medianes: Map<string, number>): Promise<{ updated: number; errors: string[] }> {
  const entries = [...medianes.entries()];
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const codes  = batch.map(([code]) => code);
    const values = batch.map(([, val]) => val);

    try {
      const result = await prisma.$executeRaw`
        UPDATE immo_score.communes AS c
        SET prix_tx_median3y = t.prix,
            updated_at       = NOW()
        FROM UNNEST(
          ${codes}::text[],
          ${values}::float8[]
        ) AS t(code_commune, prix)
        WHERE c.code_insee = t.code_commune
      `;
      updated += Number(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}–${i + batch.length} : ${msg}`);
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      process.stdout.write(`  → ${updated} communes mises à jour...\r`);
    }
  }

  return { updated, errors };
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== Agrégation DVF → prix_tx_median3y ===');
  if (TEST_MODE)     console.log('MODE TEST — limité à 500 communes');
  if (FILTER_DEPTS)  console.log(`Filtrage départements : ${FILTER_DEPTS.join(', ')}`);

  // 1. Calcul des médianes
  const medianes = await computePrixTxMedians();
  if (medianes.size === 0) {
    console.warn('  ⚠  Aucune médiane calculée — DVF absent ou données trop récentes.');
    process.exit(0);
  }

  // Statistiques de distribution
  const values = [...medianes.values()].sort((a, b) => a - b);
  const p25 = values[Math.floor(values.length * 0.25)];
  const p50 = values[Math.floor(values.length * 0.50)];
  const p75 = values[Math.floor(values.length * 0.75)];
  console.log(`[aggregate-dvf] Distribution prix tx médian : P25=${p25.toLocaleString()}€  P50=${p50.toLocaleString()}€  P75=${p75.toLocaleString()}€`);

  // 2. Mise à jour en base
  console.log(`\n[aggregate-dvf] Mise à jour de ${medianes.size} communes...`);
  const { updated, errors } = await updatePrixTxMedians(medianes);

  // 3. Couverture finale
  const cov = await prisma.$queryRaw<[{ total: string; with_prix: string }]>`
    SELECT COUNT(*)::text AS total,
           COUNT(prix_tx_median3y)::text AS with_prix
    FROM immo_score.communes
  `;
  const { total, with_prix } = cov[0];
  const pct = parseInt(total) > 0 ? ((parseInt(with_prix) / parseInt(total)) * 100).toFixed(1) : '0';

  console.log('\n=== Résultat ===');
  console.log(`  Communes mises à jour : ${updated}`);
  console.log(`  Couverture            : ${with_prix} / ${total} communes (${pct}%)`);
  console.log(`  Erreurs               : ${errors.length}`);
  console.log(`  Durée                 : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    errors.slice(0, 3).forEach(e => console.error(`  - ${e}`));
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
