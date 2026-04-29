/**
 * compute-accessibilite.ts — Sprint 4-A patch
 *
 * Calcul batch du score d'accessibilité financière (0-100) pour toutes les communes.
 * Unité : années de revenu disponible par UC (≈ "Median Multiple UC").
 *
 * Hiérarchie 4 niveaux :
 *
 *   Niveau 1 — Cerema DV3F 2022-2024 (meilleure source, imputed=false) :
 *     commune dans cerema_accessibilite → MM = min(d5_appartement, d5_maison)
 *     method = 'cerema_aav_d5_2022_2024'
 *
 *   Niveau 2 — DVF + Filosofi 2021 (imputed=true) :
 *     MM = prix_tx_median3y / median_uc_filosofi_2021
 *     method = 'dvf_filosofi'
 *
 *   Niveau 3 — médiane départementale des niveaux 1+2 (imputed=true) :
 *     method = 'regional_median'
 *
 *   Niveau 4 — médiane nationale (fallback ultime, imputed=true) :
 *     method = 'national_median'
 *
 * Paliers interpolation linéaire (unité : années de revenu UC) :
 *   [(0, 95), (3.44, 90), (4.64, 75), (6.46, 55), (8.34, 30), (10.57, 10)]
 *   Cap supérieur = 95 (pas 100 — réservé aux MM < 3.44).
 *   Floor = 10 strict pour MM ≥ 10.57.
 *
 *   Paliers calibrés data-driven sur audit distribution Cerema 2022-2024 (2026-04-29) :
 *     P10=3.44 → score 90 | P25=4.64 → 75 | P50=6.46 → 55 | P75=8.34 → 30 | P90=10.57 → 10
 *   Source : 3305 communes, min=1.32, max=31.29, mean=6.77, σ=2.96.
 *
 * Flags CLI :
 *   --test            10 premières communes (dev)
 *   --witnesses       Communes témoins uniquement
 *   --depts=33,69     Départements ciblés
 *   --dry-run         Calcule mais n'écrit pas en base
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 100;

const TEST_MODE      = process.argv.includes('--test');
const WITNESSES_MODE = process.argv.includes('--witnesses');
const DRY_RUN        = process.argv.includes('--dry-run');
const DEPTS_ARG      = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS   = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;

// ─── Communes témoins (v4-A data-driven — paliers calibrés 2026-04-29) ────────
// MM réels issus de l'audit Cerema 2022-2024 ; tolérances ±5 pts ; seuil go 8/10.

const WITNESS_COMMUNES: Record<string, {
  name: string;
  expected_mm: number;
  expected_score_min: number;
  expected_score_max: number;
}> = {
  '19272': { name: 'Tulle',       expected_mm:  2.57, expected_score_min: 90, expected_score_max: 95 },
  '08392': { name: 'Saint-Juvin', expected_mm:  4.36, expected_score_min: 73, expected_score_max: 83 },
  '03310': { name: 'Vichy',       expected_mm:  4.00, expected_score_min: 75, expected_score_max: 85 },
  '24322': { name: 'Sarlat',      expected_mm:  4.13, expected_score_min: 74, expected_score_max: 84 },
  '72181': { name: 'Le Mans',     expected_mm:  4.29, expected_score_min: 73, expected_score_max: 83 },
  '35238': { name: 'Rennes',      expected_mm:  8.02, expected_score_min: 27, expected_score_max: 37 },
  '83069': { name: 'Hyères',      expected_mm:  8.73, expected_score_min: 20, expected_score_max: 30 },
  '33063': { name: 'Bordeaux',    expected_mm:  9.35, expected_score_min: 15, expected_score_max: 25 },
  '69123': { name: 'Lyon',        expected_mm: 10.42, expected_score_min:  8, expected_score_max: 15 },
  '75056': { name: 'Paris',       expected_mm: 13.25, expected_score_min: 10, expected_score_max: 10 },
};

// ─── Scoring (paliers linéaires, unité : années revenu UC) ────────────────────

const FLOOR_SCORE = 10;

// Breakpoints : [mm_seuil, score_au_seuil]
// Calibrés sur percentiles réels Cerema 2022-2024 (audit 2026-04-29, n=3305 communes).
const BREAKPOINTS: [number, number][] = [
  [0,      95],  // cap — aucune commune ne score 100
  [3.44,   90],  // P10
  [4.64,   75],  // P25
  [6.46,   55],  // P50 médiane
  [8.34,   30],  // P75
  [10.57,  10],  // P90 → floor strict
];

/**
 * Convertit un nombre d'années de revenu UC en score 0-100.
 * Interpolation linéaire entre les paliers Cerema/DV3F.
 * Floor 10 strict pour éviter l'annihilation dans le score géométrique global.
 */
