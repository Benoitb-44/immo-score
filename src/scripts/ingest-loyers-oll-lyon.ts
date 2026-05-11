/**
 * ingest-loyers-oll-lyon.ts
 * Ingestion OLL Lyon zones C1/C2/C3 (toutes époques) → LoyerCommune N1bis pour 69123.
 *
 * Source  : Base_OP_2024_L6900.zip — https://www.observatoires-des-loyers.org/datagouv/2024/Base_OP_2024_L6900.zip
 *           Attendu sur VPS : /tmp/probe-loyers/Base_OP_2024_L6900.zip
 * Format  : CSV semicolon, encodage Latin-1 (28 colonnes, même format que L7500)
 *
 * Filtre exact par zone (probe step 2 validé) :
 *   Zone_calcul         ∈ { "L6900.1.01" (C1), "L6900.1.02" (C2), "L6900.1.03" (C3) }
 *   Zone_complementaire = ""
 *   Type_habitat        = ""
 *   epoque_construction_local      = ""
 *   epoque_construction_homogene   = ""  ← NE PAS filtrer post-2005, toutes époques
 *   anciennete_locataire_local     = ""
 *   anciennete_locataire_homogene  = ""
 *   nombre_pieces_local            = ""
 *   nombre_pieces_homogene         = ""
 *
 * Zones attendues (probe step 2) :
 *   C1 (L6900.1.01 → 69381-69386) : median=14,4 | Q1=12,4 | Q3=16,3 | obs=3237
 *   C2 (L6900.1.02 → 69387-69388) : median=14,0 | Q1=12,3 | Q3=16,1 | obs=4162
 *   C3 (L6900.1.03 → 69389)       : median=13,6 | Q1=12,0 | Q3=15,9 | obs=4822
 *   Agrégat 69123 : ≈ 13,95 €/m² | nb_obs 12221
 *
 * IDEMPOTENCE : ON CONFLICT (commune_id) DO UPDATE — re-run sans danger.
 *
 * Usage :
 *   npm run ingest:oll-lyon
 *   npm run ingest:oll-lyon -- --zip=/custom/path.zip
 */

import { PrismaClient } from '@prisma/client';
import { extractFromZip } from './zip-extract';

const prisma = new PrismaClient();

const COMMUNE_ID = '69123';
const NIVEAU     = 'N1bis';
const SOURCE     = 'oll_lyon';
const MILLESIME  = 2024;

const DEFAULT_ZIP = '/tmp/probe-loyers/Base_OP_2024_L6900.zip';
const ZIP_ARG  = process.argv.find(a => a.startsWith('--zip='));
const ZIP_PATH = ZIP_ARG ? ZIP_ARG.replace('--zip=', '') : DEFAULT_ZIP;

// ─── Colonnes exactes — format OLL Base_OP 2024 (probe step 2 vérifié) ───────
// Aucun fallback. Si une colonne est absente → throw avec headers reçus.
const COL_ZONE_CALCUL         = 'Zone_calcul';
const COL_ZONE_COMPLEMENTAIRE = 'Zone_complementaire';
const COL_TYPE_HABITAT        = 'Type_habitat';
const COL_EPOQUE_LOCAL        = 'epoque_construction_local';
const COL_EPOQUE_HOMOGENE     = 'epoque_construction_homogene';
const COL_ANCIENNETE_LOCAL    = 'anciennete_locataire_local';
const COL_ANCIENNETE_HOMOGENE = 'anciennete_locataire_homogene';
const COL_PIECES_LOCAL        = 'nombre_pieces_local';
const COL_PIECES_HOMOGENE     = 'nombre_pieces_homogene';
const COL_Q1                  = 'loyer_1_quartile';
const COL_LOYER               = 'loyer_median';
const COL_Q3                  = 'loyer_3_quartile';
const COL_OBS                 = 'nombre_observations';

// Zone_calcul codes → zone C1/C2/C3 (L6900Zonage2024.csv : ZONE=01→C1, 02→C2, 03→C3)
const ZONES = {
  C1: 'L6900.1.01',
  C2: 'L6900.1.02',
  C3: 'L6900.1.03',
} as const;
type ZoneCode = keyof typeof ZONES;

// Witnesses probe step 2
const PROBE_ZONES: Record<ZoneCode, { loyer: number; q1: number; q3: number; obs: number }> = {
  C1: { loyer: 14.4, q1: 12.4, q3: 16.3, obs: 3237 },
  C2: { loyer: 14.0, q1: 12.3, q3: 16.1, obs: 4162 },
  C3: { loyer: 13.6, q1: 12.0, q3: 15.9, obs: 4822 },
};
const PROBE_AGG_LOYER = 13.95;
const PROBE_AGG_TOL   = 0.15;
const ZONE_TOL        = 0.05;

interface ZoneRow {
  zone:    ZoneCode;
  loyerM2: number;
  q1M2:    number;
  q3M2:    number;
  nbObs:   number;
}

