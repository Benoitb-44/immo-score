/**
 * ingest-loyers-olap-paris.ts
 * Ingestion OLL Paris intra-muros (toutes époques) → LoyerCommune N1bis.
 *
 * Source  : Base_OP_2024_L7500.zip — https://www.observatoires-des-loyers.org/datagouv/2024/Base_OP_2024_L7500.zip
 *           Attendu sur VPS : /tmp/probe-loyers/Base_OP_2024_L7500.zip
 * Format  : CSV semicolon, encodage Latin-1 (28 colonnes, headers en ligne 1)
 *
 * Filtre exact (probe step 2 validé) :
 *   Zone_calcul         = "" (vide)
 *   Zone_complementaire = "L7500.1"   ← Paris intra-muros
 *   Type_habitat        = ""
 *   epoque_construction_local      = ""
 *   epoque_construction_homogene   = ""
 *   anciennete_locataire_local     = ""
 *   anciennete_locataire_homogene  = ""
 *   nombre_pieces_local            = ""
 *   nombre_pieces_homogene         = ""
 *
 * → Ligne unique : loyer_median=26,6 | loyer_1_quartile=23,2 | loyer_3_quartile=30,3 | nombre_observations=3686
 *
 * IDEMPOTENCE : ON CONFLICT (commune_id) DO UPDATE — re-run sans danger.
 *
 * Usage :
 *   npm run ingest:oll-paris
 *   npm run ingest:oll-paris -- --zip=/custom/path.zip
 */

import { PrismaClient } from '@prisma/client';
import { extractFromZip } from './zip-extract';

const prisma = new PrismaClient();

const COMMUNE_ID = '75056';
const NIVEAU     = 'N1bis';
const SOURCE     = 'oll_paris';
const MILLESIME  = 2024;

const DEFAULT_ZIP = '/tmp/probe-loyers/Base_OP_2024_L7500.zip';
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

// Valeur Zone_complementaire identifiant Paris intra-muros dans L7500
const PARIS_INTRAMUROS_ZONE = 'L7500.1';

// Witness probe step 2 — fail = STOP avant upsert
const PROBE_LOYER  = 26.6;
const PROBE_Q1     = 23.2;
const PROBE_Q3     = 30.3;
const PROBE_NB_OBS = 3686;
const PROBE_TOL    = 0.05;

interface OllRow {
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
  return extractFromZip(zipPath, 'Base_OP_2024_L7500.csv');
}

function isAllEmpty(cols: string[], ...indices: number[]): boolean {
  return indices.every(i => (cols[i] ?? '').trim() === '');
}

function parseCsv(buf: Buffer): OllRow {
  const content = buf.toString('latin1');
  const lines = content.split('\n');

  let colMap: ColMap | null = null;
  let lineCount = 0;
  const matches: OllRow[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    lineCount++;
    if (!line.trim()) continue;

    const cols = line.split(';').map(c => c.trim());

    if (lineCount === 1) {
      // Retirer les guillemets éventuels des headers
      const headers = cols.map(h => h.replace(/^"|"$/g, ''));
      colMap = buildColMap(headers);
      console.log(`  Headers OK (${headers.length} colonnes)`);
      console.log(`  Indices : loyer[${colMap.loyer}] q1[${colMap.q1}] q3[${colMap.q3}] obs[${colMap.obs}]`);
      continue;
    }

    if (!colMap) continue;
    if (cols.length < colMap.obs) continue;

    // Filtre exact : Zone_complementaire="L7500.1" + toutes sous-populations vides
    const zoneCompl = (cols[colMap.zoneCompl] ?? '').trim();
    if (zoneCompl !== PARIS_INTRAMUROS_ZONE) continue;

    if (!isAllEmpty(cols,
      colMap.zoneCalc, colMap.typeHabitat,
      colMap.epoqueLocal, colMap.epoqueHom,
      colMap.ancienLocal, colMap.ancienHom,
      colMap.piecesLocal, colMap.piecesHom,
    )) continue;

    const loyer = parseFr(cols[colMap.loyer]);
    const q1    = parseFr(cols[colMap.q1]);
    const q3    = parseFr(cols[colMap.q3]);
    const obs   = parseIntFr(cols[colMap.obs]);

    if (loyer === null || q1 === null || q3 === null || obs === null) continue;

    matches.push({ loyerM2: loyer, q1M2: q1, q3M2: q3, nbObs: obs });
  }

  console.log(`  → ${lineCount} lignes lues | ${matches.length} match(es) Paris intra-muros toutes époques`);

  if (matches.length === 0) {
    throw new Error(
      `Aucune ligne Paris intra-muros (Zone_complementaire="${PARIS_INTRAMUROS_ZONE}", toutes sous-populations vides).\n` +
      `Vérifier le ZIP source ou l'année du fichier.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} lignes trouvées — filtre ambigu.\n` +
      `Résultats : ${matches.map(r => `med=${r.loyerM2}`).join(', ')}`,
    );
  }

  return matches[0];
}

