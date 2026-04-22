/**
 * ingest-filosofi.ts
 * Ingestion des revenus médians par commune — INSEE Filosofi 2020.
 *
 * Source principale : https://www.insee.fr/fr/statistiques/6692392
 * Champ clé : CODGEO (code INSEE 5 car.), MED20 (revenu médian €/an par UC)
 *
 * Stratégie de téléchargement (par ordre de priorité) :
 *   0. Fichier local si LOCAL_FILOSOFI_PATH est défini (scp depuis VPS)
 *   1. INSEE   : indic-struct-distrib-revenu-2020-COMMUNES.zip
 *   2. data.gouv.fr : miroir du même ZIP
 *   3. opendatasoft  : export CSV plat (format différent, fallback de dernier recours)
 * Format détecté automatiquement par magic bytes (ZIP = PK\x03\x04, sinon CSV).
 *
 * Usage :
 *   npm run ingest:filosofi
 *   npm run ingest:filosofi -- --test          (limite à 10 000 lignes)
 *   npm run ingest:filosofi -- --dept=33       (département ciblé)
 *   LOCAL_FILOSOFI_PATH=/tmp/filosofi.zip npm run ingest:filosofi
 */

import { PrismaClient } from '@prisma/client';
import { createInflateRaw } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { readFileSync, existsSync } from 'fs';

const prisma = new PrismaClient();

// Sources par ordre de priorité (ZIP ou CSV détecté automatiquement)
// Fichier cible dans le ZIP : cc_filosofi_2020_COM.csv (séparateur ;, latin-1)
const DOWNLOAD_SOURCES = [
  {
    label: 'INSEE CSV (source officielle)',
    url: 'https://www.insee.fr/fr/statistiques/fichier/6692392/base-cc-filosofi-2020_CSV.zip',
  },
  {
    label: 'INSEE CSV historique (codes géo 2020)',
    url: 'https://www.insee.fr/fr/statistiques/fichier/6692392/base-cc-filosofi-2020_CSV_histo.zip',
  },
];

// Fichier local : scp /tmp/filosofi.zip ubuntu@vps:/tmp/ puis LOCAL_FILOSOFI_PATH=/tmp/filosofi.zip
const LOCAL_PATH = process.env['LOCAL_FILOSOFI_PATH'] ?? null;

const BATCH_SIZE   = 500;
const TEST_MODE    = process.argv.includes('--test');
const TEST_LIMIT   = 10_000;
const DEPT_ARG     = process.argv.find(a => a.startsWith('--dept='));
const FILTER_DEPT  = DEPT_ARG ? DEPT_ARG.replace('--dept=', '').trim() : null;

// ─── Acquisition des données (local → INSEE → data.gouv.fr → opendatasoft) ───

/** ZIP magic bytes : PK\x03\x04 */
function isZipBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

interface FetchResult {
  buf:    Buffer;
  isZip:  boolean;
  source: string;
}

async function fetchWithFallback(): Promise<FetchResult> {
  // 0. Fichier local (scp fallback manuel)
  if (LOCAL_PATH) {
    if (!existsSync(LOCAL_PATH)) {
      throw new Error(`LOCAL_FILOSOFI_PATH="${LOCAL_PATH}" introuvable sur le disque.`);
    }
    const buf = readFileSync(LOCAL_PATH);
    console.log(`  → Source : fichier local ${LOCAL_PATH} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    return { buf, isZip: isZipBuffer(buf), source: `local:${LOCAL_PATH}` };
  }

  // 1-3. Sources réseau avec fallback automatique
  const errors: string[] = [];
  for (const { label, url } of DOWNLOAD_SOURCES) {
    try {
      process.stdout.write(`  → Tentative ${label}... `);
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error(`Réponse trop courte (${buf.length} octets) — probablement une page d'erreur HTML`);
      console.log(`OK (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
      return { buf, isZip: isZipBuffer(buf), source: url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ÉCHEC — ${msg}`);
      errors.push(`${label}: ${msg}`);
    }
  }

  throw new Error(
    `Toutes les sources ont échoué. Pour contourner, télécharger manuellement puis scp :\n` +
    `  # Sur votre machine locale :\n` +
    `  curl -L -o /tmp/filosofi.zip "https://www.insee.fr/fr/statistiques/fichier/6692392/base-cc-filosofi-2020_CSV.zip"\n` +
    `  scp /tmp/filosofi.zip ubuntu@37.59.122.208:/tmp/filosofi.zip\n` +
    `  # Sur le VPS :\n` +
    `  docker exec -e LOCAL_FILOSOFI_PATH=/tmp/filosofi.zip -it cityrank npm run ingest:filosofi\n\n` +
    `Détail des erreurs :\n${errors.map(e => `  - ${e}`).join('\n')}`,
  );
}

