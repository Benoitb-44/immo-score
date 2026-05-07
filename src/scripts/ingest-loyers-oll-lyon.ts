/**
 * ingest-loyers-oll-lyon.ts
 * Ingestion OLL Lyon zones C1/C2/C3 (toutes époques) → LoyerCommune N1bis pour 69123.
 *
 * Source  : Base_OP_2024_L6900.zip (OLL Lyon — data.gouv.fr)
 *           Attendu sur VPS : /tmp/probe-loyers/Base_OP_2024_L6900.zip
 * Format  : CSV semicolon, encodage Latin-1
 * Filtre  : epoque_construction_homogene = '' (toutes époques) — NE PAS filtrer post-2005
 *
 * Zones (probe step 2) :
 *   C1 (69381-69386) : 14,4 €/m² | nb_obs 3237
 *   C2 (69387-69388) : 14,0 €/m² | nb_obs 4162
 *   C3 (69389)       : 13,6 €/m² | nb_obs 4822
 *   Agrégat 69123    : ≈ 13,95 €/m² | nb_obs 12221
 *
 * Usage :
 *   npm run ingest:oll-lyon
 *   npm run ingest:oll-lyon -- --zip=/custom/path.zip
 */

import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const prisma = new PrismaClient();

const COMMUNE_ID = '69123';
const NIVEAU     = 'N1bis';
const SOURCE     = 'oll_lyon';
const MILLESIME  = 2024;

const DEFAULT_ZIP = '/tmp/probe-loyers/Base_OP_2024_L6900.zip';
const ZIP_ARG  = process.argv.find(a => a.startsWith('--zip='));
const ZIP_PATH = ZIP_ARG ? ZIP_ARG.replace('--zip=', '') : DEFAULT_ZIP;

const ZONES = ['C1', 'C2', 'C3'] as const;
type ZoneCode = (typeof ZONES)[number];

// Witnesses probe step 2
const PROBE_ZONES: Record<ZoneCode, { loyer: number; nb_obs: number }> = {
  C1: { loyer: 14.4, nb_obs: 3237 },
  C2: { loyer: 14.0, nb_obs: 4162 },
  C3: { loyer: 13.6, nb_obs: 4822 },
};
const PROBE_AGG_LOYER = 13.95;
const PROBE_AGG_TOL   = 0.15;
const ZONE_TOL        = 0.05;

