/**
 * ingest-bpe.ts
 * Ingestion de la Base Permanente des Équipements (BPE INSEE 2023) depuis insee.fr.
 *
 * Stratégie :
 * - Téléchargement du fichier ZIP (~15 MB) en une seule requête
 * - Extraction du CSV via parsing manuel du format ZIP (inflateRaw — pas de dépendance externe)
 * - Parsing CSV ligne par ligne en streaming (séparateur ;, encodage latin-1)
 * - Filtre sur 30 TYPEQU retenus (src/lib/bpe-codes.ts)
 * - Agrégation par DEPCOM : comptages sous-catégories + 30 flags booléens
 * - Upsert idempotent en batches de 100 communes
 *
 * Usage :
 *   npm run ingest:bpe
 *   npm run ingest:bpe -- --test              (limite à 10 000 lignes CSV)
 *   npm run ingest:bpe -- --depts=33,69,13    (départements ciblés)
 */

import { PrismaClient } from '@prisma/client';
import { createInflateRaw } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { BPE_CODE_MAP, BPE_TYPEQUS, BPE_CODES, BPE_TOTAL } from '../lib/bpe-codes';

const prisma = new PrismaClient();
const BPE_URL = 'https://www.insee.fr/fr/statistiques/fichier/3568629/bpe23_ensemble_xy_csv.zip';
const BATCH_SIZE = 100;
const TEST_MODE = process.argv.includes('--test');
const TEST_LINE_LIMIT = 10_000;
const DEPTS_ARG = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;

// ─── Types internes ───────────────────────────────────────────────────────────

interface CommuneAgg {
  education_count: number;
  sante_count: number;
  commerces_count: number;
  transport_count: number;
  culture_sport_count: number;
  flags: Record<string, boolean>;
}

interface IngestResult {
  source: string;
  communes_processed: number;
  communes_inserted: number;
  communes_errored: number;
  total_equip_essentiels_avg: number;
  coverage_pct: number;
  duration_ms: number;
  errors: string[];
}

// ─── Parsing ZIP ──────────────────────────────────────────────────────────────

/**
 * Extrait le premier fichier CSV d'un buffer ZIP.
 * Utilise la Central Directory pour obtenir les offsets corrects (robuste aux data descriptors).
 * Supporte uniquement deflate (méthode 8) et stored (méthode 0).
 */
function findZipEntryBounds(buf: Buffer): { start: number; compressedSize: number; method: number } {
  // Cherche EOCD (End of Central Directory) signature PK\x05\x06 en remontant depuis la fin
  let eocdPos = -1;
  const searchStart = Math.max(0, buf.length - 65_558); // 65535 max comment + 22 EOCD
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('ZIP invalide : signature EOCD introuvable');

  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  // Vérifie la signature de la Central Directory (PK\x01\x02)
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) {
    throw new Error('ZIP invalide : signature Central Directory incorrecte');
  }

  // Lit les champs de la Central Directory (premier fichier)
  const comprMethod    = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20);
  const localHdrOffset = buf.readUInt32LE(cdOffset + 42);

  // Vérifie la signature du Local File Header (PK\x03\x04)
  if (buf.readUInt32LE(localHdrOffset) !== 0x04034b50) {
    throw new Error('ZIP invalide : signature Local File Header incorrecte');
  }

  const lfhFilenameLen = buf.readUInt16LE(localHdrOffset + 26);
  const lfhExtraLen    = buf.readUInt16LE(localHdrOffset + 28);
  const dataStart      = localHdrOffset + 30 + lfhFilenameLen + lfhExtraLen;

  return { start: dataStart, compressedSize, method: comprMethod };
}

// ─── Téléchargement ───────────────────────────────────────────────────────────