interface ColMap {
  zoneCalc:      number;
  zoneCompl:     number;
  typeHabitat:   number;
  epoqueLocal:   number;
  epoqueHom:     number;
  ancienLocal:   number;
  ancienHom:     number;
  piecesLocal:   number;
  piecesHom:     number;
  q1:            number;
  loyer:         number;
  q3:            number;
  obs:           number;
}

function parseFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const v = parseFloat(raw.trim().replace(',', '.'));
  return isNaN(v) ? null : v;
}

function parseIntFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const v = parseInt(raw.trim(), 10);
  return isNaN(v) ? null : v;
}

function findColStrict(headers: string[], colName: string): number {
  const lower = headers.map(h => h.toLowerCase());
  const idx = lower.indexOf(colName.toLowerCase());
  if (idx === -1) {
    throw new Error(
      `Colonne "${colName}" absente du CSV.\nHeaders reçus (${headers.length}) : ${headers.join('; ')}`,
    );
  }
  return idx;
}

function buildColMap(headers: string[]): ColMap {
  return {
    zoneCalc:    findColStrict(headers, COL_ZONE_CALCUL),
    zoneCompl:   findColStrict(headers, COL_ZONE_COMPLEMENTAIRE),
    typeHabitat: findColStrict(headers, COL_TYPE_HABITAT),
    epoqueLocal: findColStrict(headers, COL_EPOQUE_LOCAL),
    epoqueHom:   findColStrict(headers, COL_EPOQUE_HOMOGENE),
    ancienLocal: findColStrict(headers, COL_ANCIENNETE_LOCAL),
    ancienHom:   findColStrict(headers, COL_ANCIENNETE_HOMOGENE),
    piecesLocal: findColStrict(headers, COL_PIECES_LOCAL),
    piecesHom:   findColStrict(headers, COL_PIECES_HOMOGENE),
    q1:          findColStrict(headers, COL_Q1),
    loyer:       findColStrict(headers, COL_LOYER),
    q3:          findColStrict(headers, COL_Q3),
    obs:         findColStrict(headers, COL_OBS),
  };
}

function extractZipCsv(zipPath: string): Buffer {
  return extractFromZip(zipPath, 'Base_OP_2024_L6900.csv');
}

function isAllEmpty(cols: string[], ...indices: number[]): boolean {
  return indices.every(i => (cols[i] ?? '').trim() === '');
}

function parseCsv(buf: Buffer): Map<ZoneCode, ZoneRow> {
  const content = buf.toString('latin1');
  const lines = content.split('\n');

  let colMap: ColMap | null = null;
  let lineCount = 0;
  const found = new Map<ZoneCode, ZoneRow>();
  const zoneByCode = new Map<string, ZoneCode>(
    Object.entries(ZONES).map(([k, v]) => [v, k as ZoneCode]),
  );

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(';').map(c => c.trim());

    if (lineCount === 1) {
      const headers = cols.map(h => h.replace(/^"|"$/g, ''));
      colMap = buildColMap(headers);
      console.log(`  Headers OK (${headers.length} colonnes)`);
      console.log(`  Indices : loyer[${colMap.loyer}] q1[${colMap.q1}] q3[${colMap.q3}] obs[${colMap.obs}]`);
      continue;
    }

    if (!colMap) continue;
    if (cols.length < colMap.obs) continue;

    const zoneCalcVal = (cols[colMap.zoneCalc] ?? '').trim();
    const zone = zoneByCode.get(zoneCalcVal);
    if (!zone) continue; // pas une des 3 zones ciblées

    if (found.has(zone)) continue; // ne garder que la première occurrence (aggregate)

    // Filtre strict : toutes les autres colonnes de sous-population vides
    if (!isAllEmpty(cols,
      colMap.zoneCompl, colMap.typeHabitat,
      colMap.epoqueLocal, colMap.epoqueHom,
      colMap.ancienLocal, colMap.ancienHom,
      colMap.piecesLocal, colMap.piecesHom,
    )) continue;

    const loyer = parseFr(cols[colMap.loyer]);
    const q1    = parseFr(cols[colMap.q1]);
    const q3    = parseFr(cols[colMap.q3]);
    const obs   = parseIntFr(cols[colMap.obs]);

    if (loyer === null || q1 === null || q3 === null || obs === null || obs <= 0) continue;

    found.set(zone, { zone, loyerM2: loyer, q1M2: q1, q3M2: q3, nbObs: obs });
  }

  console.log(`  → ${lineCount} lignes lues | zones extraites : ${[...found.keys()].join(', ')}`);
  return found;
}

interface AggResult {
  loyerM2:    number;
  q1M2:       number;
  q3M2:       number;
  nbObsTotal: number;
}

