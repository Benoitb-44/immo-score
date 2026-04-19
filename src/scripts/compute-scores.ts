/**
 * compute-scores.ts — v3.1
 *
 * Pipeline batch de calcul des scores composites.
 *
 * Étapes :
 *   0. Médianes nationales DVF (prix m² médian des médianes par commune)
 *   1. Médianes régionales DVF prix (SQL, gaussian en DB) — pour imputation
 *   2. Batch principal : upsert scores v4 avec imputation pour communes sans DVF
 *
 * Flags :
 *   --test            10 premières communes (dev)
 *   --witnesses       25 communes témoins
 *   --depts=33,69     Départements ciblés
 *   --audit-gaussian  Compare 3 coefficients gaussiens, ne commit pas
 *   --audit-anomalies Requête anomalies post-batch, export CSV
 */

import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { calculateScore, fetchNationalMedians, DVF_GAUSSIAN_COEF, NationalMedians } from '../lib/scoring';
import { getRegionFromCodeInsee } from '../lib/geo-regions';

const prisma = new PrismaClient();
const BATCH_SIZE = 100;

const TEST_MODE      = process.argv.includes('--test');
const WITNESSES_MODE = process.argv.includes('--witnesses');
const AUDIT_GAUSSIAN = process.argv.includes('--audit-gaussian');
const AUDIT_ANOMALIES = process.argv.includes('--audit-anomalies');
const TEST_LIMIT     = 10;
const DEPTS_ARG      = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS   = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;

// 25 communes témoins pour valider la distribution avant publication
const WITNESS_SLUGS = [
  // 7 grandes métropoles
  'paris', 'bordeaux', 'rennes', 'nantes', 'lyon', 'marseille', 'nice',
  // 1 témoin seuil haut
  'poitiers',
  // 5 communes à risque identifiées en v3
  'lignerolles', 'ile-d-yeu', 'ambleon', 'bandraboua', 'saint-juvin',
  // 12 villes moyennes
  'angers', 'niort', 'angouleme', 'le-mans', 'tours',
  'dijon', 'reims', 'metz', 'nancy', 'limoges', 'clermont-ferrand', 'pau',
];

// Préfectures de département (101 codes INSEE) pour l'audit anomalies
const PREFECTURES_CODES = [
  '01053','02408','03185','04070','05061','06088','07186','08105','09122','10387',
  '11069','12202','13055','14118','15014','16015','17300','18033','19272','2A004',
  '2B033','21231','22278','23096','24322','25056','26362','27229','28085','29232',
  '30189','31555','32013','33063','34172','35238','36044','37261','38185','39300',
  '40192','41018','42218','43157','44109','45234','46042','47001','48095','49007',
  '50502','51108','52121','53130','54395','55029','56260','57463','58194','59350',
  '60057','61001','62041','63113','64445','65440','66136','67482','68066','69123',
  '70550','71270','72181','73065','74010','75056','76540','77288','78646','79191',
  '80021','81004','82121','83137','84007','85191','86194','87085','88160','89025',
  '90010','91228','92050','93008','94028','95127','97105','97209','97302','97411',
  '97611',
];

// ─── Étape 1 : Médianes régionales DVF prix ──────────────────────────────────

interface RegionalMedianRow {
  region: string;
  median_dvf_prix_score: number | null;
}

/**
 * Calcule par SQL les médianes de score DVF prix par région.
 * Intègre la gaussienne directement en SQL pour éviter une 2e passe sur 35K communes.
 * Les communes des départements sans DVF (57, 67, 68, 976) sont naturellement exclues
 * de ce calcul (elles n'ont pas de données dans dvf_prix).
 */