function mmToScore(mm: number): number {
  if (mm <= BREAKPOINTS[0][0]) return BREAKPOINTS[0][1]; // 95 cap

  for (let i = 0; i < BREAKPOINTS.length - 1; i++) {
    const [x0, y0] = BREAKPOINTS[i];
    const [x1, y1] = BREAKPOINTS[i + 1];
    if (mm <= x1) {
      const raw = y0 + ((mm - x0) / (x1 - x0)) * (y1 - y0);
      return Math.max(FLOOR_SCORE, Math.round(raw * 10) / 10);
    }
  }

  // Au-delà du dernier breakpoint → floor
  return FLOOR_SCORE;
}

// ─── Chargement des données ───────────────────────────────────────────────────

interface CommuneData {
  code_insee:       string;
  region:           string;
  prix_tx_median3y: number | null;
  median_uc:        number | null;
}

interface CeremaComData {
  d5_appart: number | null;
  d5_maison: number | null;
}

async function loadAllData(): Promise<{
  communes:        Map<string, CommuneData>;
  ceremaByCommune: Map<string, CeremaComData>;
}> {
  console.log('[compute-accessibilite] Chargement des données...');

  const communeRows = await prisma.$queryRaw<Array<{
    code_insee:       string;
    region:           string;
    prix_tx_median3y: string | null;
  }>>`
    SELECT code_insee, region, prix_tx_median3y::text
    FROM immo_score.communes
    ORDER BY code_insee
  `;

  const filosofiRows = await prisma.$queryRaw<Array<{
    commune_id: string;
    median_uc:  string;
  }>>`
    SELECT commune_id, median_uc::text
    FROM immo_score.filosofi_communes
  `;
  const filosofiMap = new Map<string, number>();
  for (const r of filosofiRows) {
    const v = parseFloat(r.median_uc);
    if (!isNaN(v) && v > 0) filosofiMap.set(r.commune_id, v);
  }

  // Cerema indexé par commune_id (niveau 1 — données directes par commune)
  const ceremaRows = await prisma.$queryRaw<Array<{
    commune_id: string;
    d5_appart:  string | null;
    d5_maison:  string | null;
  }>>`
    SELECT commune_id, d5_appart::text, d5_maison::text
    FROM immo_score.cerema_accessibilite
  `;
  const ceremaByCommune = new Map<string, CeremaComData>();
  for (const r of ceremaRows) {
    const d5a = r.d5_appart  ? parseFloat(r.d5_appart)  : null;
    const d5m = r.d5_maison  ? parseFloat(r.d5_maison)  : null;
    ceremaByCommune.set(r.commune_id, {
      d5_appart: d5a && !isNaN(d5a) && d5a > 0 ? d5a : null,
      d5_maison: d5m && !isNaN(d5m) && d5m > 0 ? d5m : null,
    });
  }

  const communes = new Map<string, CommuneData>();
  for (const r of communeRows) {
    const prix = r.prix_tx_median3y ? parseFloat(r.prix_tx_median3y) : null;
    communes.set(r.code_insee, {
      code_insee:       r.code_insee,
      region:           r.region,
      prix_tx_median3y: prix && prix > 0 ? prix : null,
      median_uc:        filosofiMap.get(r.code_insee) ?? null,
    });
  }

  console.log(
    `[compute-accessibilite] Communes : ${communes.size} | ` +
    `Filosofi 2021 : ${filosofiMap.size} | Cerema direct : ${ceremaByCommune.size}`,
  );

  return { communes, ceremaByCommune };
}

