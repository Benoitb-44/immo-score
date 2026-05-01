/**
 * ingest-tf.ts
 * Ingestion Taxe Foncière Bâtie par commune — OFGL REI 2023.
 *
 * Source  : data.ofgl.fr/explore/dataset/rei/
 * Format  : CSV semicolon UTF-8, format long (une ligne par variable par commune)
 * Couverture : ~34 943 communes France métropolitaine
 *
 * Variables ingérées :
 *   E11  = base nette TFB commune (€)
 *   E13  = produit réel TFB commune (€)
 *   E14  = nombre d'articles (locaux imposables)
 *   E12VOTE = taux voté communal (%)
 *
 * Calcul : tf_moy_par_bien = E13 / E14 (si E14 > 0)
 *
 * Usage :
 *   npm run ingest:tf
 *   npm run ingest:tf -- --test          (limite à 100 communes)
 *   npm run ingest:tf -- --dept=33       (département ciblé)
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

const CSV_URL =
  'https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv' +
  '?where=annee%3D%222023%22+AND+var+IN+(%22E11%22%2C%22E13%22%2C%22E14%22%2C%22E12VOTE%22)' +
  '&select=idcom%2Cvar%2Cvaleur%2Csecret_statistique' +
  '&timezone=UTC' +
  '&delimiter=%3B';

interface CommuneData {
  E11?: number;
  E13?: number;
  E14?: number;
  E12VOTE?: number;
}

interface TfRow {
  commune_id: string;
  tf_base: number | null;
  tf_produit: number | null;
  tf_nb_articles: number | null;
  tf_moy_par_bien: number | null;
  tf_taux_vote: number | null;
}

async function fetchCsv(): Promise<Readable> {
  process.stdout.write('  → Téléchargement OFGL REI 2023... ');
  const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('Réponse sans body');
  console.log('OK');
  // Readable.fromWeb compatible Node.js 18+
  return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
}

async function parseCsv(stream: Readable): Promise<TfRow[]> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const accumulator = new Map<string, CommuneData>();

  let lineCount = 0;
  let skipped = 0;
  let secrets = 0;

  let idcomIdx = -1;
  let varIdx = -1;
  let valeurIdx = -1;
  let secretIdx = -1;

  for await (const line of rl) {
    lineCount++;

    if (lineCount === 1) {
      const headers = line.split(';').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      idcomIdx = headers.indexOf('idcom');
      varIdx = headers.indexOf('var');
      valeurIdx = headers.indexOf('valeur');
      secretIdx = headers.indexOf('secret_statistique');
      if (idcomIdx === -1 || varIdx === -1 || valeurIdx === -1) {
        throw new Error(`Colonnes idcom/var/valeur introuvables. Reçu : ${headers.join(', ')}`);
      }
      continue;
    }

    const cols = line.split(';').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= Math.max(idcomIdx, varIdx, valeurIdx)) continue;

    const idcom = cols[idcomIdx];
    if (!idcom || idcom.length !== 5) { skipped++; continue; }
    if (FILTER_DEPT && !idcom.startsWith(FILTER_DEPT)) continue;

    if (secretIdx !== -1 && cols[secretIdx] === 'sec_stat') { secrets++; continue; }

    const varCode = cols[varIdx] as 'E11' | 'E13' | 'E14' | 'E12VOTE';
    if (!['E11', 'E13', 'E14', 'E12VOTE'].includes(varCode)) continue;

    const raw = cols[valeurIdx];
    if (!raw || raw === '' || raw === 'null') continue;
    const valeur = parseFloat(raw.replace(',', '.'));
    if (isNaN(valeur)) continue;

    const entry = accumulator.get(idcom) ?? {};
    entry[varCode] = valeur;
    accumulator.set(idcom, entry);

    if (TEST_MODE && accumulator.size >= TEST_LIMIT) break;
  }

  console.log(
    `  → Lignes lues : ${lineCount} | communes accumulées : ${accumulator.size}` +
    ` | skippées : ${skipped} | secrets : ${secrets}`,
  );

  const rows: TfRow[] = [];
  for (const [idcom, data] of accumulator) {
    const tf_moy =
      data.E13 != null && data.E14 != null && data.E14 > 0 ? data.E13 / data.E14 : null;
    rows.push({
      commune_id: idcom,
      tf_base: data.E11 ?? null,
      tf_produit: data.E13 ?? null,
      tf_nb_articles: data.E14 != null ? Math.round(data.E14) : null,
      tf_moy_par_bien: tf_moy,
      tf_taux_vote: data.E12VOTE ?? null,
    });
  }
  return rows;
}

async function upsertBatch(rows: TfRow[]): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$executeRaw`
        INSERT INTO immo_score.fiscalite_communes
          (id, commune_id, tf_base, tf_produit, tf_nb_articles, tf_moy_par_bien, tf_taux_vote, annee, updated_at)
        SELECT
          gen_random_uuid()::text,
          t.commune_id, t.tf_base, t.tf_produit, t.tf_nb_articles, t.tf_moy_par_bien, t.tf_taux_vote,
          ${ANNEE}::int, NOW()
        FROM UNNEST(
          ${batch.map(r => r.commune_id)}::text[],
          ${batch.map(r => r.tf_base)}::float8[],
          ${batch.map(r => r.tf_produit)}::float8[],
          ${batch.map(r => r.tf_nb_articles)}::int[],
          ${batch.map(r => r.tf_moy_par_bien)}::float8[],
          ${batch.map(r => r.tf_taux_vote)}::float8[]
        ) AS t(commune_id, tf_base, tf_produit, tf_nb_articles, tf_moy_par_bien, tf_taux_vote)
        WHERE EXISTS (
          SELECT 1 FROM immo_score.communes c WHERE c.code_insee = t.commune_id
        )
        ON CONFLICT (commune_id) DO UPDATE SET
          tf_base         = EXCLUDED.tf_base,
          tf_produit      = EXCLUDED.tf_produit,
          tf_nb_articles  = EXCLUDED.tf_nb_articles,
          tf_moy_par_bien = EXCLUDED.tf_moy_par_bien,
          tf_taux_vote    = EXCLUDED.tf_taux_vote,
          annee           = EXCLUDED.annee,
          updated_at      = NOW()
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
  console.log('=== OFGL REI 2023 — Taxe Foncière Bâtie ===');
  console.log(`Mode : ${TEST_MODE ? 'TEST' : 'PRODUCTION'}${FILTER_DEPT ? ` | Département ${FILTER_DEPT}` : ''}`);

  console.log('\n[1/3] Téléchargement CSV OFGL...');
  const stream = await fetchCsv();

  console.log('\n[2/3] Parsing CSV (pivot long→wide)...');
  const rows = await parseCsv(stream);

  if (rows.length === 0) {
    console.error('  ✗ Aucune commune valide parsée.');
    process.exit(1);
  }

  console.log(`\n[3/3] Upsert de ${rows.length} communes...`);
  const { inserted, errors } = await upsertBatch(rows);

  const totalCommunes = await prisma.commune.count();
  const [covered] = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.fiscalite_communes
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