async function computeRegionalDvfPrixMedians(
  nationalMedians: NationalMedians,
  gaussianCoef: number = DVF_GAUSSIAN_COEF,
): Promise<{ byRegion: Map<string, number>; global: number }> {
  if (!nationalMedians.appart || !nationalMedians.maison) {
    console.warn('[compute-scores] WARN: médianes nationales DVF incomplètes — imputation régionale désactivée');
    return { byRegion: new Map(), global: 50 };
  }

  const medA = nationalMedians.appart;
  const medM = nationalMedians.maison;
  const coef = gaussianCoef;

  const rows = await prisma.$queryRaw<RegionalMedianRow[]>`
    SELECT region,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dvf_prix_score)::float AS median_dvf_prix_score
    FROM (
      SELECT c.region,
        CASE
          WHEN prix_appart IS NOT NULL AND prix_maison IS NOT NULL THEN
            100.0 * EXP(${-coef} * ABS((prix_appart + prix_maison) / 2.0 - (${medA} + ${medM}) / 2.0)
                                      / ((${medA} + ${medM}) / 2.0))
          WHEN prix_appart IS NOT NULL THEN
            100.0 * EXP(${-coef} * ABS(prix_appart - ${medA}) / ${medA})
          WHEN prix_maison IS NOT NULL THEN
            100.0 * EXP(${-coef} * ABS(prix_maison - ${medM}) / ${medM})
          ELSE NULL
        END AS dvf_prix_score
      FROM (
        SELECT code_commune,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2) FILTER (WHERE type_local = 'Appartement') AS prix_appart,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2) FILTER (WHERE type_local = 'Maison')      AS prix_maison
        FROM immo_score.dvf_prix
        WHERE prix_m2 > 0 AND type_local IN ('Appartement', 'Maison')
        GROUP BY code_commune
      ) prix
      JOIN immo_score.communes c ON c.code_insee = prix.code_commune
    ) scored
    WHERE dvf_prix_score IS NOT NULL
    GROUP BY region
  `;

  const byRegion = new Map<string, number>();
  const allScores: number[] = [];

  for (const row of rows) {
    if (row.median_dvf_prix_score != null) {
      byRegion.set(row.region, row.median_dvf_prix_score);
      allScores.push(row.median_dvf_prix_score);
    }
  }

  allScores.sort((a, b) => a - b);
  const global = allScores.length > 0
    ? allScores[Math.floor(allScores.length / 2)]
    : 50;

  return { byRegion, global };
}

// ─── Mode audit gaussien ──────────────────────────────────────────────────────

const AUDIT_EXPECTED: Record<string, string> = {
  'paris': '30-50', 'rennes': '50-70', 'saint-juvin': '<40', 'lignerolles': '<40',
  'poitiers': '70-80', 'le-mans': '70-82', 'nantes': '>40',
  'metz': '60-75', 'strasbourg': '55-70',
};

async function runAuditGaussian(nationalMedians: NationalMedians): Promise<void> {
  const coefs = [0.5, 0.7, 0.9];

  console.log('\n[audit-gaussian] Tableau comparatif coefficients gaussiens DVF prix\n');

  const witnesses = await prisma.commune.findMany({
    where:   { slug: { in: WITNESS_SLUGS } },
    select:  { code_insee: true, nom: true, slug: true },
    orderBy: { nom: 'asc' },
  });

  // Pre-compute regional medians for each coef
  const fallbacksByCoef: Array<{ byRegion: Map<string, number>; global: number }> = [];
  for (const coef of coefs) {
    process.stdout.write(`\r[audit-gaussian] Calcul médianes régionales coef=${coef}...`);
    fallbacksByCoef.push(await computeRegionalDvfPrixMedians(nationalMedians, coef));
  }
  process.stdout.write('\n');

  console.log(
    'Commune'.padEnd(28) +
    coefs.map(c => `| coef=${c} `).join('') +
    '| Attendu',
  );
  console.log('-'.repeat(28 + coefs.length * 11 + 12));

  for (const commune of witnesses) {
    const scores: Array<number | null> = [];
    for (let i = 0; i < coefs.length; i++) {
      const fb = fallbacksByCoef[i];
      const result = await calculateScore(
        commune.code_insee, prisma, nationalMedians,
        fb.byRegion, fb.global, coefs[i],
      );
      scores.push(result?.score ?? null);
    }
    const exp = AUDIT_EXPECTED[commune.slug ?? ''] ?? '—';
    console.log(
      commune.nom.padEnd(28) +
      scores.map(s => `| ${String(s ?? 'null').padStart(7)} `).join('') +
      '| ' + exp,
    );
  }

  console.log('\n[audit-gaussian] ⚠️  Ne pas committer — décision humaine requise sur le coefficient.');
  console.log('[audit-gaussian] Coefficient actuel en production : ' + DVF_GAUSSIAN_COEF);
}

