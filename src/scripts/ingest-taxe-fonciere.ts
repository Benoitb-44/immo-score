/**
 * ingest-taxe-fonciere.ts
 * Ingestion Taxe Foncière Bâtie par commune — OFGL REI 2024 (commune + EPCI/GFP).
 *
 * Source  : data.ofgl.fr — Licence Ouverte Etalab v2.0
 *           https://data.ofgl.fr/explore/dataset/rei/
 * Format  : CSV semicolon UTF-8+BOM, format long (une ligne par variable par commune)
 * Couverture : ~34 943 communes France métropolitaine + DROM
 *
 * Variables ingérées (var codes) :
 *   E11      = base nette TFB commune (€)
 *   E13      = montant réel TFB commune (€/an)
 *   E12VOTE  = taux voté communal (%)
 *   E32VOTE  = taux voté GFP/EPCI (%, absent si EPCI sans TFB propre)
 *   E33      = montant réel TFB GFP/EPCI (€/an, absent si EPCI sans TFB)
 *
 * Probe de référence : scripts/probes/ofgl-rei-tfb-sample.csv
 * Mapping colonnes   : annee;idcom;libcom;varlib;var;valeur;secret_statistique;destinataire
 *
 * Usage :
 *   npm run ingest:taxe-fonciere
 *   npm run ingest:taxe-fonciere -- --test          (limite à 200 communes)
 *   npm run ingest:taxe-fonciere -- --dept=33       (département ciblé)
 */

import { PrismaClient } from '@prisma/client';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const prisma = new PrismaClient();

const MILLESIME = 2024;
const BATCH_SIZE = 500;
const TEST_MODE = process.argv.includes('--test');
const TEST_LIMIT = 200;
const DEPT_ARG = process.argv.find(a => a.startsWith('--dept='));
const FILTER_DEPT = DEPT_ARG ? DEPT_ARG.replace('--dept=', '').trim() : null;

// Var codes à ingérer (commune + GFP)
const VAR_CODES = ['E11', 'E13', 'E12VOTE', 'E32VOTE', 'E33'] as const;
type VarCode = (typeof VAR_CODES)[number];

// URL : dispositif_fiscal=FB, millésime 2024, 5 var codes
// UTF-8+BOM, séparateur ;, select minimal
const CSV_URL =
  'https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/rei/exports/csv' +
  '?where=dispositif_fiscal%3D%22FB%22+AND+annee%3D%222024%22' +
  '+AND+var+IN+(%22E11%22%2C%22E13%22%2C%22E12VOTE%22%2C%22E32VOTE%22%2C%22E33%22)' +
  '&select=idcom%2Cvar%2Cvaleur%2Csecret_statistique' +
  '&timezone=UTC' +
  '&delimiter=%3B';

interface CommuneAccum {
  E11?: number;   // base_nette commune
  E13?: number;   // montant_communal
  E12VOTE?: number; // taux_communal_pct
  E32VOTE?: number; // taux_epci_pct
  E33?: number;   // montant_epci
  secret?: boolean;
  sec_stat_reason?: string;
}

interface TfRow {
  code_commune: string;
  montant_tfb_communal: number | null;
  montant_tfb_epci: number | null;
  montant_tfb_total: number | null;
  base_nette: number | null;
  taux_communal_pct: number | null;
  taux_epci_pct: number | null;
  secret_statistique: boolean;
  sec_stat_reason: string | null;
}

async function fetchCsv(): Promise<Readable> {
  process.stdout.write('  → Téléchargement OFGL REI 2024... ');
  const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('Réponse sans body');
  console.log('OK');
  return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
}

