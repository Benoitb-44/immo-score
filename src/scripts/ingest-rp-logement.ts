/**
 * ingest-rp-logement.ts
 * Ingestion INSEE Recensement Population 2022 — base communale logement.
 *
 * Source  : https://www.insee.fr/fr/statistiques/8581474
 * Format  : XLSX (double header L5=libellés, L6=codes INSEE, données L7+)
 * Probe   : scripts/probes/insee-rp-logement-probe.md
 *
 * Pièges connus (probe 2026-05-13) :
 *   - Double header : utiliser range:5 dans sheet_to_json
 *   - Valeurs float (estimations pondérées INSEE, ex. 7973.371)
 *   - P22_NBPI_RP = somme totale pièces (pas moyenne) → moy = NBPI/RP
 *   - Mayotte absent du fichier principal → fichier COM séparé
 *
 * Usage :
 *   npx tsx src/scripts/ingest-rp-logement.ts
 *   npx tsx src/scripts/ingest-rp-logement.ts --source=metro
 *   npx tsx src/scripts/ingest-rp-logement.ts --source=com
 *   npx tsx src/scripts/ingest-rp-logement.ts --dry-run --limit=10
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import XLSX from 'xlsx';

const prisma = new PrismaClient();

// ─── CLI args ──────────────────────────────────────────────────────────────────

const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
    })
) as Record<string, string>;

const DRY_RUN   = ARGS['dry-run'] === 'true';
const LIMIT     = ARGS['limit'] ? parseInt(ARGS['limit'], 10) : null;
const SOURCE    = (ARGS['source'] ?? 'all') as 'metro' | 'com' | 'all';

if (ARGS['dry-run']) {
  console.log('[ingest-rp] Mode DRY-RUN — aucune écriture en base');
}

const MILLESIME = 'RP2022';
const BATCH_SIZE = 500;
const DATA_DIR  = 'data/raw/insee-rp-logement';

// ─── Sources ───────────────────────────────────────────────────────────────────

const SOURCES = {
  metro: {
    file: `${DATA_DIR}/base-cc-logement-2022.xlsx`,
    url: 'https://www.insee.fr/fr/statistiques/fichier/8581474/base-cc-logement-2022_xlsx.zip',
    sheet: 'COM_2022',
    label: 'France hors Mayotte',
  },
  com: {
    file: `${DATA_DIR}/base-cc-logement-2022-COM.xlsx`,
    url: 'https://www.insee.fr/fr/statistiques/fichier/8581474/base-cc-logement-2022-COM_xlsx.zip',
    sheet: 'COM_2022',
    label: 'Collectivités d\'outre-mer (Mayotte)',
  },
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RpRow {
  code_commune: string;
  nb_logements_total: number;
  nb_residences_principales: number;
  nb_pieces_total_rp: number;
  nb_pieces_moy: number;
  nb_prop_occupants: number | null;
}

// ─── Download + extract ZIP ────────────────────────────────────────────────────

async function downloadAndExtractZip(url: string, destFile: string): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  const zipPath = destFile.replace('.xlsx', '.zip');
  console.log(`  → Téléchargement ${url}`);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(180_000),
    headers: { 'User-Agent': 'CityRank-Ingest/1.0 (+https://cityrank.fr)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('Réponse sans body');

  const ws = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), ws);
  console.log(`  → ZIP sauvegardé : ${zipPath}`);

  // Extract via AdmZip (fallback: unzip via child_process)
  const { execSync } = await import('node:child_process');
  execSync(`unzip -o "${zipPath}" -d "${DATA_DIR}"`, { stdio: 'pipe' });
  console.log(`  → XLSX extrait : ${destFile}`);
}

// ─── Parse XLSX ────────────────────────────────────────────────────────────────

function parseXlsx(filePath: string, sheetName: string): RpRow[] {
  console.log(`  → Lecture XLSX : ${filePath}`);

  const wb = XLSX.readFile(filePath, {
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    const available = wb.SheetNames.join(', ');
    throw new Error(`Feuille "${sheetName}" introuvable. Feuilles disponibles : ${available}`);
  }

  // Double-header : L5=libellés FR, L6=codes INSEE, L7+=données
  // range:5 → row 0 = codes INSEE (L6), row 1+ = données (L7+)
  const rawArr = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    range: 5,
    defval: null,
  });

  const techCodes = (rawArr[0] as (string | null)[]).map(h => String(h ?? ''));
  const dataArrays = rawArr.slice(1) as (string | number | null)[][];

  const colIdx = Object.fromEntries(techCodes.map((h, i) => [h, i]));

  const REQUIRED = ['CODGEO', 'P22_LOG', 'P22_RP', 'P22_NBPI_RP'];
  for (const col of REQUIRED) {
    if (colIdx[col] === undefined) {
      throw new Error(`Colonne requise "${col}" absente. Codes détectés : ${techCodes.slice(0, 10).join(', ')}`);
    }
  }

  const rows: RpRow[] = [];
  let nullCodes = 0;
  let nullRp = 0;

  for (const arr of dataArrays) {
    const raw = arr as (string | number | null)[];
    const code = raw[colIdx['CODGEO']];
    if (!code) { nullCodes++; continue; }

    const codeStr = String(code).trim();
    if (!codeStr) { nullCodes++; continue; }

    const log   = raw[colIdx['P22_LOG']];
    const rp    = raw[colIdx['P22_RP']];
    const nbpi  = raw[colIdx['P22_NBPI_RP']];
    const prop  = colIdx['P22_RP_PROP'] !== undefined ? raw[colIdx['P22_RP_PROP']] : null;

    if (log == null || rp == null || nbpi == null) continue;

    const rpNum  = Number(rp);
    const nbpiNum = Number(nbpi);

    if (rpNum === 0) { nullRp++; continue; }

    const nbPiecesMoy = nbpiNum / rpNum;

    rows.push({
      code_commune:               codeStr,
      nb_logements_total:         Number(log),
      nb_residences_principales:  rpNum,
      nb_pieces_total_rp:         nbpiNum,
      nb_pieces_moy:              nbPiecesMoy,
      nb_prop_occupants:          prop != null ? Number(prop) : null,
    });
  }

  console.log(`  → ${rows.length} lignes parsées (nullCodes=${nullCodes}, RP=0=${nullRp})`);
  return rows;
}

// ─── Bulk upsert ───────────────────────────────────────────────────────────────

async function upsertBatch(rows: RpRow[]): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    try {
      // FIX 22P03 (anti-bug PR #14) : chaque colonne passée comme scalaire
      // individuel avec cast ::float8 — évite l'encodage incorrect des
      // tableau mixte null/non-null du protocole binaire Prisma.
      const valueFragments = batch.map(r =>
        Prisma.sql`(
          ${randomUUID()}::text,
          ${r.code_commune}::text,
          ${r.nb_logements_total}::float8,
          ${r.nb_residences_principales}::float8,
          ${r.nb_pieces_total_rp}::float8,
          ${r.nb_pieces_moy}::float8,
          ${r.nb_prop_occupants}::float8,
          ${MILLESIME}::text,
          ${'INSEE-RP'}::text
        )`
      );

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO immo_score.insee_rp_logement
          (id, code_commune,
           nb_logements_total, nb_residences_principales,
           nb_pieces_total_rp, nb_pieces_moy,
           nb_prop_occupants, millesime, source,
           created_at, updated_at)
        SELECT
          v.id::int, v.code_commune,
          v.nb_logements_total, v.nb_residences_principales,
          v.nb_pieces_total_rp, v.nb_pieces_moy,
          v.nb_prop_occupants, v.millesime, v.source,
          NOW(), NOW()
        FROM (VALUES ${Prisma.join(valueFragments)}) AS v(
          id, code_commune,
          nb_logements_total, nb_residences_principales,
          nb_pieces_total_rp, nb_pieces_moy,
          nb_prop_occupants, millesime, source
        )
        ON CONFLICT (code_commune) DO UPDATE SET
          nb_logements_total        = EXCLUDED.nb_logements_total,
          nb_residences_principales = EXCLUDED.nb_residences_principales,
          nb_pieces_total_rp        = EXCLUDED.nb_pieces_total_rp,
          nb_pieces_moy             = EXCLUDED.nb_pieces_moy,
          nb_prop_occupants         = EXCLUDED.nb_prop_occupants,
          millesime                 = EXCLUDED.millesime,
          source                    = EXCLUDED.source,
          updated_at                = NOW()
      `);
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

// ─── Ingest one source ─────────────────────────────────────────────────────────

async function ingestSource(key: 'metro' | 'com'): Promise<{
  source: string;
  communes_read: number;
  communes_upserted: number;
  errors: string[];
}> {
  const conf = SOURCES[key];
  console.log(`\n[ingest-rp] Source : ${conf.label}`);

  // Download if file not present
  if (!existsSync(conf.file)) {
    console.log(`  → Fichier absent — téléchargement...`);
    await downloadAndExtractZip(conf.url, conf.file);
  }

  let rows = parseXlsx(conf.file, conf.sheet);

  if (LIMIT != null) {
    rows = rows.slice(0, LIMIT);
    console.log(`  → Limite --limit=${LIMIT} appliquée`);
  }

  if (DRY_RUN) {
    console.log(`  → [DRY-RUN] ${rows.length} lignes, exemples :`);
    rows.slice(0, 3).forEach(r =>
      console.log(`    ${r.code_commune} LOG=${r.nb_logements_total.toFixed(0)} RP=${r.nb_residences_principales.toFixed(0)} pièces_moy=${r.nb_pieces_moy.toFixed(2)}`)
    );
    return { source: conf.label, communes_read: rows.length, communes_upserted: 0, errors: [] };
  }

  const { inserted, errors } = await upsertBatch(rows);
  console.log(`  → ${inserted}/${rows.length} communes upsertées, ${errors.length} erreurs`);

  return {
    source: conf.label,
    communes_read: rows.length,
    communes_upserted: inserted,
    errors: errors.slice(0, 20),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`\n[ingest-rp] Démarrage — source=${SOURCE}, dry-run=${DRY_RUN}, limit=${LIMIT ?? 'none'}`);

  const sourcesToRun: ('metro' | 'com')[] =
    SOURCE === 'all' ? ['metro', 'com'] :
    SOURCE === 'metro' ? ['metro'] :
    ['com'];

  const results = [];
  for (const s of sourcesToRun) {
    results.push(await ingestSource(s));
  }

  const totalRead     = results.reduce((a, r) => a + r.communes_read, 0);
  const totalUpserted = results.reduce((a, r) => a + r.communes_upserted, 0);
  const totalErrors   = results.flatMap(r => r.errors);
  const duration      = Date.now() - t0;

  console.log('\n[ingest-rp] ══════════ Résumé ══════════');
  console.log(`  Communes lues    : ${totalRead.toLocaleString('fr-FR')}`);
  console.log(`  Communes upsert  : ${totalUpserted.toLocaleString('fr-FR')}`);
  console.log(`  Erreurs          : ${totalErrors.length}`);
  console.log(`  Durée            : ${(duration / 1000).toFixed(1)}s`);
  if (totalErrors.length > 0) {
    console.log('  Détail erreurs :');
    totalErrors.forEach(e => console.log(`    - ${e}`));
  }

  const errorRate = totalRead > 0 ? totalErrors.length / totalRead : 0;
  process.exit(errorRate > 0.05 ? 1 : 0);
}

main()
  .catch(e => {
    console.error('[ingest-rp] ERREUR FATALE :', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