// ─── Mode audit anomalies ─────────────────────────────────────────────────────

interface AnomalyRow {
  nom: string;
  code_insee: string;
  population: number | null;
  score_global: number;
  score_dvf: number | null;
  score_dpe: number | null;
  score_risques: number | null;
  score_bpe: number | null;
  dvf_imputed: boolean;
  anomaly_type: string;
}

async function runAuditAnomalies(): Promise<void> {
  console.log('\n[audit-anomalies] Recherche d\'anomalies dans les scores v4...\n');

  const anomalies = await prisma.$queryRaw<AnomalyRow[]>`
    SELECT c.nom, c.code_insee, c.population,
           s.score_global, s.score_dvf, s.score_dpe, s.score_risques, s.score_bpe,
           s.dvf_imputed,
           CASE
             WHEN c.population > 50000 AND s.score_global < 25 THEN 'grande_ville_score_bas'
             WHEN c.population < 500 AND s.score_global > 70    THEN 'petite_commune_score_haut'
             WHEN c.code_insee = ANY(${PREFECTURES_CODES}) AND s.score_global < 35
               THEN 'prefecture_score_bas'
             ELSE 'autre'
           END AS anomaly_type
    FROM immo_score.scores s
    JOIN immo_score.communes c ON s.code_commune = c.code_insee
    WHERE s.version = 4
      AND (
        (c.population > 50000 AND s.score_global < 25)
        OR (c.population < 500 AND s.score_global > 70)
        OR (c.code_insee = ANY(${PREFECTURES_CODES}) AND s.score_global < 35)
      )
    ORDER BY anomaly_type, s.score_global DESC
  `;

  console.log(`[audit-anomalies] ${anomalies.length} anomalies détectées\n`);

  // Résumé par type
  const byType = new Map<string, number>();
  for (const a of anomalies) {
    byType.set(a.anomaly_type, (byType.get(a.anomaly_type) ?? 0) + 1);
  }
  for (const [type, count] of byType) {
    console.log(`  ${type.padEnd(30)} : ${count}`);
  }

  // Export CSV
  const csvPath = '/tmp/anomalies-v4.csv';
  const header  = 'nom,code_insee,population,score_global,score_dvf,score_dpe,score_risques,score_bpe,dvf_imputed,anomaly_type\n';
  const rows    = anomalies.map(a =>
    [a.nom.replace(/,/g, ';'), a.code_insee, a.population ?? '',
     a.score_global, a.score_dvf ?? '', a.score_dpe ?? '',
     a.score_risques ?? '', a.score_bpe ?? '',
     a.dvf_imputed, a.anomaly_type].join(','),
  ).join('\n');
  fs.writeFileSync(csvPath, header + rows, 'utf8');
  console.log(`\n[audit-anomalies] Export CSV : ${csvPath}`);
  console.log('[audit-anomalies] ⚠️  Validation humaine requise avant publication.');
}

// ─── Batch principal ──────────────────────────────────────────────────────────

interface ComputeResult {
  communes_processed: number;
  communes_updated:   number;
  communes_skipped:   number;
  communes_errored:   number;
  duration_ms:        number;
  errors:             string[];
}