// ─── Médianes départementales (pour niveau 3) ─────────────────────────────────

interface ComputedScore {
  code_insee:    string;
  mm:            number;
  score:         number;
  imputed:       boolean;
  method:        string;
}

function computeDeptMedians(scores: ComputedScore[]): Map<string, number> {
  const byDept = new Map<string, number[]>();
  for (const s of scores) {
    const dept = s.code_insee.substring(0, 2);
    const arr  = byDept.get(dept) ?? [];
    arr.push(s.mm);
    byDept.set(dept, arr);
  }
  const medians = new Map<string, number>();
  for (const [dept, mms] of byDept) {
    mms.sort((a, b) => a - b);
    medians.set(dept, mms[Math.floor(mms.length / 2)]);
  }
  return medians;
}

// ─── Calcul commune par commune ───────────────────────────────────────────────

function computeScore(
  commune:         CommuneData,
  ceremaByCommune: Map<string, CeremaComData>,
  deptMedians:     Map<string, number>,
  nationalMedian:  number,
): ComputedScore {
  const { code_insee, prix_tx_median3y, median_uc } = commune;

  // Niveau 1 — Cerema DV3F direct (meilleure donnée, imputed=false)
  const cerema = ceremaByCommune.get(code_insee);
  if (cerema) {
    const candidates = [cerema.d5_appart, cerema.d5_maison].filter(
      (v): v is number => v != null && v > 0,
    );
    if (candidates.length > 0) {
      const mm = Math.round(Math.min(...candidates) * 100) / 100;
      return { code_insee, mm, score: mmToScore(mm), imputed: false, method: 'cerema_aav_d5_2022_2024' };
    }
  }

  // Niveau 2 — DVF + Filosofi 2021 (imputed=true)
  if (prix_tx_median3y != null && median_uc != null && median_uc > 0) {
    const mm = Math.round((prix_tx_median3y / median_uc) * 100) / 100;
    return { code_insee, mm, score: mmToScore(mm), imputed: true, method: 'dvf_filosofi' };
  }

  // Niveau 3 — médiane départementale
  const dept    = code_insee.substring(0, 2);
  const deptMed = deptMedians.get(dept);
  if (deptMed != null) {
    return { code_insee, mm: deptMed, score: mmToScore(deptMed), imputed: true, method: 'regional_median' };
  }

  // Niveau 4 — médiane nationale (fallback ultime)
  return { code_insee, mm: nationalMedian, score: mmToScore(nationalMedian), imputed: true, method: 'national_median' };
}

// ─── Upsert batch ─────────────────────────────────────────────────────────────

