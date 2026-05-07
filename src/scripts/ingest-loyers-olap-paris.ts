/**
 * ingest-loyers-olap-paris.ts
 * Ingestion OLL Paris intra-muros (toutes époques) → LoyerCommune N1bis.
 *
 * Source  : Base_OP_2024_L7500.zip (OLL Paris — data.gouv.fr)
 *           Attendu sur VPS : /tmp/probe-loyers/Base_OP_2024_L7500.zip
 * Format  : CSV semicolon, encodage Latin-1
 * Filtre  : agglo = Paris intra-muros + epoque_construction_homogene = '' (toutes époques)
 *
 * Résultat probe step 2 :
 *   loyer = 26,6 €/m² | Q1 = 23,2 | Q3 = 30,3 | nb_obs = 3686
 *
 * Usage :
 *   npm run ingest:oll-paris
 *   npm run ingest:oll-paris -- --zip=/custom/path.zip
 */

import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const prisma = new PrismaClient();

const COMMUNE_ID = '75056';
const NIVEAU     = 'N1bis';
const SOURCE     = 'oll_paris';
const MILLESIME  = 2024;

const DEFAULT_ZIP = '/tmp/probe-loyers/Base_OP_2024_L7500.zip';
const ZIP_ARG  = process.argv.find(a => a.startsWith('--zip='));
const ZIP_PATH = ZIP_ARG ? ZIP_ARG.replace('--zip=', '') : DEFAULT_ZIP;

// Witness probe step 2 — échec = STOP
const PROBE_LOYER  = 26.6;
const PROBE_NB_OBS = 3686;
const PROBE_TOL    = 0.05;

interface OllRow {
  geo:     string;
  epoque:  string;
  loyerM2: number;
  q1M2:    number | null;
  q3M2:    number | null;
  nbObs:   number | null;
}

function parseFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const v = parseFloat(raw.trim().replace(',', '.'));
  return isNaN(v) ? null : v;
}

function parseIntFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const v = parseInt(raw.trim().replace(/\s/g, ''), 10);
  return isNaN(v) ? null : v;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCol(headers: string[], ...variants: string[]): number {
  const normed = headers.map(norm);
  for (const v of variants) {
    const idx = normed.indexOf(norm(v));
    if (idx !== -1) return idx;
  }
  return -1;
}

function extractZipCsv(zipPath: string): Buffer {
  const res = spawnSync('unzip', ['-p', zipPath, '*.csv'], { maxBuffer: 100 * 1024 * 1024 });
  if (res.error) throw new Error(`unzip error: ${res.error.message}`);
  if (res.status !== 0) {
    const stderr = res.stderr ? (res.stderr as Buffer).toString() : '(no stderr)';
    throw new Error(`unzip exit=${res.status}: ${stderr}`);
  }
  if (!res.stdout) throw new Error('unzip: stdout null');
  return res.stdout as Buffer;
}

async function parseCsv(buf: Buffer): Promise<OllRow[]> {
  const content = buf.toString('latin1');
  const rl = createInterface({ input: Readable.from(content), crlfDelay: Infinity });

  const rows: OllRow[] = [];
  let lineCount = 0;
  let geoIdx = -1, epoqueIdx = -1, loyerIdx = -1, q1Idx = -1, q3Idx = -1, nbObsIdx = -1;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(';').map(c => c.trim().replace(/^"|"$/g, ''));

    if (lineCount === 1) {
      geoIdx    = findCol(cols, 'libgeo', 'agglo', 'zone', 'secteur', 'lib_zone', 'libelle', 'territoires');
      epoqueIdx = findCol(cols, 'epoque_construction_homogene', 'epoque_construction', 'epoque');
      loyerIdx  = findCol(cols, 'loypredm2', 'loyer_m2', 'loyer_median_m2', 'loyer_median', 'loyer');
      q1Idx     = findCol(cols, 'lwr.IPm2',  'q1_m2', 'q1', 'quartile1', 'premier_quartile');
      q3Idx     = findCol(cols, 'upr.IPm2',  'q3_m2', 'q3', 'quartile3', 'troisieme_quartile');
      nbObsIdx  = findCol(cols, 'nbobs_com', 'nb_obs', 'n_obs', 'effectif', 'nb_observations');

      console.log(`  Indices : geo[${geoIdx}] epoque[${epoqueIdx}] loyer[${loyerIdx}] q1[${q1Idx}] q3[${q3Idx}] nbObs[${nbObsIdx}]`);
      console.log(`  Colonnes CSV (${cols.length}) : ${cols.join(' | ')}`);

      if (loyerIdx === -1 || geoIdx === -1) {
        throw new Error(`Colonnes loyer/geo introuvables. Headers : ${cols.join(', ')}`);
      }
      continue;
    }

    if (cols.length <= Math.max(loyerIdx, geoIdx)) continue;
    const loyer = parseFr(cols[loyerIdx]);
    if (loyer === null) continue;

    rows.push({
      geo:    cols[geoIdx] ?? '',
      epoque: epoqueIdx !== -1 ? (cols[epoqueIdx] ?? '') : '',
      loyerM2: loyer,
      q1M2:   q1Idx    !== -1 ? parseFr(cols[q1Idx])       : null,
      q3M2:   q3Idx    !== -1 ? parseFr(cols[q3Idx])       : null,
      nbObs:  nbObsIdx !== -1 ? parseIntFr(cols[nbObsIdx]) : null,
    });
  }

  console.log(`  → ${lineCount} lignes lues | ${rows.length} avec loyer valide`);
  return rows;
}