async function main(): Promise<ComputeResult> {
  const startedAt = Date.now();

  // ── Étape 0 : médianes nationales DVF ────────────────────────────────────────
  console.log('\n[compute-scores] Étape 0 : médianes nationales DVF...');
  const nationalMedians = await fetchNationalMedians(prisma);
  console.log(
    `[compute-scores] Médianes nationales DVF : ` +
    `Appartement=${nationalMedians.appart?.toFixed(0) ?? 'N/A'}€/m², ` +
    `Maison=${nationalMedians.maison?.toFixed(0) ?? 'N/A'}€/m²`,
  );

  // ── Mode audit gaussien (ne lance pas le batch) ───────────────────────────────
  if (AUDIT_GAUSSIAN) {
    await runAuditGaussian(nationalMedians);
    await prisma.$disconnect();
    process.exit(0);
  }

  // ── Étape 1 : médianes régionales DVF prix ───────────────────────────────────
  console.log('[compute-scores] Étape 1 : médianes régionales DVF prix (imputation)...');
  const { byRegion: dvfFallbackByRegion, global: dvfFallbackGlobal } =
    await computeRegionalDvfPrixMedians(nationalMedians);
  console.log(`[compute-scores] ${dvfFallbackByRegion.size} régions avec médiane DVF prix (fallback global=${dvfFallbackGlobal.toFixed(1)})`);
  for (const [region, score] of [...dvfFallbackByRegion.entries()].sort()) {
    console.log(`  ${region.padEnd(30)} : ${score.toFixed(1)}`);
  }

  // ── Sélection des communes ────────────────────────────────────────────────────
  let whereClause: Record<string, unknown> = {};
  let total: number;

  if (WITNESSES_MODE) {
    whereClause = { slug: { in: WITNESS_SLUGS } };
    total = await prisma.commune.count({ where: whereClause });
    console.log(`\n[compute-scores] MODE WITNESSES — ${total} communes témoins\n`);
  } else if (FILTER_DEPTS) {
    whereClause = { departement: { in: FILTER_DEPTS } };
    total = await prisma.commune.count({ where: whereClause });
    console.log(`[compute-scores] Mode ciblé : départements ${FILTER_DEPTS.join(', ')}`);
  } else if (TEST_MODE) {
    total = TEST_LIMIT;
    console.log(`\n[compute-scores] MODE TEST — ${total} communes\n`);
  } else {
    total = await prisma.commune.count();
    console.log(`\n[compute-scores] ${total} communes à traiter (batch=${BATCH_SIZE})\n`);
  }

  let processed = 0, updated = 0, skipped = 0, errored = 0;
  let withRisques = 0, withBpe = 0, withDvfImputed = 0;
  const errors: string[] = [];

  let offset = 0;

  while (offset < total) {
    const batchSize = Math.min(BATCH_SIZE, total - offset);
    const communes = await prisma.commune.findMany({
      select:  { code_insee: true, nom: true },
      where:   whereClause,
      orderBy: { code_insee: 'asc' },
      skip:    offset,
      take:    batchSize,
    });
    if (communes.length === 0) break;

    for (const commune of communes) {
      try {
        const result = await calculateScore(
          commune.code_insee, prisma, nationalMedians,
          dvfFallbackByRegion, dvfFallbackGlobal,
        );

        if (!result) { skipped++; processed++; continue; }

        if (result.details.risques.score != null) withRisques++;
        if (result.details.bpe.score     != null) withBpe++;
        if (result.details.dvf.imputed)            withDvfImputed++;

        await prisma.score.upsert({
          where:  { code_commune: commune.code_insee },
          create: {
            code_commune:       commune.code_insee,
            score_global:       result.score,
            score_dvf:          result.details.dvf.score,
            score_dpe:          result.details.dpe.score,
            score_bpe:          result.details.bpe.score,
            score_risques:      result.details.risques.score,
            computed_at:        new Date(),
            version:            4,
            dvf_imputed:        result.details.dvf.imputed ?? false,
            dvf_imputed_method: result.details.dvf.imputed_method ?? null,
            dvf_imputed_region: result.details.dvf.imputed_region ?? null,
            dvf_imputed_value:  result.details.dvf.imputed_value  ?? null,
          },
          update: {
            score_global:       result.score,
            score_dvf:          result.details.dvf.score,
            score_dpe:          result.details.dpe.score,
            score_bpe:          result.details.bpe.score,
            score_risques:      result.details.risques.score,
            computed_at:        new Date(),
            version:            4,
            dvf_imputed:        result.details.dvf.imputed ?? false,
            dvf_imputed_method: result.details.dvf.imputed_method ?? null,
            dvf_imputed_region: result.details.dvf.imputed_region ?? null,
            dvf_imputed_value:  result.details.dvf.imputed_value  ?? null,
          },
        });

        if (TEST_MODE || WITNESSES_MODE) {
          const d = result.details;
          const imp = d.dvf.imputed ? ` [IMPUTED:${d.dvf.imputed_method}]` : '';
          console.log(
            `  ${commune.nom.padEnd(28)} | global=${String(result.score).padStart(4)} ` +
            `| DVF=${String(d.dvf.score?.toFixed(1) ?? 'null').padStart(5)}${imp} ` +
            `(prix=${String(d.dvf.score_prix?.toFixed(1) ?? 'null').padStart(5)}, ` +
            `liq=${String(d.dvf.score_liq?.toFixed(1) ?? 'null').padStart(5)}, ` +
            `${d.dvf.prix_m2_median ?? 'N/A'}€/m²) ` +
            `| DPE=${String(d.dpe.score?.toFixed(1) ?? 'null').padStart(5)} ` +
            `| Risques=${String(d.risques.score?.toFixed(1) ?? 'null').padStart(5)} ` +
            `| BPE=${String(d.bpe.score?.toFixed(1) ?? 'null').padStart(5)}`,
          );
        }

        updated++; processed++;
      } catch (err) {
        errored++; processed++;
        const msg = `${commune.code_insee} (${commune.nom}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        if (errors.length < 20) errors.push(msg);
      }
    }

    if (!TEST_MODE && !WITNESSES_MODE) {
      const pct        = Math.round((processed / total) * 100);
      const batchNum   = Math.ceil(offset / BATCH_SIZE) + 1;
      const totalBatch = Math.ceil(total / BATCH_SIZE);
      process.stdout.write(
        `\r[compute-scores] batch ${batchNum}/${totalBatch} — ${processed}/${total} (${pct}%) ` +
        `— ✓ ${updated} mis à jour, ↷ ${skipped} sans données, ✗ ${errored} erreurs`,
      );
    }
    offset += BATCH_SIZE;
  }

  if (!TEST_MODE && !WITNESSES_MODE) process.stdout.write('\n');

  const duration_ms = Date.now() - startedAt;
  console.log(`[compute-scores] Couverture Géorisques  : ${withRisques} communes avec score_risques / ${processed} total`);
  console.log(`[compute-scores] Couverture BPE         : ${withBpe} communes avec score_bpe / ${processed} total`);
  console.log(`[compute-scores] DVF imputées (région)  : ${withDvfImputed} communes`);

  // ── Mode audit anomalies (post-batch) ─────────────────────────────────────────
  if (AUDIT_ANOMALIES) {
    await runAuditAnomalies();
  }

  return { communes_processed: processed, communes_updated: updated, communes_skipped: skipped, communes_errored: errored, duration_ms, errors };
}

main()
  .then((result) => {
    console.log('\n[compute-scores] Terminé :');
    console.log(`  Traitées         : ${result.communes_processed}`);
    console.log(`  Mises à jour     : ${result.communes_updated}`);
    console.log(`  Sans données     : ${result.communes_skipped}`);
    console.log(`  Erreurs          : ${result.communes_errored}`);
    console.log(`  Durée            : ${(result.duration_ms / 1000).toFixed(1)}s`);
    if (result.errors.length > 0) {
      console.log('\nPremières erreurs :');
      result.errors.forEach((e) => console.log(`  — ${e}`));
    }
    const errorRate = result.communes_processed > 0
      ? result.communes_errored / result.communes_processed : 0;
    if (errorRate > 0.1) {
      console.error(`\n[compute-scores] ALERTE: taux d'erreur ${(errorRate * 100).toFixed(1)}% > 10%`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err) => { console.error('[compute-scores] Erreur fatale:', err); process.exit(1); })
  .finally(() => { prisma.$disconnect(); });