async function upsertScores(scores: ComputedScore[]): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < scores.length; i += BATCH_SIZE) {
    const batch = scores.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$executeRaw`
        INSERT INTO immo_score.score_communes
          (id, commune_id, version, score_accessibilite_fin, median_multiple,
           accessibilite_imputed, imputation_methods, computed_at, updated_at)
        SELECT
          gen_random_uuid()::text,
          t.commune_id, 4::int,
          t.score, t.mm,
          t.imputed, t.methods::jsonb,
          NOW(), NOW()
        FROM UNNEST(
          ${batch.map(r => r.code_insee)}::text[],
          ${batch.map(r => r.score)}::float8[],
          ${batch.map(r => r.mm)}::float8[],
          ${batch.map(r => r.imputed)}::boolean[],
          ${batch.map(r => JSON.stringify({ method: r.method }))}::text[]
        ) AS t(commune_id, score, mm, imputed, methods)
        ON CONFLICT (commune_id) DO UPDATE
          SET score_accessibilite_fin = EXCLUDED.score_accessibilite_fin,
              median_multiple         = EXCLUDED.median_multiple,
              accessibilite_imputed   = EXCLUDED.accessibilite_imputed,
              imputation_methods      = EXCLUDED.imputation_methods,
              version                 = EXCLUDED.version,
              computed_at             = NOW(),
              updated_at              = NOW()
      `;
      updated += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}–${i + batch.length} : ${msg}`);
    }
  }

  return { updated, errors };
}

// ─── Validation witnesses ─────────────────────────────────────────────────────

function validateWitnesses(scores: Map<string, ComputedScore>): void {
  console.log('\n[compute-accessibilite] ═══ Validation witnesses ═══');
  let ok = 0, fail = 0;

  for (const [code, expected] of Object.entries(WITNESS_COMMUNES)) {
    const result = scores.get(code);
    if (!result) {
      console.log(`  ✗ ${expected.name.padEnd(16)} (${code}) — ABSENT`);
      fail++;
      continue;
    }

    const inRange = result.score >= expected.expected_score_min
                 && result.score <= expected.expected_score_max;
    const icon  = inRange ? '✓' : '✗';
    const range = `[${expected.expected_score_min}–${expected.expected_score_max}]`;

    console.log(
      `  ${icon} ${expected.name.padEnd(16)} | MM=${String(result.mm.toFixed(2)).padStart(5)} ` +
      `| score=${String(result.score.toFixed(1)).padStart(5)} ${range} ` +
      `| ${result.method}`,
    );

    if (inRange) ok++; else fail++;
  }

  const total = Object.keys(WITNESS_COMMUNES).length;
  console.log(`\n  Résultat witnesses : ${ok}/${total} OK, ${fail} hors tolérance (seuil 8/${total})`);
  if (ok < 8) {
    console.warn(`  ⚠  Moins de 8/${total} witnesses dans la tolérance — vérifier l'algorithme.`);
  }
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== compute-accessibilite.ts — Sprint 4-A ===');
  if (TEST_MODE)      console.log('MODE TEST');
  if (WITNESSES_MODE) console.log('MODE WITNESSES');
  if (DRY_RUN)        console.log('MODE DRY-RUN (pas d\'écriture en base)');
  if (FILTER_DEPTS)   console.log(`Filtrage départements : ${FILTER_DEPTS.join(', ')}`);

  // 1. Chargement
  const { communes, ceremaByCommune } = await loadAllData();

  // 2. Sélection des communes à traiter
  let communeList = [...communes.values()];
  if (TEST_MODE) {
    communeList = communeList.slice(0, 10);
  } else if (WITNESSES_MODE) {
    const witnessCodes = Object.keys(WITNESS_COMMUNES);
    communeList = communeList.filter(c => witnessCodes.includes(c.code_insee));
  } else if (FILTER_DEPTS) {
    communeList = communeList.filter(c =>
      FILTER_DEPTS.some(d => c.code_insee.startsWith(d)),
    );
  }
  console.log(`\n[compute-accessibilite] ${communeList.length} communes à traiter`);

  // 3. Passe initiale niveaux 1+2 pour dériver les médianes départementales
  const passeInit: ComputedScore[] = [];
  for (const c of communeList) {
    const cerema = ceremaByCommune.get(c.code_insee);
    if (cerema) {
      const candidates = [cerema.d5_appart, cerema.d5_maison].filter(
        (v): v is number => v != null && v > 0,
      );
      if (candidates.length > 0) {
        const mm = Math.round(Math.min(...candidates) * 100) / 100;
        passeInit.push({ code_insee: c.code_insee, mm, score: mmToScore(mm), imputed: false, method: 'cerema_aav_d5_2022_2024' });
        continue;
      }
    }
    if (c.prix_tx_median3y != null && c.median_uc != null && c.median_uc > 0) {
      const mm = Math.round((c.prix_tx_median3y / c.median_uc) * 100) / 100;
      passeInit.push({ code_insee: c.code_insee, mm, score: mmToScore(mm), imputed: true, method: 'dvf_filosofi' });
    }
  }
  console.log(`[compute-accessibilite] Passe init (niveaux 1+2) : ${passeInit.length} communes`);

  const deptMedians   = computeDeptMedians(passeInit);
  const allMms        = passeInit.map(r => r.mm).sort((a, b) => a - b);
  const nationalMedian = allMms.length > 0 ? allMms[Math.floor(allMms.length / 2)] : 6.0;
  console.log(`[compute-accessibilite] Médiane nationale MM : ${nationalMedian.toFixed(2)}`);

  // 4. Calcul complet (4 niveaux)
  const allScores = new Map<string, ComputedScore>();
  let n1 = 0, n2 = 0, n3 = 0, n4 = 0;

  for (const commune of communeList) {
    const result = computeScore(commune, ceremaByCommune, deptMedians, nationalMedian);
    allScores.set(commune.code_insee, result);
    if      (result.method === 'cerema_aav_d5_2022_2024') n1++;
    else if (result.method === 'dvf_filosofi')            n2++;
    else if (result.method === 'regional_median')         n3++;
    else                                                  n4++;
  }

  console.log(
    `[compute-accessibilite] Répartition méthodes :\n` +
    `  Niveau 1 cerema_aav_d5_2022_2024 : ${n1}\n` +
    `  Niveau 2 dvf_filosofi            : ${n2}\n` +
    `  Niveau 3 regional_median         : ${n3}\n` +
    `  Niveau 4 national_median         : ${n4}`,
  );

  // 5. Validation witnesses si mode dédié ou batch complet
  if (WITNESSES_MODE || (!TEST_MODE && !FILTER_DEPTS)) {
    validateWitnesses(allScores);
  }

  if (DRY_RUN) {
    console.log('\n[compute-accessibilite] DRY-RUN — aucune écriture en base.');
    const sample = [...allScores.values()].slice(0, 5);
    for (const s of sample) {
      console.log(`  ${s.code_insee} | MM=${s.mm.toFixed(2)} | score=${s.score.toFixed(1)} | ${s.method}`);
    }
    process.exit(0);
  }

  // 6. Upsert
  const scoreList = [...allScores.values()];
  console.log(`\n[compute-accessibilite] Upsert de ${scoreList.length} scores...`);
  const { updated, errors } = await upsertScores(scoreList);

  // 7. Distribution (batch complet)
  if (!TEST_MODE && !WITNESSES_MODE && !FILTER_DEPTS) {
    const dist = await prisma.$queryRaw<Array<{ bucket: string; cnt: string }>>`
      SELECT width_bucket(score_accessibilite_fin, 0, 100, 10)::text AS bucket,
             COUNT(*)::text AS cnt
      FROM immo_score.score_communes
      WHERE version = 4
      GROUP BY 1
      ORDER BY 1
    `;
    console.log('\n[compute-accessibilite] Distribution (buckets 0-100) :');
    const maxCnt = Math.max(...dist.map(r => parseInt(r.cnt)), 1);
    for (const row of dist) {
      const lo  = (parseInt(row.bucket) - 1) * 10;
      const hi  = parseInt(row.bucket) * 10;
      const bar = '█'.repeat(Math.round(parseInt(row.cnt) / maxCnt * 20));
      console.log(`  [${String(lo).padStart(3)}-${String(hi).padStart(3)}] ${row.cnt.padStart(6)} ${bar}`);
    }
  }

  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== Résultat ===');
  console.log(`  Scores calculés : ${allScores.size}`);
  console.log(`  Scores upsertés : ${updated}`);
  console.log(`  Erreurs         : ${errors.length}`);
  console.log(`  Durée           : ${duration}s`);

  if (errors.length > 0) {
    console.error('\n  Détail erreurs (3 premiers) :');
    errors.slice(0, 3).forEach(e => console.error(`  - ${e}`));
    if (errors.length / scoreList.length > 0.05) {
      console.error(`\n[compute-accessibilite] ALERTE : taux d'erreur > 5%`);
      process.exit(1);
    }
  }
}

main()
  .catch(err => { console.error('[compute-accessibilite] ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