// ─── Parsing ZIP (Central Directory) ─────────────────────────────────────────

async function extractCsvFromZip(buf: Buffer): Promise<Readable> {
  // Cherche le premier fichier CSV dans le ZIP
  let eocdPos = -1;
  const searchStart = Math.max(0, buf.length - 65_558);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('EOCD non trouvé dans le ZIP');

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize   = buf.readUInt32LE(eocdPos + 12);
  let   pos      = cdOffset;
  const cdEnd    = cdOffset + cdSize;

  const entries: Array<{ filename: string; method: number; start: number; compressedSize: number }> = [];

  while (pos + 46 <= cdEnd) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method       = buf.readUInt16LE(pos + 10);
    const compressedSz = buf.readUInt32LE(pos + 20);
    const filenameLen  = buf.readUInt16LE(pos + 28);
    const extraLen     = buf.readUInt16LE(pos + 30);
    const commentLen   = buf.readUInt16LE(pos + 32);
    const localOffset  = buf.readUInt32LE(pos + 42);
    const filename     = buf.toString('utf8', pos + 46, pos + 46 + filenameLen);

    if (filename.toLowerCase().endsWith('.csv') && !filename.includes('__MACOSX')) {
      const lfnLen    = buf.readUInt16LE(localOffset + 26);
      const lexLen    = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lfnLen + lexLen;
      entries.push({ filename, method, start: dataStart, compressedSize: compressedSz });
    }

    pos += 46 + filenameLen + extraLen + commentLen;
  }

  if (entries.length === 0) throw new Error('Aucun CSV trouvé dans le ZIP');

  // Préférer cc_filosofi_2020_COM.csv (données communes, sans intervalles de confiance)
  const entry = entries.find(e => /cc_filosofi.*_COM\.csv$/i.test(e.filename))
    ?? entries.find(e => e.filename.toUpperCase().includes('COM'))
    ?? entries[0];
  console.log(`  → Fichier extrait : ${entry.filename}`);

  const compressed = buf.subarray(entry.start, entry.start + entry.compressedSize);

  if (entry.method === 0) {
    // Stored (non compressé)
    return Readable.from(compressed);
  } else if (entry.method === 8) {
    // Deflate
    return new Promise((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];
      inflate.on('data', (c: Buffer) => chunks.push(c));
      inflate.on('end',  () => resolve(Readable.from(Buffer.concat(chunks))));
      inflate.on('error', reject);
      inflate.write(compressed);
      inflate.end();
    });
  } else {
    throw new Error(`Méthode de compression non supportée : ${entry.method}`);
  }
}

// ─── Parsing CSV Filosofi ─────────────────────────────────────────────────────

interface FilosofiRow {
  code_commune: string;
  revenu_median: number;
}