async function parseCsv(stream: Readable): Promise<TfRow[]> {
  // Strip UTF-8 BOM from first chunk via readline (crlfDelay handles CRLF)
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const accumulator = new Map<string, CommuneAccum>();
  let lineCount = 0;
  let skipped = 0;
  let secrets = 0;

  let idcomIdx = -1;
  let varIdx = -1;
  let valeurIdx = -1;
  let secretIdx = -1;

  for await (const rawLine of rl) {
    lineCount++;

    // Strip BOM from first line header
    const line = lineCount === 1 ? rawLine.replace(/^﻿/, '') : rawLine;

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

    const varCode = cols[varIdx] as VarCode;
    if (!(VAR_CODES as readonly string[]).includes(varCode)) continue;

    const isSecret = secretIdx !== -1 && (cols[secretIdx] === 'sec_stat' || cols[secretIdx] === '1');

    const entry = accumulator.get(idcom) ?? {};

    if (isSecret) {
      secrets++;
      entry.secret = true;
      entry.sec_stat_reason = 'Données masquées par secret statistique DGFiP';
      accumulator.set(idcom, entry);
      continue;
    }

    const raw = cols[valeurIdx];
    if (!raw || raw === '' || raw === 'null') continue;
    const valeur = parseFloat(raw.replace(',', '.'));
    if (isNaN(valeur)) continue;

    entry[varCode] = valeur;
    accumulator.set(idcom, entry);

    if (TEST_MODE && accumulator.size >= TEST_LIMIT) break;
  }

  console.log(
    `  → Lignes lues : ${lineCount} | communes accumulées : ${accumulator.size}` +
    ` | skippées : ${skipped} | lignes secret_stat : ${secrets}`,
  );

  // Pivot vers TfRow
  const rows: TfRow[] = [];
  let secretCommunes = 0;

  for (const [idcom, d] of accumulator) {
    const isSecret = d.secret === true;
    if (isSecret) secretCommunes++;

    const communal = d.E13 ?? null;
    const epci = d.E33 ?? null;
    const total =
      communal !== null && epci !== null ? communal + epci
        : communal !== null ? communal
          : epci !== null ? epci
            : null;

    rows.push({
      code_commune: idcom,
      montant_tfb_communal: isSecret ? null : communal,
      montant_tfb_epci: isSecret ? null : epci,
      montant_tfb_total: isSecret ? null : total,
      base_nette: isSecret ? null : (d.E11 ?? null),
      taux_communal_pct: d.E12VOTE ?? null,
      taux_epci_pct: d.E32VOTE ?? null,
      secret_statistique: isSecret,
      sec_stat_reason: d.sec_stat_reason ?? null,
    });
  }

  // Distribution montants (non-secrets)
  const montants = rows
    .filter(r => r.montant_tfb_communal !== null)
    .map(r => r.montant_tfb_communal as number)
    .sort((a, b) => a - b);

  if (montants.length > 0) {
    const p50 = montants[Math.floor(montants.length * 0.5)];
    const p95 = montants[Math.floor(montants.length * 0.95)];
    console.log(
      `  → Montant TFB commune : médiane ${(p50 / 1000).toFixed(0)}k€ | p95 ${(p95 / 1000).toFixed(0)}k€` +
      ` | ${secretCommunes} communes secret_stat (${((secretCommunes / rows.length) * 100).toFixed(2)}%)`,
    );
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
        INSERT INTO immo_score.taxe_fonciere_communes
          (id, code_commune,
           montant_tfb_communal, montant_tfb_epci, montant_tfb_total,
           base_nette, taux_communal_pct, taux_epci_pct,
           millesime, source, secret_statistique, sec_stat_reason,
           created_at, updated_at)
        SELECT
          gen_random_uuid()::text,
          t.code_commune,
          t.montant_tfb_communal, t.montant_tfb_epci, t.montant_tfb_total,
          t.base_nette, t.taux_communal_pct, t.taux_epci_pct,
          ${MILLESIME}::int, 'ofgl-rei',
          t.secret_statistique, t.sec_stat_reason,
          NOW(), NOW()
        FROM UNNEST(
          ${batch.map(r => r.code_commune)}::text[],
          ${batch.map(r => r.montant_tfb_communal)}::float8[],
          ${batch.map(r => r.montant_tfb_epci)}::float8[],
          ${batch.map(r => r.montant_tfb_total)}::float8[],
          ${batch.map(r => r.base_nette)}::float8[],
          ${batch.map(r => r.taux_communal_pct)}::float8[],
          ${batch.map(r => r.taux_epci_pct)}::float8[],
          ${batch.map(r => r.secret_statistique)}::bool[],
          ${batch.map(r => r.sec_stat_reason)}::text[]
        ) AS t(
          code_commune,
          montant_tfb_communal, montant_tfb_epci, montant_tfb_total,
          base_nette, taux_communal_pct, taux_epci_pct,
          secret_statistique, sec_stat_reason
        )
        WHERE EXISTS (
          SELECT 1 FROM immo_score.communes c WHERE c.code_insee = t.code_commune
        )
        ON CONFLICT (code_commune) DO UPDATE SET
          montant_tfb_communal = EXCLUDED.montant_tfb_communal,
          montant_tfb_epci     = EXCLUDED.montant_tfb_epci,
          montant_tfb_total    = EXCLUDED.montant_tfb_total,
          base_nette           = EXCLUDED.base_nette,
          taux_communal_pct    = EXCLUDED.taux_communal_pct,
          taux_epci_pct        = EXCLUDED.taux_epci_pct,
          millesime            = EXCLUDED.millesime,
          source               = EXCLUDED.source,
          secret_statistique   = EXCLUDED.secret_statistique,
          sec_stat_reason      = EXCLUDED.sec_stat_reason,
          updated_at           = NOW()
      `;
      inserted += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}–${i + batch.length} : ${msg}`);
    }

    if ((i / BATCH_SIZE) % 10 === 0 && i > 0) {
      process.stdout.write(`  → ${inserted} communes upsertées...\r`);
    }
  }

  return { inserted, errors };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== OFGL REI 2024 — Taxe Foncière Bâtie (commune + EPCI) ===');
  console.log(
    `Mode : ${TEST_MODE ? 'TEST' : 'PRODUCTION'}` +
    `${FILTER_DEPT ? ` | Département ${FILTER_DEPT}` : ''}`,
  );

  console.log('\n[1/3] Téléchargement CSV OFGL...');
  const stream = await fetchCsv();

  console.log('\n[2/3] Parsing CSV (pivot long→wide, commune+GFP)...');
  const rows = await parseCsv(stream);

  if (rows.length === 0) {
    console.error('  ✗ Aucune commune valide parsée.');
    process.exit(1);
  }

  console.log(`\n[3/3] Upsert de ${rows.length} communes (batch ${BATCH_SIZE})...`);
  const { inserted, errors } = await upsertBatch(rows);

  const totalCommunes = await prisma.commune.count();
  const [covered] = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.taxe_fonciere_communes
  `;
  const [secretCount] = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.taxe_fonciere_communes
    WHERE secret_statistique = true
  `;
  const coveredCount = parseInt(covered.cnt);
  const secrets = parseInt(secretCount.cnt);
  const pct = totalCommunes > 0 ? ((coveredCount / totalCommunes) * 100).toFixed(1) : '0';
  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n=== Résultat ===');
  console.log(`  Communes parsées     : ${rows.length}`);
  console.log(`  Communes upsertées   : ${inserted}`);
  console.log(`  Erreurs batch        : ${errors.length}`);
  console.log(`  Couverture DB        : ${coveredCount} / ${totalCommunes} (${pct}%)`);
  console.log(`  Secret statistique   : ${secrets} communes (${((secrets / coveredCount) * 100).toFixed(2)}%)`);
  console.log(`  Durée                : ${duration}s`);

  if (errors.length > 0) {
    console.error('\n  Erreurs détail :');
    errors.slice(0, 5).forEach(e => console.error(`  - ${e}`));
  }

  if (coveredCount < 30_000) {
    console.error(`\n  ⚠ Couverture insuffisante : ${coveredCount} communes (attendu ≥ 34 000)`);
    process.exit(1);
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