async function downloadZip(url: string): Promise<Buffer> {
  console.log(`[ingest-bpe] Téléchargement ZIP BPE 2023...`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'immo-score/1.0 (data.ingestion@immorank.fr)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} lors du téléchargement BPE`);
  const bytes = await res.arrayBuffer();
  const buf = Buffer.from(bytes);
  console.log(`[ingest-bpe] ZIP téléchargé : ${(buf.length / 1_048_576).toFixed(1)} Mo`);
  return buf;
}

// ─── Parsing CSV ──────────────────────────────────────────────────────────────

function parseSemicolonLine(line: string): string[] {
  return line.split(';').map(f => f.trim());
}

/**
 * Parse le CSV BPE en streaming depuis le buffer compressé.
 * Retourne une Map DEPCOM → agrégat.
 */
async function parseCsvStream(
  zipBuf: Buffer,
  dataStart: number,
  compressedSize: number,
  comprMethod: number,
): Promise<Map<string, CommuneAgg>> {
  const byCommune = new Map<string, CommuneAgg>();

  const compressedSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);

  let input: Readable;
  if (comprMethod === 8) {
    // Deflate — streaming inflate
    const source = Readable.from([compressedSlice]);
    const inflater = createInflateRaw();
    input = source.pipe(inflater) as unknown as Readable;
  } else if (comprMethod === 0) {
    // Stored — pas de compression
    input = Readable.from([compressedSlice]);
  } else {
    throw new Error(`Méthode de compression ZIP non supportée : ${comprMethod}`);
  }

  const rl = createInterface({ input, crlfDelay: Infinity });

  let isHeader = true;
  const hdr: Record<string, number> = {};
  let lineCount = 0;
  let filteredRows = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, ''); // strip BOM si présent
    if (!line.trim()) continue;

    if (isHeader) {
      parseSemicolonLine(line).forEach((col, i) => { hdr[col.toUpperCase()] = i; });
      isHeader = false;

      // Vérification colonnes requises
      if (hdr['DEPCOM'] === undefined) throw new Error('Colonne DEPCOM introuvable dans le CSV BPE');
      if (hdr['TYPEQU'] === undefined) throw new Error('Colonne TYPEQU introuvable dans le CSV BPE');
      continue;
    }

    lineCount++;
    if (TEST_MODE && lineCount > TEST_LINE_LIMIT) break;

    const fields = parseSemicolonLine(line);
    const depcom = fields[hdr['DEPCOM']];
    const typequ = fields[hdr['TYPEQU']];

    if (!depcom || depcom.length < 5) continue;
    if (!BPE_TYPEQUS.has(typequ)) continue;

    // Filtre département
    if (FILTER_DEPTS && !FILTER_DEPTS.some(d => depcom.startsWith(d))) continue;

    filteredRows++;
    const code = depcom.substring(0, 5);
    const bpeCode = BPE_CODE_MAP.get(typequ)!;

    let agg = byCommune.get(code);
    if (!agg) {
      agg = {
        education_count: 0, sante_count: 0, commerces_count: 0,
        transport_count: 0, culture_sport_count: 0,
        flags: {},
      };
      byCommune.set(code, agg);
    }

    // Marque le flag et incrémente la sous-catégorie si c'est la première occurrence
    if (!agg.flags[bpeCode.flag]) {
      agg.flags[bpeCode.flag] = true;
      switch (bpeCode.category) {
        case 'education':    agg.education_count++;    break;
        case 'sante':        agg.sante_count++;        break;
        case 'commerces':    agg.commerces_count++;    break;
        case 'transport':    agg.transport_count++;    break;
        case 'cultureSport': agg.culture_sport_count++; break;
      }
    }
  }

  process.stdout.write(
    `[ingest-bpe] CSV parsé : ${lineCount.toLocaleString()} lignes lues, ` +
    `${filteredRows.toLocaleString()} lignes retenues, ` +
    `${byCommune.size.toLocaleString()} communes\n`,
  );

  return byCommune;
}

// ─── Upsert BDD ───────────────────────────────────────────────────────────────

function buildUpsertData(code: string, agg: CommuneAgg): Record<string, unknown> {
  const flags: Record<string, boolean> = {};
  for (const bpeCode of BPE_CODES) {
    flags[bpeCode.flag] = agg.flags[bpeCode.flag] ?? false;
  }

  const totalEquipEssentiels = Object.values(flags).filter(Boolean).length;

  return {
    code_commune: code,
    education_count:     agg.education_count,
    sante_count:         agg.sante_count,
    commerces_count:     agg.commerces_count,
    transport_count:     agg.transport_count,
    culture_sport_count: agg.culture_sport_count,
    total_equip_essentiels: totalEquipEssentiels,
    ...flags,
  };
}

