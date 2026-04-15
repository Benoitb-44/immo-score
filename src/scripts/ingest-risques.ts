/**
 * ingest-risques.ts
 * Ingestion des risques naturels depuis l'API Géorisques (GASPAR + Radon)
 *
 * Sources :
 *   - GASPAR : https://georisques.gouv.fr/api/v1/gaspar/risques?code_insee={code_insee}
 *   - Radon  : https://georisques.gouv.fr/api/v1/radon?code_insee={code_insee}
 *
 * Stratégie :
 *   - Itération par batch de 100 communes
 *   - Rate limiting : 35ms entre requêtes (~28 req/s < 30 req/s limite Géorisques)
 *   - Idempotent : deleteMany + createMany par commune
 *   - NiveauRisque GASPAR : MOYEN pour tout risque listé (GASPAR ne fournit pas de niveau)
 *   - NiveauRisque Radon  : FAIBLE/MOYEN/FORT selon classe potentiel 1/2/3
 *   - Communes sans données : aucune ligne insérée (NULL implicite pour le score)
 *   - Mode test : --test traite seulement 10 communes
 */

import { PrismaClient, NiveauRisque } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'https://georisques.gouv.fr/api/v1';
const RATE_LIMIT_MS = 35; // ~28 req/s, sous la limite de 30 req/s
const BATCH_SIZE = 100;
const TEST_MODE = process.argv.includes('--test');

// ──────────────────── Types API ────────────────────

interface GasparRisqueDetail {
  num_risque?: string;
  libelle_risque_long?: string;
  zone_sismicite?: string | null;
}

interface GasparDataItem {
  code_insee?: string;
  libelle_commune?: string;
  risques_detail?: GasparRisqueDetail[];
}

interface GasparApiResponse {
  data?: GasparDataItem[];
  results?: number;
  response_code?: number;
}

interface RadonDataItem {
  code_insee?: string;
  libelle_commune?: string;
  classe_potentiel?: string; // "1", "2" ou "3" — retourné comme string par l'API
}

interface RadonApiResponse {
  data?: RadonDataItem[];
  results?: number;
}

interface IngestResult {
  source: string;
  communes_processed: number;
  communes_with_risks: number;
  communes_errored: number;
  total_risques_inserted: number;
  duration_ms: number;
  errors: string[];
}

// ──────────────────── Helpers ────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function radonClasseToNiveau(classe: string): NiveauRisque {
  if (classe === '1') return NiveauRisque.FAIBLE;
  if (classe === '2') return NiveauRisque.MOYEN;
  return NiveauRisque.FORT; // classe 3
}

// ──────────────────── Fetch GASPAR ────────────────────

async function fetchGasparRisques(codeInsee: string): Promise<GasparRisqueDetail[]> {
  const url = `${BASE_URL}/gaspar/risques?code_insee=${codeInsee}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404 || res.status === 204) return [];
  if (!res.ok) throw new Error(`GASPAR HTTP ${res.status}`);

  const data = (await res.json()) as GasparApiResponse;
  return data?.data?.[0]?.risques_detail ?? [];
}

// ──────────────────── Fetch Radon ────────────────────

async function fetchRadonClasse(codeInsee: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/radon?code_insee=${codeInsee}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as RadonApiResponse;
    const item = data?.data?.[0];
    const classe = item?.classe_potentiel;
    return typeof classe === 'string' && classe ? classe : null;
  } catch {
    // Radon optionnel : ne pas faire échouer la commune
    return null;
  }
}

// ──────────────────── Ingestion principale ────────────────────

async function ingest(): Promise<IngestResult> {
  const start = Date.now();
  const allErrors: string[] = [];
  let communesProcessed = 0;
  let communesWithRisks = 0;
  let totalRisques = 0;

  let communes = await prisma.commune.findMany({
    select: { code_insee: true },
    orderBy: { code_insee: 'asc' },
  });

  if (TEST_MODE) {
    communes = communes.slice(0, 10);
    console.log('Mode TEST : 10 communes seulement\n');
  }

  const total = communes.length;
  console.log(`Ingestion Géorisques pour ${total} communes`);
  console.log(`Rate limiting : ${RATE_LIMIT_MS}ms entre requêtes (~${Math.floor(1000 / RATE_LIMIT_MS)} req/s)`);
  console.log('');

  for (let i = 0; i < communes.length; i += BATCH_SIZE) {
    const batch = communes.slice(i, i + BATCH_SIZE);

    for (const { code_insee } of batch) {
      try {
        // Appel GASPAR
        const gasparRisques = await fetchGasparRisques(code_insee);
        await sleep(RATE_LIMIT_MS);

        // Appel Radon
        const radonClasse = await fetchRadonClasse(code_insee);
        await sleep(RATE_LIMIT_MS);

        // Construction des records
        const records: {
          code_commune: string;
          type_risque: string;
          niveau: NiveauRisque;
          description: string | null;
        }[] = [];

        for (const r of gasparRisques) {
          const typeRisque = r.num_risque ?? r.libelle_risque_long ?? 'inconnu';
          records.push({
            code_commune: code_insee,
            type_risque: typeRisque,
            niveau: NiveauRisque.MOYEN,
            description: r.libelle_risque_long ?? null,
          });
        }

        if (radonClasse !== null) {
          records.push({
            code_commune: code_insee,
            type_risque: 'radon',
            niveau: radonClasseToNiveau(radonClasse),
            description: `Potentiel radon classe ${radonClasse}/3`,
          });
        }

        // Upsert idempotent : deleteMany + createMany
        if (records.length > 0) {
          await prisma.$transaction([
            prisma.risque.deleteMany({ where: { code_commune: code_insee } }),
            prisma.risque.createMany({ data: records }),
          ]);
          communesWithRisks++;
          totalRisques += records.length;
        } else {
          await prisma.risque.deleteMany({ where: { code_commune: code_insee } });
        }

        communesProcessed++;

        if (TEST_MODE) {
          const detail = records.map(r => `${r.type_risque}(${r.niveau})`).join(', ') || 'aucun risque';
          console.log(`  ${code_insee} : ${detail}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        allErrors.push(`${code_insee}: ${msg}`);
        communesProcessed++;
      }
    }

    if (!TEST_MODE) {
      const pct = Math.round((communesProcessed / total) * 100);
      process.stdout.write(
        `\r  ${communesProcessed}/${total} (${pct}%) — ${communesWithRisks} avec risques — ${allErrors.length} erreurs`
      );
    }
  }

  if (!TEST_MODE) console.log('');

  return {
    source: 'Géorisques GASPAR + Radon (georisques.gouv.fr/api/v1)',
    communes_processed: communesProcessed,
    communes_with_risks: communesWithRisks,
    communes_errored: allErrors.length,
    total_risques_inserted: totalRisques,
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
