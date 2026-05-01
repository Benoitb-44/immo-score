/**
 * ingest-loyers.ts
 * Ingestion loyers médians par commune — Carte Loyers ANIL/Cerema 2023.
 *
 * Source  : pred-mai-mef-dhup.csv (ANIL/CEREMA/DHUP)
 * URL     : https://www.data.gouv.fr/api/1/datasets/r/34434cef-2f85-43b9-a601-c625ee426cb7
 * Format  : CSV semicolon, encodage Latin-1/Windows-1252, décimale ","
 * Couverture : ~34 970 communes
 *
 * Pièges :
 *   - Encodage Latin-1 (pas UTF-8) — décodé via Buffer.toString('latin1')
 *   - Décimale "," → parseFloat après replace(',', '.')
 *   - CRLF Windows — readline crlfDelay: Infinity
 *   - TYPPRED "maille" = loyer extrapolé par zone (moins précis que "commune")
 *
 * Usage :
 *   npm run ingest:loyers
 *   npm run ingest:loyers -- --test          (limite à 100 communes)
 *   npm run ingest:loyers -- --dept=33       (département ciblé)
 */

import { PrismaClient } from '@prisma/client';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const prisma = new PrismaClient();

const ANNEE = 2023;
const BATCH_SIZE = 500;
const TEST_MODE = process.argv.includes('--test');
const TEST_LIMIT = 100;
const DEPT_ARG = process.argv.find(a => a.startsWith('--dept='));
const FILTER_DEPT = DEPT_ARG ? DEPT_ARG.replace('--dept=', '').trim() : null;

// URL redirecteur stable data.gouv.fr → pred-mai-mef-dhup.csv
const DATA_URL =
  'https://www.data.gouv.fr/api/1/datasets/r/34434cef-2f85-43b9-a601-c625ee426cb7';

interface LoyerRow {
  commune_id: string;
  loyer_m2: number | null;
  loyer_m2_ic_low: number | null;
  loyer_m2_ic_high: number | null;
  typpred: string | null;
  nb_obs: number | null;
  r2_adj: number | null;
}

function parseFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const val = parseFloat(raw.trim().replace(',', '.'));
  return isNaN(val) ? null : val;
}

function parseIntFr(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const val = parseInt(raw.trim(), 10);
  return isNaN(val) ? null : val;
}

async function fetchCsv(): Promise<string> {
  process.stdout.write('  → Téléchargement Carte Loyers 2023 (data.gouv.fr)... ');
  const res = await fetch(DATA_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`Fichier trop petit (${buf.length} octets)`);
  console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  // Décodage Latin-1 (Windows-1252) — encodage du fichier Cerema
  return buf.toString('latin1');
}

async function parseCsv(content: string): Promise<LoyerRow[]> {
  const stream = Readable.from(content);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineCount = 0;
  let skipped = 0;
  const rows: LoyerRow[] = [];

  let inseeIdx = -1;
  let loyIdx = -1;
  let lwrIdx = -1;
  let uprIdx = -1;
  let typIdx = -1;
  let nbobsIdx = -1;
  let r2Idx = -1;
  let depIdx = -1;

  for await (const line of rl) {
    lineCount++;

    if (lineCount === 1) {
      // En-tête : id_zone;INSEE_C;LIBGEO;EPCI;DEP;REG;loypredm2;lwr.IPm2;upr.IPm2;TYPPRED;nbobs_com;nbobs_mail;R2_adj
      const headers = line.split(';').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      inseeIdx = headers.indexOf('insee_c');
      loyIdx = headers.indexOf('loypredm2');
      lwrIdx = headers.indexOf('lwr.ipm2');
      uprIdx = headers.indexOf('upr.ipm2');
      typIdx = headers.indexOf('typpred');
      nbobsIdx = headers.indexOf('nbobs_com');
      r2Idx = headers.indexOf('r2_adj');
      depIdx = headers.indexOf('dep');
      if (inseeIdx === -1 || loyIdx === -1) {
        throw new Error(`Colonnes INSEE_C/loypredm2 introuvables. Reçu : ${headers.join(', ')}`);
      }
      continue;
    }

    const cols = line.split(';').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= Math.max(inseeIdx, loyIdx)) { skipped++; continue; }

    const inseeC = cols[inseeIdx];
    if (!inseeC || inseeC.length !== 5) { skipped++; continue; }

    if (FILTER_DEPT && depIdx !== -1) {
      const dep = cols[depIdx];
      if (dep !== FILTER_DEPT) continue;
    }

    rows.push({
      commune_id: inseeC,
      loyer_m2: parseFr(cols[loyIdx]),
      loyer_m2_ic_low: lwrIdx !== -1 ? parseFr(cols[lwrIdx]) : null,
      loyer_m2_ic_high: uprIdx !== -1 ? parseFr(cols[uprIdx]) : null,
      typpred: typIdx !== -1 && cols[typIdx] ? cols[typIdx] : null,
      nb_obs: nbobsIdx !== -1 ? parseIntFr(cols[nbobsIdx]) : null,
      r2_adj: r2Idx !== -1 ? parseFr(cols[r2Idx]) : null,
    });

    if (TEST_MODE && rows.length >= TEST_LIMIT) break;
  }

  console.log(
    `  → Lignes lues : ${lineCount} | communes valides : ${rows.length} | skippées : ${skipped}`,
  );
  return rows;
}

