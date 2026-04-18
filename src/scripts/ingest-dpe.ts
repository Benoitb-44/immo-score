/**
 * ingest-dpe.ts
 * Ingestion des DPE (Diagnostics de Performance Énergétique) depuis l'API ADEME
 *
 * Source   : https://data.ademe.fr/datasets/dpe-v2-logements-existants
 * Dataset  : dpe03existant — 14,5M diagnostics depuis juillet 2021
 * API docs : https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant
 *
 * Stratégie :
 *   - Un appel values_agg par commune → distribution A-G des classes DPE
 *   - Stockage : une ligne par (commune, classe_dpe) dans dpe_communes
 *   - Idempotent : deleteMany + createMany par commune
 *   - Rate limiting : 50ms entre requêtes (~20 req/s < 50 req/s limite ADEME)
 *   - Backoff 429 : 2s → 5s → 15s puis abandon (log warning)
 *   - Communes sans données DPE : aucune ligne insérée (NULL → score médiane nationale)
 *   - Mode test : --test traite seulement 5 communes
 *
 * Flags :
 *   --test              5 communes seulement
 *   --limit=N           N premières communes
 *   --depts=33,69,13    Cibler des départements spécifiques (comme ingest-dvf.ts)
 *   --retry-errors      Ne réingérer que les communes sans données DPE en base
 *
 * Env :
 *   ADEME_API_KEY — clé API data.ademe.fr (optionnel, accès public en lecture)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_KEY =
  process.env.ADEME_API_KEY ??
  'dTo5TTdISzJfU050Z0xHZDlkeWZIQk06ams1ZzQtYm1ua2NpMDVwcDR2eDl2djd6';
const DATASET_ID = 'dpe03existant';
const BASE_URL = `https://data.ademe.fr/data-fair/api/v1/datasets/${DATASET_ID}`;
const RATE_LIMIT_MS = 50; // ~20 req/s, conservatif sous la limite 50 req/s ADEME
const BATCH_SIZE = 100;
const TEST_SIZE = 5;

const TEST_MODE = process.argv.includes('--test');
const RETRY_ERRORS = process.argv.includes('--retry-errors');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;
const DEPTS_ARG = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;

const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

// Délais backoff 429 : 1ère erreur 2s, 2ème 5s, 3ème 15s puis abandon
const BACKOFF_DELAYS_MS = [2_000, 5_000, 15_000];

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ──────────────────── Types API ────────────────────

interface AggItem {
  value: string;
  total: number;
}

interface ValuesAggResponse {
  total?: number;
  aggs?: AggItem[];
}

interface IngestResult {
  source: string;
  communes_processed: number;
  communes_with_dpe: number;
  communes_errored: number;
  total_rows_inserted: number;
  duration_ms: number;
  errors: string[];
}

// ──────────────────── Fetch ADEME ────────────────────

/**
 * Récupère la distribution A-G des classes DPE pour une commune.
 * Endpoint : /values_agg?field=etiquette_dpe&agg_size=7&qs=code_insee_ban:{code_insee}
 */
