/**
 * ingest-loyers-oll-amp.ts
 * Ingestion OLL AMP/Marseille IRIS → 13055 (N1bis), agrégation 2 étapes.
 *
 * Source IRIS   : API data.ampmetropole.fr (format pivot wide ~68 col, UTF-8 BOM)
 *                 Pré-téléchargé par probe step 2 : /tmp/probe-loyers/amp-loyers.csv
 * Source zonage : L1300Zonage2024.csv — mapping IRIS → arrondissement 13201-13216
 *                 Attendu : /tmp/probe-loyers/L1300Zonage2024.csv
 *
 * Agrégation 2 étapes (pondéré nb_obs) :
 *   1. IRIS → arrondissement : loyer_arr = Σ(loyer_iris × nb_obs_iris) / Σ(nb_obs_iris)
 *   2. 16 arrondissements → 13055 : loyer_13055 = Σ(loyer_arr × nb_obs_arr) / Σ(nb_obs_arr)
 *
 * Logs intermédiaires : /tmp/loyers-amp-arrondissements.json (non persistés en BDD)
 *
 * IDEMPOTENCE : ON CONFLICT (commune_id) DO UPDATE — re-run sans danger.
 *
 * Usage :
 *   npm run ingest:oll-amp
 *   npm run ingest:oll-amp -- --iris-csv=/tmp/amp.csv --zonage-csv=/tmp/L1300Zonage2024.csv
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const prisma = new PrismaClient();

const COMMUNE_ID = '13055';
const NIVEAU     = 'N1bis';
const SOURCE     = 'oll_amp';
const MILLESIME  = 2024;
const LOG_PATH   = '/tmp/loyers-amp-arrondissements.json';

const IRIS_CSV_ARG   = process.argv.find(a => a.startsWith('--iris-csv='));
const ZONAGE_CSV_ARG = process.argv.find(a => a.startsWith('--zonage-csv='));
const IRIS_CSV_PATH   = IRIS_CSV_ARG   ? IRIS_CSV_ARG.replace('--iris-csv=', '')     : '/tmp/probe-loyers/amp-loyers.csv';
const ZONAGE_CSV_PATH = ZONAGE_CSV_ARG ? ZONAGE_CSV_ARG.replace('--zonage-csv=', '') : '/tmp/probe-loyers/L1300Zonage2024.csv';

// ─── Colonnes IRIS loyers (data.ampmetropole.fr OLL AMP 2024) ──────────────────
// Aucun fallback. Si une colonne est absente → findColStrict throw avec headers reçus.
// TODO VPS : confirmer via `head -2 /tmp/probe-loyers/amp-loyers.csv | iconv -f utf8`
const COL_IRIS_CODE = 'code_iris';
const COL_LOYER     = 'loy_med_tout';    // loyer médian toutes époques/types
const COL_NB_OBS    = 'nb_obs_tout';     // effectif toutes époques/types
const COL_Q1        = 'q1_tout';         // 1er quartile toutes époques/types
const COL_Q3        = 'q3_tout';         // 3e quartile toutes époques/types

// ─── Colonnes Zonage L1300Zonage2024.csv (OLL standard AMP) ──────────────────────
// TODO VPS : confirmer via `head -2 /tmp/probe-loyers/L1300Zonage2024.csv`
const COL_ZONAGE_IRIS = 'code_iris';
const COL_ZONAGE_ARR  = 'code_commune';

// 16 arrondissements Marseille
const ARR_CODES = [
  '13201','13202','13203','13204','13205','13206','13207','13208',
  '13209','13210','13211','13212','13213','13214','13215','13216',
];

// Witness 13055 (probe step 2)
const WITNESS_MIN = 11;
const WITNESS_MAX = 13;

interface IrisData {
  irisCode: string;
  loyerM2:  number;
  nbObs:    number;
  q1M2:     number | null;
  q3M2:     number | null;
}

interface ZonageRow {
  irisCode: string;
  arrCode:  string;
}

interface ArrResult {
  arrCode: string;
  loyerM2: number;
  nbObs:   number;
  q1M2:    number | null;
  q3M2:    number | null;
}

interface ArrAccumulator {
  sumLoyer: number;
  sumQ1:    number;
  sumQ3:    number;
  totalObs: number;
  hasQ1:    boolean;
  hasQ3:    boolean;
}

function parseFr(raw: string): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t === '' || t === 'NA' || t === 'null' || t === 'NaN') return null;
  const v = parseFloat(t.replace(',', '.'));
  return isNaN(v) ? null : v;
}

function parseIntFr(raw: string): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t === '' || t === 'NA' || t === 'null') return null;
  const v = parseInt(t.replace(/\s/g, ''), 10);
  return isNaN(v) ? null : v;
}

function findColStrict(headers: string[], colName: string): number {
  // Strip BOM + normalize to lowercase for comparison
  const lower = headers.map(h => h.replace(/﻿/g, '').toLowerCase());
  const idx = lower.indexOf(colName.toLowerCase());
  if (idx === -1) {
    throw new Error(
      `Colonne "${colName}" absente du CSV.\n` +
      `Headers reçus (${headers.length}) : ${headers.join('; ')}\n` +
      `→ Mettre à jour la constante correspondante dans le script.`,
    );
  }
  return idx;
}

function readLocalCsv(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(
      `Fichier introuvable : ${filePath}\n\n` +
      `Pour télécharger les fichiers manquants :\n` +
      `  IRIS loyers  : données OLL AMP 2024 sur data.ampmetropole.fr (dataset observatoire-local-des-loyers)\n` +
      `  Zonage       : L1300Zonage2024.csv sur data.gouv.fr (OLL zonage AMP)\n\n` +
      `Puis relancer avec :\n` +
      `  npm run ingest:oll-amp -- --iris-csv=/tmp/amp.csv --zonage-csv=/tmp/L1300Zonage2024.csv`,
    );
  }
  const buf = readFileSync(filePath);
  // Strip UTF-8 BOM si présent
  const raw = buf.toString('utf8');
  return raw.startsWith('﻿') ? raw.slice(1) : raw;
}

function parseZonage(content: string): ZonageRow[] {
  const sep = content.includes(';') ? ';' : ',';
  const lines = content.split('\n');

  const rows: ZonageRow[] = [];
  let lineCount = 0;
  let irisIdx = -1, arrIdx = -1;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

    if (lineCount === 1) {
      irisIdx = findColStrict(cols, COL_ZONAGE_IRIS);
      arrIdx  = findColStrict(cols, COL_ZONAGE_ARR);

      console.log(`  Zonage indices : iris[${irisIdx}] arr[${arrIdx}]`);
      console.log(`  Colonnes (${cols.length}) : ${cols.slice(0, 8).join(' | ')}...`);
      continue;
    }

    const irisCode = cols[irisIdx]?.trim();
    const arrCode  = cols[arrIdx]?.trim();
    if (!irisCode || !arrCode) continue;
    if (!ARR_CODES.includes(arrCode)) continue;

    rows.push({ irisCode, arrCode });
  }

  console.log(`  → ${rows.length} IRIS Marseille dans le zonage (sur ${lineCount} lignes)`);
  return rows;
}

interface IrisColMap {
  iris:  number;
  loyer: number;
  obs:   number;
  q1:    number;
  q3:    number;
}

function parseIrisCsv(content: string): IrisData[] {
  const sep = content.includes(';') ? ';' : ',';
  const lines = content.split('\n');

  const rows: IrisData[] = [];
  let lineCount = 0;
  let colMap: IrisColMap | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

    if (lineCount === 1) {
      colMap = {
        iris:  findColStrict(cols, COL_IRIS_CODE),
        loyer: findColStrict(cols, COL_LOYER),
        obs:   findColStrict(cols, COL_NB_OBS),
        q1:    findColStrict(cols, COL_Q1),
        q3:    findColStrict(cols, COL_Q3),
      };

      console.log(`  IRIS indices : iris[${colMap.iris}] loyer[${colMap.loyer}] nbObs[${colMap.obs}] q1[${colMap.q1}] q3[${colMap.q3}]`);
      console.log(`  Total colonnes : ${cols.length} | Ex : ${cols.slice(0, 6).join(' | ')}...`);
      continue;
    }

    if (!colMap) continue;
    if (cols.length <= Math.max(colMap.iris, colMap.loyer, colMap.obs)) continue;

    const irisCode = cols[colMap.iris]?.trim();
    const loyer    = parseFr(cols[colMap.loyer]);
    const nbObs    = parseIntFr(cols[colMap.obs]);

    if (!irisCode || loyer === null || nbObs === null || nbObs <= 0) continue;

    rows.push({
      irisCode,
      loyerM2: loyer,
      nbObs,
      q1M2: parseFr(cols[colMap.q1]),
      q3M2: parseFr(cols[colMap.q3]),
    });
  }

  console.log(`  → ${lineCount} lignes lues | ${rows.length} IRIS avec loyer+nb_obs valides`);
  return rows;
}

function aggregateToArrondissements(irisData: IrisData[], zonage: ZonageRow[]): ArrResult[] {
  const irisMap = new Map(irisData.map(r => [r.irisCode, r]));
  const acc = new Map<string, ArrAccumulator>();

  for (const { irisCode, arrCode } of zonage) {
    const iris = irisMap.get(irisCode);
    if (!iris) continue;

    const cur = acc.get(arrCode) ?? { sumLoyer: 0, sumQ1: 0, sumQ3: 0, totalObs: 0, hasQ1: true, hasQ3: true };

    cur.sumLoyer += iris.loyerM2 * iris.nbObs;
    cur.totalObs += iris.nbObs;

    if (cur.hasQ1 && iris.q1M2 !== null) {
      cur.sumQ1 += iris.q1M2 * iris.nbObs;
    } else {
      cur.hasQ1 = false;
    }
    if (cur.hasQ3 && iris.q3M2 !== null) {
      cur.sumQ3 += iris.q3M2 * iris.nbObs;
    } else {
      cur.hasQ3 = false;
    }

    acc.set(arrCode, cur);
  }

  const results: ArrResult[] = [];
  for (const arrCode of ARR_CODES) {
    const a = acc.get(arrCode);
    if (!a || a.totalObs === 0) {
      console.warn(`  ⚠ Arrondissement ${arrCode} : aucun IRIS matchant`);
      continue;
    }
    results.push({
      arrCode,
      loyerM2: a.sumLoyer / a.totalObs,
      nbObs:   a.totalObs,
      q1M2:    a.hasQ1 ? a.sumQ1 / a.totalObs : null,
      q3M2:    a.hasQ3 ? a.sumQ3 / a.totalObs : null,
    });
  }
  return results;
}

function aggregateTo13055(arrResults: ArrResult[]): { loyerM2: number; q1M2: number | null; q3M2: number | null; nbObs: number } {
  const totalObs  = arrResults.reduce((s, r) => s + r.nbObs, 0);
  const loyerAgg  = arrResults.reduce((s, r) => s + r.loyerM2 * r.nbObs, 0) / totalObs;
  const allHaveQ1 = arrResults.every(r => r.q1M2 !== null);
  const allHaveQ3 = arrResults.every(r => r.q3M2 !== null);
  return {
    loyerM2: loyerAgg,
    nbObs:   totalObs,
    q1M2:    allHaveQ1 ? arrResults.reduce((s, r) => s + (r.q1M2 as number) * r.nbObs, 0) / totalObs : null,
    q3M2:    allHaveQ3 ? arrResults.reduce((s, r) => s + (r.q3M2 as number) * r.nbObs, 0) / totalObs : null,
  };
}

async function upsert(agg: { loyerM2: number; q1M2: number | null; q3M2: number | null; nbObs: number }): Promise<number> {
  // IDEMPOTENCE : ON CONFLICT (commune_id) est la contrainte unique du schéma.
  // Re-run après échec partiel = safe, aucun doublon possible.
  // WHERE EXISTS garantit l'intégrité FK (communes.code_insee doit exister).
  const loyer = Math.round(agg.loyerM2 * 100) / 100;
  const q1    = agg.q1M2 !== null ? Math.round(agg.q1M2 * 100) / 100 : null;
  const q3    = agg.q3M2 !== null ? Math.round(agg.q3M2 * 100) / 100 : null;
  const nbObs = agg.nbObs;

  const result = await prisma.$executeRaw`
    INSERT INTO immo_score.loyer_communes
      (id, commune_id, loyer_m2, niveau, source, millesime, nb_obs_src, q1_m2, q3_m2, annee, updated_at)
    SELECT
      gen_random_uuid()::text,
      ${COMMUNE_ID}::text,
      ${loyer}::float8,
      ${NIVEAU}::text,
      ${SOURCE}::text,
      ${MILLESIME}::int,
      ${nbObs}::int,
      ${q1}::numeric(6,2),
      ${q3}::numeric(6,2),
      ${MILLESIME}::int,
      NOW()
    WHERE EXISTS (SELECT 1 FROM immo_score.communes WHERE code_insee = ${COMMUNE_ID})
    ON CONFLICT (commune_id) DO UPDATE SET
      loyer_m2         = EXCLUDED.loyer_m2,
      niveau           = EXCLUDED.niveau,
      source           = EXCLUDED.source,
      millesime        = EXCLUDED.millesime,
      nb_obs_src       = EXCLUDED.nb_obs_src,
      q1_m2            = EXCLUDED.q1_m2,
      q3_m2            = EXCLUDED.q3_m2,
      annee            = EXCLUDED.annee,
      loyer_m2_ic_low  = NULL,
      loyer_m2_ic_high = NULL,
      typpred          = NULL,
      nb_obs           = NULL,
      r2_adj           = NULL,
      updated_at       = NOW()
  `;
  return result;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== OLL AMP/Marseille IRIS → 13055 (N1bis) — ingestion ===');
  console.log(`IRIS CSV  : ${IRIS_CSV_PATH}`);
  console.log(`Zonage    : ${ZONAGE_CSV_PATH}`);

  console.log('\n[1/6] Lecture L1300Zonage2024.csv (IRIS → arrondissements)...');
  const zonageContent = readLocalCsv(ZONAGE_CSV_PATH);
  const zonage = parseZonage(zonageContent);

  if (zonage.length < 50) {
    console.error(`  ✗ Trop peu d'IRIS dans le zonage (${zonage.length} < 50). Vérifier le fichier.`);
    process.exit(1);
  }

  console.log('\n[2/6] Lecture IRIS loyers CSV (UTF-8, pivot wide)...');
  const irisContent = readLocalCsv(IRIS_CSV_PATH);
  const irisData = parseIrisCsv(irisContent);

  if (irisData.length < 100) {
    console.error(`  ✗ Trop peu d'IRIS parsés (${irisData.length} < 100). Vérifier le fichier CSV.`);
    process.exit(1);
  }

  console.log('\n[3/6] Étape 1 — IRIS → arrondissements (pondération nb_obs)...');
  const arrResults = aggregateToArrondissements(irisData, zonage);
  console.log(`  → ${arrResults.length}/16 arrondissements calculés`);

  // Log intermédiaire (NON persisté en BDD — codes 13201-13216 absents de communes)
  const logPayload = arrResults.map(r => ({
    arrCode:  r.arrCode,
    loyerM2:  Math.round(r.loyerM2 * 100) / 100,
    nbObs:    r.nbObs,
    q1M2:     r.q1M2 !== null ? Math.round(r.q1M2 * 100) / 100 : null,
    q3M2:     r.q3M2 !== null ? Math.round(r.q3M2 * 100) / 100 : null,
  }));
  writeFileSync(LOG_PATH, JSON.stringify(logPayload, null, 2));
  console.log(`  → Intermédiaires sauvegardés dans ${LOG_PATH}`);
  arrResults.forEach(r =>
    console.log(`    ${r.arrCode} : ${r.loyerM2.toFixed(2)} €/m² | nb_obs=${r.nbObs}`)
  );

  console.log('\n[4/6] Étape 2 — arrondissements → 13055 (pondération nb_obs)...');
  const agg = aggregateTo13055(arrResults);
  console.log(`  → loyer_13055 = ${agg.loyerM2.toFixed(4)} €/m²`);
  console.log(`  → q1=${agg.q1M2?.toFixed(2) ?? 'N/A'} | q3=${agg.q3M2?.toFixed(2) ?? 'N/A'} | nb_obs_total=${agg.nbObs}`);

  console.log('\n[5/6] Validation witness 13055...');
  if (agg.loyerM2 < WITNESS_MIN || agg.loyerM2 > WITNESS_MAX) {
    console.error(`  ✗ WITNESS FAIL : ${agg.loyerM2.toFixed(4)} ∉ [${WITNESS_MIN}; ${WITNESS_MAX}]`);
    console.error('STOP — vérifier agrégation, zonage ou fichier IRIS.');
    process.exit(1);
  }
  console.log(`  ✓ Witness OK : ${agg.loyerM2.toFixed(4)} ∈ [${WITNESS_MIN}; ${WITNESS_MAX}]`);

  console.log('\n[6/6] Upsert LoyerCommune 13055 (idempotent)...');
  const affected = await upsert(agg);
  if (affected === 0) {
    console.error(`  ✗ 0 lignes affectées — commune ${COMMUNE_ID} absente de immo_score.communes.`);
    process.exit(1);
  }
  console.log(`  ✓ ${affected} ligne upsertée`);

  console.log('\n=== Résultat ===');
  console.log(`  commune_id : ${COMMUNE_ID} | niveau : ${NIVEAU} | source : ${SOURCE} | millesime : ${MILLESIME}`);
  console.log(`  loyer_m2   : ${(Math.round(agg.loyerM2 * 100) / 100).toFixed(2)} | q1 : ${agg.q1M2?.toFixed(2) ?? 'N/A'} | q3 : ${agg.q3M2?.toFixed(2) ?? 'N/A'} | nb_obs_src : ${agg.nbObs}`);
  console.log(`  Durée      : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\nWitness SQL post-ingestion :');
  console.log(`  SELECT commune_id, loyer_m2, nb_obs_src, niveau, source FROM immo_score.loyer_communes WHERE commune_id = '13055' AND niveau = 'N1bis';`);
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