async function upsertAll(
  byCommune: Map<string, CommuneAgg>,
  knownCommunes: Set<string>,
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const toProcess = [...byCommune.entries()].filter(([code]) => knownCommunes.has(code));
  let inserted = 0;
  let skipped = byCommune.size - toProcess.length;
  const errors: string[] = [];

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    try {
      await prisma.$transaction(
        batch.map(([code, agg]) => {
          const data = buildUpsertData(code, agg);
          return prisma.bpeCommune.upsert({
            where:  { code_commune: code },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: data as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: data as any,
          });
        }),
      );
      inserted += batch.length;
    } catch {
      // Relance commune par commune pour isoler l'erreur
      for (const [code, agg] of batch) {
        try {
          const data = buildUpsertData(code, agg);
          await prisma.bpeCommune.upsert({
            where:  { code_commune: code },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: data as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: data as any,
          });
          inserted++;
        } catch (e2: unknown) {
          skipped++;
          if (errors.length < 20) {
            errors.push(`${code}: ${e2 instanceof Error ? e2.message : String(e2)}`);
          }
        }
      }
    }

    const pct = Math.round(((i + batch.length) / toProcess.length) * 100);
    process.stdout.write(`\r[ingest-bpe] Upsert ${i + batch.length}/${toProcess.length} (${pct}%)`);
  }

  process.stdout.write('\n');
  return { inserted, skipped, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<IngestResult> {
  const start = Date.now();

  if (TEST_MODE) console.log('[ingest-bpe] MODE TEST — lecture limitée à 10 000 lignes CSV');
  if (FILTER_DEPTS) console.log(`[ingest-bpe] Départements ciblés : ${FILTER_DEPTS.join(', ')}`);

  // 1. Téléchargement
  const zipBuf = await downloadZip(BPE_URL);

  // 2. Extraction du CSV depuis le ZIP
  const { start: dataStart, compressedSize, method } = findZipEntryBounds(zipBuf);
  console.log(
    `[ingest-bpe] Entrée ZIP trouvée : offset=${dataStart}, ` +
    `taille compressée=${(compressedSize / 1_048_576).toFixed(1)} Mo, méthode=${method}`,
  );

  // 3. Parsing CSV en streaming
  const byCommune = await parseCsvStream(zipBuf, dataStart, compressedSize, method);

  // 4. Récupère les codes INSEE connus en base
  const knownRows = await prisma.commune.findMany({ select: { code_insee: true } });
  const knownCommunes = new Set(knownRows.map(r => r.code_insee));
  console.log(`[ingest-bpe] ${knownCommunes.size} communes référencées en base`);

  // 5. Upsert
  const { inserted, errors } = await upsertAll(byCommune, knownCommunes);

  // 6. Stats finales
  const allBpe = await prisma.bpeCommune.findMany({
    select: { total_equip_essentiels: true },
  });
  const totalSum = (allBpe as Array<{ total_equip_essentiels: number }>).reduce((s, r) => s + r.total_equip_essentiels, 0);
  const avgEssentiels = allBpe.length > 0 ? Math.round((totalSum / allBpe.length) * 10) / 10 : 0;
  const coveragePct = knownCommunes.size > 0
    ? Math.round((inserted / knownCommunes.size) * 1000) / 10
    : 0;

  console.log(`[ingest-bpe] Couverture BPE : ${inserted} communes avec données / ${knownCommunes.size} total (${coveragePct}%)`);
  console.log(`[ingest-bpe] Score brut moyen : ${avgEssentiels}/${BPE_TOTAL} équipements essentiels`);

  return {
    source: 'BPE INSEE 2023 (bpe23_ensemble_xy_csv.zip)',
    communes_processed:          inserted,
    communes_inserted:           inserted,
    communes_errored:            errors.length,
    total_equip_essentiels_avg:  avgEssentiels,
    coverage_pct:                coveragePct,
    duration_ms:                 Date.now() - start,
    errors,
  };
}

main()
  .then(result => {
    console.log('\n[ingest-bpe] Terminé :');
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.communes_errored > result.communes_inserted * 0.05 ? 1 : 0);
  })
  .catch(e => {
    console.error('[ingest-bpe] Erreur fatale :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