async function upsert(row: OllRow): Promise<number> {
  // IDEMPOTENCE : ON CONFLICT (commune_id) est la contrainte unique du schéma.
  // Re-run après échec partiel = safe, aucun doublon possible.
  // WHERE EXISTS garantit l'intégrité FK (communes.code_insee doit exister).
  const result = await prisma.$executeRaw`
    INSERT INTO immo_score.loyer_communes
      (id, commune_id, loyer_m2, niveau, source, millesime, nb_obs_src, q1_m2, q3_m2, annee, updated_at)
    SELECT
      gen_random_uuid()::text,
      ${COMMUNE_ID}::text,
      ${row.loyerM2}::float8,
      ${NIVEAU}::text,
      ${SOURCE}::text,
      ${MILLESIME}::int,
      ${row.nbObs}::int,
      ${row.q1M2}::numeric(6,2),
      ${row.q3M2}::numeric(6,2),
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
  console.log('=== OLL Paris intra-muros (N1bis) — ingestion ===');
  console.log(`ZIP : ${ZIP_PATH}`);

  console.log('\n[1/4] Extraction ZIP (Base_OP_2024_L7500.csv)...');
  const buf = extractZipCsv(ZIP_PATH);
  console.log(`  → ${(buf.length / 1024).toFixed(0)} KB extraits`);

  console.log('\n[2/4] Parsing CSV (Latin-1 ; colonnes exactes OLL 2024)...');
  const row = parseCsv(buf);
  console.log(`  loyer_median=${row.loyerM2} | Q1=${row.q1M2} | Q3=${row.q3M2} | nb_obs=${row.nbObs}`);

  console.log('\n[3/4] Validation witnesses probe step 2...');
  const checks: string[] = [];
  let fail = false;
  const dLoyer = Math.abs(row.loyerM2 - PROBE_LOYER);
  const dQ1    = Math.abs(row.q1M2 - PROBE_Q1);
  const dQ3    = Math.abs(row.q3M2 - PROBE_Q3);
  if (dLoyer > PROBE_TOL) { checks.push(`loyer=${row.loyerM2}≠${PROBE_LOYER}(Δ=${dLoyer.toFixed(3)})`); fail = true; }
  else checks.push(`loyer=${row.loyerM2} ✓`);
  if (dQ1 > PROBE_TOL)    { checks.push(`q1=${row.q1M2}≠${PROBE_Q1}(Δ=${dQ1.toFixed(3)})`); fail = true; }
  else checks.push(`q1=${row.q1M2} ✓`);
  if (dQ3 > PROBE_TOL)    { checks.push(`q3=${row.q3M2}≠${PROBE_Q3}(Δ=${dQ3.toFixed(3)})`); fail = true; }
  else checks.push(`q3=${row.q3M2} ✓`);
  if (row.nbObs !== PROBE_NB_OBS) checks.push(`nb_obs=${row.nbObs}≠${PROBE_NB_OBS} ⚠`);
  else checks.push(`nb_obs=${row.nbObs} ✓`);
  console.log(`  ${checks.join(' | ')}`);
  if (fail) {
    console.error('\nSTOP — witnesses hors tolérance. Vérifier source ZIP ou filtre.');
    process.exit(1);
  }

  console.log('\n[4/4] Upsert LoyerCommune 75056 (idempotent)...');
  const affected = await upsert(row);
  if (affected === 0) {
    console.error(`  ✗ 0 lignes affectées — commune ${COMMUNE_ID} absente de immo_score.communes.`);
    process.exit(1);
  }
  console.log(`  ✓ ${affected} ligne upsertée`);

  console.log('\n=== Résultat ===');
  console.log(`  commune_id : ${COMMUNE_ID} | niveau : ${NIVEAU} | source : ${SOURCE} | millesime : ${MILLESIME}`);
  console.log(`  loyer_m2   : ${row.loyerM2} | q1_m2 : ${row.q1M2} | q3_m2 : ${row.q3M2} | nb_obs_src : ${row.nbObs}`);
  console.log(`  Durée      : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