async function fetchDpeDistribution(codeInsee: string): Promise<AggItem[]> {
  const qs = encodeURIComponent(`code_insee_ban:${codeInsee}`);
  const url = `${BASE_URL}/values_agg?field=etiquette_dpe&agg_size=7&qs=${qs}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: 'application/json',
      'x-apikey': API_KEY,
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as ValuesAggResponse;
  return (data?.aggs ?? []).filter(
    a => a.total > 0 && (DPE_CLASSES as readonly string[]).includes(a.value),
  );
}

/**
 * fetchDpeDistribution avec backoff exponentiel sur HTTP 429.
 * Délais : 2s → 5s → 15s, puis abandon avec log warning.
 */
async function fetchDpeWithBackoff(codeInsee: string): Promise<AggItem[]> {
  for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
    try {
      return await fetchDpeDistribution(codeInsee);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('HTTP 429') && attempt < BACKOFF_DELAYS_MS.length) {
        const delay = BACKOFF_DELAYS_MS[attempt];
        process.stdout.write(`\n  WARN: ${codeInsee} — 429, backoff ${delay / 1000}s (tentative ${attempt + 1}/${BACKOFF_DELAYS_MS.length})...`);
        await sleep(delay);
        continue;
      }
      if (msg.includes('HTTP 429')) {
        process.stdout.write(`\n  WARN: ${codeInsee} — 429 persistant après ${BACKOFF_DELAYS_MS.length} tentatives, commune ignorée`);
      }
      throw e;
    }
  }
  throw new Error('unreachable');
}

// ──────────────────── Ingestion principale ────────────────────

async function ingest(): Promise<IngestResult> {
  const start = Date.now();
  const allErrors: string[] = [];
  let communesProcessed = 0;
  let communesWithDpe = 0;
  let totalRowsInserted = 0;

  // Filtre par département si --depts fourni
  const whereClause = FILTER_DEPTS
    ? { departement: { in: FILTER_DEPTS } }
    : {};

  let communes = await prisma.commune.findMany({
    select: { code_insee: true },
    where: whereClause,
    orderBy: { code_insee: 'asc' },
  });

  if (FILTER_DEPTS) {
    console.log(`Mode ciblé : traitement limité aux départements ${FILTER_DEPTS.join(', ')}`);
  }

  // --retry-errors : ne traiter que les communes sans données DPE en base
  if (RETRY_ERRORS) {
    const withDpe = await prisma.dpeCommune.findMany({
      select: { code_commune: true },
      distinct: ['code_commune'],
    });
    const codesWithDpe = new Set(withDpe.map(r => r.code_commune));
    communes = communes.filter(c => !codesWithDpe.has(c.code_insee));
    console.log(`Mode --retry-errors : ${communes.length} communes sans données DPE à réingérer`);
  }

  if (TEST_MODE) {
    communes = communes.slice(0, TEST_SIZE);
    console.log(`Mode TEST : ${TEST_SIZE} communes seulement\n`);
  } else if (LIMIT !== null && !isNaN(LIMIT) && LIMIT > 0) {
    communes = communes.slice(0, LIMIT);
    console.log(`Mode LIMIT : ${LIMIT} communes\n`);
  }

  const total = communes.length;
  console.log(`Ingestion DPE ADEME pour ${total} communes`);
  console.log(`Dataset : ${DATASET_ID} (logements existants depuis juillet 2021)`);
  console.log(`Rate limiting : ${RATE_LIMIT_MS}ms entre requêtes (~${Math.floor(1000 / RATE_LIMIT_MS)} req/s), backoff 429 activé\n`);

  for (let i = 0; i < communes.length; i += BATCH_SIZE) {
    const batch = communes.slice(i, i + BATCH_SIZE);

    for (const { code_insee } of batch) {
      try {
        const aggs = await fetchDpeWithBackoff(code_insee);
        await sleep(RATE_LIMIT_MS);

        if (aggs.length === 0) {
          await prisma.dpeCommune.deleteMany({ where: { code_commune: code_insee } });
          communesProcessed++;
          continue;
        }

        const rows = aggs.map(a => ({
          code_commune: code_insee,
          classe_dpe: a.value,
          nb_logements: a.total,
        }));

        await prisma.$transaction([
          prisma.dpeCommune.deleteMany({ where: { code_commune: code_insee } }),
          prisma.dpeCommune.createMany({ data: rows }),
        ]);

        communesWithDpe++;
        totalRowsInserted += rows.length;
        communesProcessed++;

        if (TEST_MODE) {
          const detail = rows.map(r => `${r.classe_dpe}:${r.nb_logements}`).join(' | ');
          console.log(`  ${code_insee} → ${detail}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        allErrors.push(`${code_insee}: ${msg}`);
        communesProcessed++;
        await sleep(RATE_LIMIT_MS);
      }
    }

    if (!TEST_MODE) {
      const pct = Math.round((communesProcessed / total) * 100);
      process.stdout.write(
        `\r  ${communesProcessed}/${total} (${pct}%) — ${communesWithDpe} avec DPE — ${allErrors.length} erreurs`,
      );
    }
  }

  if (!TEST_MODE) console.log('');

  return {
    source: `DPE ADEME (data.ademe.fr — dataset ${DATASET_ID})`,
    communes_processed: communesProcessed,
    communes_with_dpe: communesWithDpe,
    communes_errored: allErrors.length,
    total_rows_inserted: totalRowsInserted,
    duration_ms: Date.now() - start,
    errors: allErrors.slice(0, 20),
  };
}

ingest()
  .then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
    process.exit(result.communes_errored > result.communes_processed * 0.1 ? 1 : 0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