interface ZoneRow {
  zone:    ZoneCode;
  loyerM2: number;
  q1M2:    number | null;
  q3M2:    number | null;
  nbObs:   number;
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

async function parseCsv(buf: Buffer): Promise<ZoneRow[]> {
  const content = buf.toString('latin1');
  const rl = createInterface({ input: Readable.from(content), crlfDelay: Infinity });

  const zoneRows: ZoneRow[] = [];
  let lineCount = 0;
  let zoneIdx = -1, epoqueIdx = -1, loyerIdx = -1, q1Idx = -1, q3Idx = -1, nbObsIdx = -1;

  for await (const line of rl) {
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(';').map(c => c.trim().replace(/^"|"$/g, ''));

    if (lineCount === 1) {
      zoneIdx   = findCol(cols, 'zone', 'secteur', 'libgeo', 'agglo', 'lib_zone', 'code_zone', 'libelle');
      epoqueIdx = findCol(cols, 'epoque_construction_homogene', 'epoque_construction', 'epoque');
      loyerIdx  = findCol(cols, 'loypredm2', 'loyer_m2', 'loyer_median_m2', 'loyer_median', 'loyer');
      q1Idx     = findCol(cols, 'lwr.IPm2',  'q1_m2', 'q1', 'quartile1', 'premier_quartile');
      q3Idx     = findCol(cols, 'upr.IPm2',  'q3_m2', 'q3', 'quartile3', 'troisieme_quartile');
      nbObsIdx  = findCol(cols, 'nbobs_com', 'nb_obs', 'n_obs', 'effectif', 'nb_observations');

      console.log(`  Indices : zone[${zoneIdx}] epoque[${epoqueIdx}] loyer[${loyerIdx}] q1[${q1Idx}] q3[${q3Idx}] nbObs[${nbObsIdx}]`);
      console.log(`  Colonnes CSV (${cols.length}) : ${cols.join(' | ')}`);

      if (loyerIdx === -1 || zoneIdx === -1) {
        throw new Error(`Colonnes loyer/zone introuvables. Headers : ${cols.join(', ')}`);
      }
      continue;
    }

    if (cols.length <= Math.max(loyerIdx, zoneIdx)) continue;

    // Filtre époque vide = toutes époques
    const epoque = epoqueIdx !== -1 ? (cols[epoqueIdx] ?? '').trim() : '';
    if (epoque !== '') continue;

    // Identifier la zone C1/C2/C3 dans la colonne zone
    const rawZone = (cols[zoneIdx] ?? '').trim().toUpperCase();
    const zone = ZONES.find(z => rawZone === z || rawZone.endsWith(z) || rawZone.startsWith(z));
    if (!zone) continue;

    const loyer = parseFr(cols[loyerIdx]);
    const nbObs = nbObsIdx !== -1 ? parseIntFr(cols[nbObsIdx]) : null;
    if (loyer === null || nbObs === null || nbObs <= 0) continue;

    // Si la même zone apparaît plusieurs fois (lignes dupliquées), garder la première
    if (zoneRows.some(r => r.zone === zone)) continue;

    zoneRows.push({
      zone,
      loyerM2: loyer,
      q1M2:    q1Idx !== -1 ? parseFr(cols[q1Idx]) : null,
      q3M2:    q3Idx !== -1 ? parseFr(cols[q3Idx]) : null,
      nbObs,
    });
  }

  console.log(`  → ${lineCount} lignes lues | zones extraites : ${zoneRows.map(r => r.zone).join(', ')}`);
  return zoneRows;
}

interface AggResult {
  loyerM2:   number;
  q1M2:      number | null;
  q3M2:      number | null;
  nbObsTotal: number;
}

function weightedAggregate(zones: ZoneRow[]): AggResult {
  const totalObs = zones.reduce((s, r) => s + r.nbObs, 0);
  const loyerAgg = zones.reduce((s, r) => s + r.loyerM2 * r.nbObs, 0) / totalObs;
  const allHaveQ1 = zones.every(r => r.q1M2 !== null);
  const allHaveQ3 = zones.every(r => r.q3M2 !== null);
  return {
    loyerM2:    loyerAgg,
    nbObsTotal: totalObs,
    q1M2: allHaveQ1 ? zones.reduce((s, r) => s + (r.q1M2 as number) * r.nbObs, 0) / totalObs : null,
    q3M2: allHaveQ3 ? zones.reduce((s, r) => s + (r.q3M2 as number) * r.nbObs, 0) / totalObs : null,
  };
}

async function upsert(agg: AggResult): Promise<void> {
  const loyer = Math.round(agg.loyerM2 * 100) / 100;
  const q1    = agg.q1M2 !== null ? Math.round(agg.q1M2 * 100) / 100 : null;
  const q3    = agg.q3M2 !== null ? Math.round(agg.q3M2 * 100) / 100 : null;
  const nbObs = agg.nbObsTotal;

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
  console.log('=== OLL Lyon → 69123 (N1bis) — ingestion ===');
  console.log(`ZIP : ${ZIP_PATH}`);

  console.log('\n[1/5] Extraction ZIP...');
  const buf = extractZipCsv(ZIP_PATH);
  console.log(`  → ${(buf.length / 1024).toFixed(0)} KB extraits`);

  console.log('\n[2/5] Parsing CSV (Latin-1, semicolon, filtre époque vide)...');
  const zoneRows = await parseCsv(buf);

  if (zoneRows.length === 0) {
    console.error('  ✗ Aucune zone C1/C2/C3 extraite.');
    process.exit(1);
  }

  console.log('\n[3/5] Validation witnesses zones (probe step 2)...');
  let witnessFail = false;
  for (const zone of ZONES) {
    const r     = zoneRows.find(z => z.zone === zone);
    const probe = PROBE_ZONES[zone];
    if (!r) {
      console.error(`  ✗ Zone ${zone} MANQUANTE dans le CSV`);
      witnessFail = true;
      continue;
    }
    const delta = Math.abs(r.loyerM2 - probe.loyer);
    const ok    = delta <= ZONE_TOL;
    const icon  = ok ? '✓' : '✗';
    console.log(`  ${icon} ${zone} : loyer=${r.loyerM2} (probe=${probe.loyer}, Δ=${delta.toFixed(3)}) | nb_obs=${r.nbObs} (probe=${probe.nb_obs})`);
    if (!ok) witnessFail = true;
  }
  if (witnessFail) {
    console.error('\nSTOP — witnesses zones hors tolérance. Vérifier filtre époque ou source ZIP.');
    process.exit(1);
  }

  console.log('\n[4/5] Agrégation pondérée nb_obs C1+C2+C3 → 69123...');
  const agg = weightedAggregate(zoneRows);

  const zoneStr = zoneRows.map(r => `${r.zone}=${r.loyerM2}×${r.nbObs}`).join(' + ');
  console.log(`  ${zoneStr} / ${agg.nbObsTotal}`);
  console.log(`  → loyer_69123 = ${agg.loyerM2.toFixed(4)} | q1=${agg.q1M2?.toFixed(2) ?? 'N/A'} | q3=${agg.q3M2?.toFixed(2) ?? 'N/A'} | nb_obs=${agg.nbObsTotal}`);

  const delta = Math.abs(agg.loyerM2 - PROBE_AGG_LOYER);
  if (delta > PROBE_AGG_TOL) {
    console.error(`  ✗ Agrégat hors tolérance : ${agg.loyerM2.toFixed(4)} ≠ probe≈${PROBE_AGG_LOYER} (Δ=${delta.toFixed(4)} > ${PROBE_AGG_TOL})`);
    process.exit(1);
  }
  console.log(`  ✓ Agrégat OK : ${agg.loyerM2.toFixed(4)} (probe≈${PROBE_AGG_LOYER})`);

  console.log('\n[5/5] Upsert LoyerCommune 69123...');
  await upsert(agg);

  console.log('\n=== Résultat ===');
  console.log(`  commune_id : ${COMMUNE_ID} | niveau : ${NIVEAU} | source : ${SOURCE} | millesime : ${MILLESIME}`);
  console.log(`  loyer_m2   : ${(Math.round(agg.loyerM2 * 100) / 100).toFixed(2)} | q1 : ${agg.q1M2?.toFixed(2) ?? 'N/A'} | q3 : ${agg.q3M2?.toFixed(2) ?? 'N/A'} | nb_obs_src : ${agg.nbObsTotal}`);
  console.log(`  Durée      : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\nWitness SQL post-ingestion :');
  console.log(`  SELECT commune_id, loyer_m2, nb_obs_src, niveau, source FROM immo_score.loyer_communes WHERE commune_id = '69123' AND niveau = 'N1bis';`);
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