async function upsertBatch(rows: LoyerRow[]): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$executeRaw`
        INSERT INTO immo_score.loyer_communes
          (id, commune_id, loyer_m2, loyer_m2_ic_low, loyer_m2_ic_high, typpred, nb_obs, r2_adj, annee, updated_at)
        SELECT
          gen_random_uuid()::text,
          t.commune_id, t.loyer_m2, t.loyer_m2_ic_low, t.loyer_m2_ic_high,
          t.typpred, t.nb_obs, t.r2_adj,
          ${ANNEE}::int, NOW()
        FROM UNNEST(
          ${batch.map(r => r.commune_id)}::text[],
          ${batch.map(r => r.loyer_m2)}::float8[],
          ${batch.map(r => r.loyer_m2_ic_low)}::float8[],
          ${batch.map(r => r.loyer_m2_ic_high)}::float8[],
          ${batch.map(r => r.typpred)}::text[],
          ${batch.map(r => r.nb_obs)}::int[],
          ${batch.map(r => r.r2_adj)}::float8[]
        ) AS t(commune_id, loyer_m2, loyer_m2_ic_low, loyer_m2_ic_high, typpred, nb_obs, r2_adj)
        WHERE EXISTS (
          SELECT 1 FROM immo_score.communes c WHERE c.code_insee = t.commune_id
        )
        ON CONFLICT (commune_id) DO UPDATE SET
          loyer_m2         = EXCLUDED.loyer_m2,
          loyer_m2_ic_low  = EXCLUDED.loyer_m2_ic_low,
          loyer_m2_ic_high = EXCLUDED.loyer_m2_ic_high,
          typpred          = EXCLUDED.typpred,
          nb_obs           = EXCLUDED.nb_obs,
          r2_adj           = EXCLUDED.r2_adj,
          annee            = EXCLUDED.annee,
          updated_at       = NOW()
      `;
      inserted += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}-${i + batch.length} : ${msg}`);
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      process.stdout.write(`  → ${inserted} communes upsertées...\r`);
    }
  }

  return { inserted, errors };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== Carte Loyers ANIL/Cerema 2023 — ingestion ===');
  console.log(`Mode : ${TEST_MODE ? 'TEST' : 'PRODUCTION'}${FILTER_DEPT ? ` | Département ${FILTER_DEPT}` : ''}`);

  console.log('\n[1/3] Téléchargement CSV Carte Loyers...');
  const content = await fetchCsv();

  console.log('\n[2/3] Parsing CSV (encodage Latin-1, décimale ",")...');
  const rows = await parseCsv(content);

  if (rows.length === 0) {
    console.error('  ✗ Aucune commune valide parsée.');
    process.exit(1);
  }

  console.log(`\n[3/3] Upsert de ${rows.length} communes...`);
  const { inserted, errors } = await upsertBatch(rows);

  const totalCommunes = await prisma.commune.count();
  const [covered] = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.loyer_communes
  `;
  const coveredCount = parseInt(covered.cnt);
  const pct = totalCommunes > 0 ? ((coveredCount / totalCommunes) * 100).toFixed(1) : '0';
  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n=== Résultat ===');
  console.log(`  Communes parsées     : ${rows.length}`);
  console.log(`  Communes upsertées   : ${inserted}`);
  console.log(`  Erreurs              : ${errors.length}`);
  console.log(`  Couverture DB        : ${coveredCount} / ${totalCommunes} (${pct}%)`);
  console.log(`  Durée                : ${duration}s`);

  if (errors.length > 0) {
    console.error('\n  Erreurs détail :');
    errors.slice(0, 5).forEach(e => console.error(`  - ${e}`));
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