function findParisRow(rows: OllRow[]): OllRow {
  // Priorité 1 : "Paris intra-muros" exact + époque vide
  let match = rows.find(r => norm(r.geo).includes('parisintramuros') && r.epoque.trim() === '');
  if (match) return match;

  // Priorité 2 : contient "paris" + époque vide
  match = rows.find(r => norm(r.geo).includes('paris') && r.epoque.trim() === '');
  if (match) return match;

  const sample = rows.slice(0, 20).map(r => `  geo="${r.geo}" | epoque="${r.epoque}" | loyer=${r.loyerM2}`);
  throw new Error(`Ligne Paris intra-muros introuvable.\nÉchantillon disponible :\n${sample.join('\n')}`);
}

async function upsert(row: OllRow): Promise<void> {
  const loyer = row.loyerM2;
  const q1    = row.q1M2;
  const q3    = row.q3M2;
  const nbObs = row.nbObs;

  await prisma.$executeRaw`
    INSERT INTO immo_score.loyer_communes
      (id, commune_id, loyer_m2, niveau, source, millesime, nb_obs_src, q1_m2, q3_m2, annee, updated_at)
    VALUES (
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
    )
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
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== OLL Paris intra-muros (N1bis) — ingestion ===');
  console.log(`ZIP : ${ZIP_PATH}`);

  console.log('\n[1/4] Extraction ZIP...');
  const buf = extractZipCsv(ZIP_PATH);
  console.log(`  → ${(buf.length / 1024).toFixed(0)} KB extraits`);

  console.log('\n[2/4] Parsing CSV (Latin-1, semicolon)...');
  const rows = await parseCsv(buf);

  console.log('\n[3/4] Sélection Paris intra-muros + toutes époques...');
  const parisRow = findParisRow(rows);
  console.log(`  geo="${parisRow.geo}" | epoque="${parisRow.epoque}"`);
  console.log(`  loyer=${parisRow.loyerM2} | Q1=${parisRow.q1M2} | Q3=${parisRow.q3M2} | nb_obs=${parisRow.nbObs}`);

  // Witness probe step 2
  const delta = Math.abs(parisRow.loyerM2 - PROBE_LOYER);
  if (delta > PROBE_TOL) {
    console.error(`\n✗ WITNESS FAIL : loyer=${parisRow.loyerM2} ≠ probe=${PROBE_LOYER} (Δ=${delta.toFixed(3)} > tol=${PROBE_TOL})`);
    console.error('STOP — vérifier filtre ou source CSV avant upsert.');
    process.exit(1);
  }
  console.log(`  ✓ Witness loyer OK : Δ=${delta.toFixed(3)}`);
  if (parisRow.nbObs !== null && parisRow.nbObs !== PROBE_NB_OBS) {
    console.warn(`  ⚠ nb_obs=${parisRow.nbObs} ≠ probe=${PROBE_NB_OBS} (écart acceptable si millesime différent)`);
  }

  console.log('\n[4/4] Upsert LoyerCommune 75056...');
  await upsert(parisRow);

  console.log('\n=== Résultat ===');
  console.log(`  commune_id : ${COMMUNE_ID} | niveau : ${NIVEAU} | source : ${SOURCE} | millesime : ${MILLESIME}`);
  console.log(`  loyer_m2   : ${parisRow.loyerM2} | q1 : ${parisRow.q1M2} | q3 : ${parisRow.q3M2} | nb_obs_src : ${parisRow.nbObs}`);
  console.log(`  Durée      : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\nWitness SQL post-ingestion :');
  console.log(`  SELECT commune_id, loyer_m2, nb_obs_src, niveau, source FROM immo_score.loyer_communes WHERE commune_id = '75056' AND niveau = 'N1bis';`);
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