function weightedAggregate(zones: ZoneRow[]): AggResult {
  const total = zones.reduce((s, r) => s + r.nbObs, 0);
  return {
    loyerM2:    zones.reduce((s, r) => s + r.loyerM2 * r.nbObs, 0) / total,
    q1M2:       zones.reduce((s, r) => s + r.q1M2    * r.nbObs, 0) / total,
    q3M2:       zones.reduce((s, r) => s + r.q3M2    * r.nbObs, 0) / total,
    nbObsTotal: total,
  };
}

async function upsert(agg: AggResult): Promise<number> {
  const loyer = Math.round(agg.loyerM2 * 100) / 100;
  const q1    = Math.round(agg.q1M2    * 100) / 100;
  const q3    = Math.round(agg.q3M2    * 100) / 100;
  const nbObs = agg.nbObsTotal;

  // IDEMPOTENCE : ON CONFLICT (commune_id) est la contrainte unique du schéma.
  // Re-run après échec partiel = safe, aucun doublon possible.
  // WHERE EXISTS garantit l'intégrité FK (communes.code_insee doit exister).
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
  console.log('=== OLL Lyon → 69123 (N1bis) — ingestion ===');
  console.log(`ZIP : ${ZIP_PATH}`);

  console.log('\n[1/5] Extraction ZIP (Base_OP_2024_L6900.csv)...');
  const buf = extractZipCsv(ZIP_PATH);
  console.log(`  → ${(buf.length / 1024).toFixed(0)} KB extraits`);

  console.log('\n[2/5] Parsing CSV (Latin-1 ; colonnes exactes OLL 2024)...');
  const zoneMap = parseCsv(buf);

  const missingZones = (Object.keys(ZONES) as ZoneCode[]).filter(z => !zoneMap.has(z));
  if (missingZones.length > 0) {
    console.error(`  ✗ Zones manquantes : ${missingZones.join(', ')}`);
    process.exit(1);
  }

  console.log('\n[3/5] Validation witnesses zones (probe step 2)...');
  let witnessFail = false;
  for (const zone of Object.keys(ZONES) as ZoneCode[]) {
    const r     = zoneMap.get(zone)!;
    const probe = PROBE_ZONES[zone];
    const dL = Math.abs(r.loyerM2 - probe.loyer);
    const ok = dL <= ZONE_TOL;
    const icon = ok ? '✓' : '✗';
    console.log(`  ${icon} ${zone} (${ZONES[zone]}) : median=${r.loyerM2} (probe=${probe.loyer}, Δ=${dL.toFixed(3)}) q1=${r.q1M2} q3=${r.q3M2} obs=${r.nbObs}`);
    if (!ok) witnessFail = true;
  }
  if (witnessFail) {
    console.error('\nSTOP — witnesses zones hors tolérance. Vérifier filtre époque ou source ZIP.');
    process.exit(1);
  }

  console.log('\n[4/5] Agrégation pondérée nb_obs C1+C2+C3 → 69123...');
  const zoneRows = (Object.keys(ZONES) as ZoneCode[]).map(z => zoneMap.get(z)!);
  const agg = weightedAggregate(zoneRows);
  const formula = zoneRows.map(r => `${r.loyerM2}×${r.nbObs}`).join(' + ');
  console.log(`  (${formula}) / ${agg.nbObsTotal} = ${agg.loyerM2.toFixed(4)}`);
  console.log(`  → loyer_69123 = ${agg.loyerM2.toFixed(4)} | q1=${agg.q1M2.toFixed(2)} | q3=${agg.q3M2.toFixed(2)} | nb_obs=${agg.nbObsTotal}`);

  const dAgg = Math.abs(agg.loyerM2 - PROBE_AGG_LOYER);
  if (dAgg > PROBE_AGG_TOL) {
    console.error(`  ✗ Agrégat hors tolérance : ${agg.loyerM2.toFixed(4)} ≠ probe≈${PROBE_AGG_LOYER} (Δ=${dAgg.toFixed(4)} > ${PROBE_AGG_TOL})`);
    process.exit(1);
  }
  console.log(`  ✓ Agrégat OK : ${agg.loyerM2.toFixed(4)} (probe≈${PROBE_AGG_LOYER})`);

  console.log('\n[5/5] Upsert LoyerCommune 69123 (idempotent)...');
  const affected = await upsert(agg);
  if (affected === 0) {
    console.error(`  ✗ 0 lignes affectées — commune ${COMMUNE_ID} absente de immo_score.communes.`);
    process.exit(1);
  }
  console.log(`  ✓ ${affected} ligne upsertée`);

  const loyerFinal = Math.round(agg.loyerM2 * 100) / 100;
  console.log('\n=== Résultat ===');
  console.log(`  commune_id : ${COMMUNE_ID} | niveau : ${NIVEAU} | source : ${SOURCE} | millesime : ${MILLESIME}`);
  console.log(`  loyer_m2   : ${loyerFinal} | q1_m2 : ${Math.round(agg.q1M2 * 100) / 100} | q3_m2 : ${Math.round(agg.q3M2 * 100) / 100} | nb_obs_src : ${agg.nbObsTotal}`);
  console.log(`  Durée      : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