async function parseCsv(stream: Readable): Promise<FilosofiRow[]> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const rows: FilosofiRow[] = [];

  let headers: string[] = [];
  let lineCount = 0;
  let codgeoIdx = -1;
  let med20Idx  = -1;
  let skipped   = 0;
  let secrets   = 0;

  for await (const line of rl) {
    lineCount++;
    if (TEST_MODE && lineCount > TEST_LIMIT) break;

    // Détecte le séparateur sur la première ligne (;  ou ,)
    if (lineCount === 1) {
      const sep = line.includes(';') ? ';' : ',';
      headers   = line.split(sep).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
      codgeoIdx = headers.indexOf('CODGEO');
      med20Idx  = headers.indexOf('MED20');

      if (codgeoIdx === -1) throw new Error(`Colonne CODGEO absente. Colonnes : ${headers.join(', ')}`);
      if (med20Idx  === -1) throw new Error(`Colonne MED20 absente. Colonnes : ${headers.join(', ')}`);
      continue;
    }

    const sep  = line.includes(';') ? ';' : ',';
    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < Math.max(codgeoIdx, med20Idx) + 1) continue;

    const codgeo = cols[codgeoIdx];
    const med20  = cols[med20Idx];

    // Garder uniquement les codes communes à 5 caractères (exclut EPCI "200...", dept "75", etc.)
    if (codgeo.length !== 5) { skipped++; continue; }

    // Filtrage département optionnel
    if (FILTER_DEPT && !codgeo.startsWith(FILTER_DEPT)) continue;

    // "s" = secret statistique, vide = non renseigné → skip (NULL, pas 0)
    if (!med20 || med20 === 's' || med20 === 'nd' || med20 === 'ns') {
      secrets++;
      continue;
    }

    const revenu = parseFloat(med20.replace(',', '.'));
    if (isNaN(revenu) || revenu <= 0) { secrets++; continue; }

    rows.push({ code_commune: codgeo, revenu_median: revenu });
  }

  console.log(`  → Lignes lues : ${lineCount} | communes valides : ${rows.length} | EPCI/dept skippés : ${skipped} | secrets/vides : ${secrets}`);
  return rows;
}

// ─── Upsert en base ───────────────────────────────────────────────────────────

async function upsertBatch(rows: FilosofiRow[]): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$executeRaw`
        INSERT INTO immo_score.insee_filosofi (code_commune, revenu_median, annee, created_at)
        SELECT * FROM UNNEST(
          ${batch.map(r => r.code_commune)}::text[],
          ${batch.map(r => r.revenu_median)}::float8[],
          ${batch.map(() => 2020)}::int[],
          ${batch.map(() => new Date())}::timestamptz[]
        ) AS t(code_commune, revenu_median, annee, created_at)
        ON CONFLICT (code_commune) DO UPDATE
          SET revenu_median = EXCLUDED.revenu_median,
              annee         = EXCLUDED.annee
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

// ─── Point d'entrée ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== INSEE Filosofi 2020 — ingestion ===');
  console.log(`Mode : ${TEST_MODE ? 'TEST' : 'PRODUCTION'}${FILTER_DEPT ? ` | Département ${FILTER_DEPT}` : ''}`);

  // 1. Acquisition des données (local → INSEE → data.gouv.fr → opendatasoft)
  console.log(LOCAL_PATH
    ? `\n[1/4] Chargement depuis fichier local : ${LOCAL_PATH}`
    : '\n[1/4] Téléchargement (avec fallback automatique)...',
  );
  const { buf, isZip, source } = await fetchWithFallback();
  console.log(`  → Source utilisée : ${source}`);

  // 2. Extraction CSV (ZIP → décompresse ; CSV direct → passe tel quel)
  console.log(`\n[2/4] ${isZip ? 'Extraction CSV depuis ZIP...' : 'Fichier CSV direct détecté, pas de décompression.'}`);
  const csvStream = isZip
    ? await extractCsvFromZip(buf)
    : Readable.from(buf);

  // 3. Parsing
  console.log('\n[3/4] Parsing CSV...');
  const rows = await parseCsv(csvStream);

  if (rows.length === 0) {
    console.error('  ✗ Aucune ligne valide parsée. Vérifier le format du fichier.');
    process.exit(1);
  }

  // 4. Upsert
  console.log(`\n[4/4] Upsert de ${rows.length} communes...`);
  const { inserted, errors } = await upsertBatch(rows);

  // Statistiques de couverture
  const totalCommunes = await prisma.commune.count();
  const covered = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.insee_filosofi
  `;
  const coveredCount = parseInt(covered[0].cnt);
  const pct = totalCommunes > 0 ? ((coveredCount / totalCommunes) * 100).toFixed(1) : '0';

  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n=== Résultat ===');
  console.log(`  Communes parsées  : ${rows.length}`);
  console.log(`  Communes upsertées: ${inserted}`);
  console.log(`  Erreurs           : ${errors.length}`);
  console.log(`  Couverture Filosofi : ${coveredCount} / ${totalCommunes} communes (${pct}%)`);
  console.log(`  Durée             : ${duration}s`);

  if (errors.length > 0) {
    console.error('\n  Erreurs détail :');
    errors.slice(0, 5).forEach(e => console.error(`  - ${e}`));
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
