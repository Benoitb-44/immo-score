/**
 * ingest-bpe.ts
 * Ingestion de la Base Permanente des Équipements (BPE INSEE 2024) depuis insee.fr.
 *
 * Stratégie :
 * - Téléchargement du fichier ZIP (~13 MB) en une seule requête
 * - Extraction du fichier DS_BPE_2024_data.csv via parsing Central Directory ZIP
 * - Parsing CSV ligne par ligne en streaming (séparateur ;, valeurs entre guillemets, UTF-8)
 * - Filtre GEO_OBJECT = COM et FACILITY_TYPE ∈ whitelist (src/lib/bpe-codes.ts)
 * - Agrégation par code commune : comptages sous-catégories + 30 flags booléens
 * - Upsert idempotent en batches de 100 communes
 *
 * Format BPE 2024 (harmonisé européen) :
 *   Colonnes : GEO ; GEO_OBJECT ; FACILITY_DOM ; FACILITY_SDOM ; FACILITY_TYPE ; BPE_MEASURE ; TIME_PERIOD ; OBS_VALUE
 *   Encoding : UTF-8, valeurs entre guillemets doubles
 *
 * Usage :
 *   npm run ingest:bpe
 *   npm run ingest:bpe -- --test              (limite à 50 000 lignes CSV)
 *   npm run ingest:bpe -- --depts=33,69,13    (départements ciblés)
 */

import { PrismaClient } from '@prisma/client';
import { createInflateRaw } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { BPE_CODE_MAP, BPE_TYPEQUS, BPE_CODES, BPE_TOTAL } from '../lib/bpe-codes';

const prisma = new PrismaClient();

const BPE_URL          = 'https://www.insee.fr/fr/statistiques/fichier/8217527/DS_BPE_CSV_FR.zip';
const BPE_URL_FALLBACK = 'https://www.data.gouv.fr/fr/datasets/r/d84e4d4e-5d36-4c24-b1fd-61ebb31e0fd1'; // archivé BPE 2023
const DATA_FILENAME    = 'DS_BPE_2024_data.csv';

const BATCH_SIZE     = 100;
const TEST_MODE      = process.argv.includes('--test');
const TEST_LINE_LIMIT = 50_000;
const DEPTS_ARG      = process.argv.find(a => a.startsWith('--depts='));
const FILTER_DEPTS   = DEPTS_ARG ? DEPTS_ARG.replace('--depts=', '').split(',').map(d => d.trim()) : null;

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
 * Itère la Central Directory du ZIP pour trouver un fichier par nom.
 * Retourne l'offset de début des données compressées, la taille, et la méthode.
 * Supporte deflate (méthode 8) et stored (méthode 0).
 */
function findZipEntry(
  buf: Buffer,
  targetFilename: string,
): { start: number; compressedSize: number; method: number } {
  // Cherche EOCD (End of Central Directory) en remontant depuis la fin
  let eocdPos = -1;
  const searchStart = Math.max(0, buf.length - 65_558);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('ZIP invalide : signature EOCD introuvable');

  const cdCount  = buf.readUInt16LE(eocdPos + 8);
  let   cdOffset = buf.readUInt32LE(eocdPos + 16);

  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error(`ZIP invalide : signature Central Directory incorrecte à l'entrée ${i}`);
    }

    const comprMethod    = buf.readUInt16LE(cdOffset + 10);
    const compressedSize = buf.readUInt32LE(cdOffset + 20);
    const filenameLen    = buf.readUInt16LE(cdOffset + 28);
    const extraLen       = buf.readUInt16LE(cdOffset + 30);
    const commentLen     = buf.readUInt16LE(cdOffset + 32);
    const localHdrOffset = buf.readUInt32LE(cdOffset + 42);
    const filename       = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + filenameLen);

    cdOffset += 46 + filenameLen + extraLen + commentLen;

    if (filename !== targetFilename) continue;

    // Trouvé — lit le Local File Header pour calculer l'offset exact des données
    if (buf.readUInt32LE(localHdrOffset) !== 0x04034b50) {
      throw new Error('ZIP invalide : signature Local File Header incorrecte');
    }
    const lfhFilenameLen = buf.readUInt16LE(localHdrOffset + 26);
    const lfhExtraLen    = buf.readUInt16LE(localHdrOffset + 28);
    const dataStart      = localHdrOffset + 30 + lfhFilenameLen + lfhExtraLen;

    return { start: dataStart, compressedSize, method: comprMethod };
  }

  throw new Error(`Fichier "${targetFilename}" introuvable dans le ZIP`);
}

// ─── Téléchargement ───────────────────────────────────────────────────────────

async function downloadZip(url: string, label: string): Promise<Buffer> {
  console.log(`[ingest-bpe] Téléchargement ZIP BPE 2024 (${label})...`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'immo-score/1.0 (data.ingestion@immorank.fr)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} lors du téléchargement BPE`);
  const bytes = await res.arrayBuffer();
  const buf = Buffer.from(bytes);
  console.log(`[ingest-bpe] ZIP téléchargé : ${(buf.length / 1_048_576).toFixed(1)} Mo`);
  return buf;
}

async function downloadZipWithFallback(): Promise<Buffer> {
  try {
    return await downloadZip(BPE_URL, 'source principale');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ingest-bpe] Source principale en erreur (${msg}), tentative fallback...`);
    return await downloadZip(BPE_URL_FALLBACK, 'fallback data.gouv.fr');
  }
}

// ─── Parsing CSV ──────────────────────────────────────────────────────────────

/** Découpe une ligne CSV BPE 2024 : séparateur ; valeurs optionnellement entre guillemets. */
function parseLine(line: string): string[] {
  return line.split(';').map(f => {
    const t = f.trim();
    return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
  });
}

/**
 * Parse le CSV BPE 2024 en streaming depuis le buffer compressé.
 * Format attendu : GEO ; GEO_OBJECT ; FACILITY_DOM ; FACILITY_SDOM ; FACILITY_TYPE ; BPE_MEASURE ; TIME_PERIOD ; OBS_VALUE
 * Retourne une Map code_commune → agrégat.
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
    const source = Readable.from([compressedSlice]);
    const inflater = createInflateRaw();
    input = source.pipe(inflater) as unknown as Readable;
  } else if (comprMethod === 0) {
    input = Readable.from([compressedSlice]);
  } else {
    throw new Error(`Méthode de compression ZIP non supportée : ${comprMethod}`);
  }

  const rl = createInterface({ input, crlfDelay: Infinity });

  let isHeader = true;
  const hdr: Record<string, number> = {};
  let lineCount = 0;
  let filteredRows = 0;
  const deprecatedCodes = new Set<string>();

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, '');
    if (!line.trim()) continue;

    if (isHeader) {
      parseLine(line).forEach((col, i) => { hdr[col.toUpperCase()] = i; });
      isHeader = false;

      const required = ['GEO', 'GEO_OBJECT', 'FACILITY_TYPE'];
      for (const col of required) {
        if (hdr[col] === undefined) throw new Error(`Colonne ${col} introuvable dans le CSV BPE`);
      }
      continue;
    }

    lineCount++;
    if (TEST_MODE && lineCount > TEST_LINE_LIMIT) break;

    const fields = parseLine(line);
    const geo       = fields[hdr['GEO']];
    const geoObject = fields[hdr['GEO_OBJECT']];
    const facType   = fields[hdr['FACILITY_TYPE']];

    // Filtre : communes uniquement, pas les totaux (_T)
    if (geoObject !== 'COM') continue;
    if (!facType || facType === '_T') continue;
    if (!BPE_TYPEQUS.has(facType)) continue;

    if (!geo || geo.length < 5) continue;

    // Filtre département
    if (FILTER_DEPTS && !FILTER_DEPTS.some(d => geo.startsWith(d))) continue;

    filteredRows++;
    const code = geo.substring(0, 5);
    const bpeCode = BPE_CODE_MAP.get(facType)!;

    let agg = byCommune.get(code);
    if (!agg) {
      agg = {
        education_count: 0, sante_count: 0, commerces_count: 0,
        transport_count: 0, culture_sport_count: 0,
        flags: {},
      };
      byCommune.set(code, agg);
    }

    if (!agg.flags[bpeCode.flag]) {
      agg.flags[bpeCode.flag] = true;
      switch (bpeCode.category) {
        case 'education':    agg.education_count++;     break;
        case 'sante':        agg.sante_count++;         break;
        case 'commerces':    agg.commerces_count++;     break;
        case 'transport':    agg.transport_count++;     break;
        case 'cultureSport': agg.culture_sport_count++; break;
      }
    }
  }

  // Log codes BPE_CODES sans équivalent 2024 (typequ vide)
  for (const c of BPE_CODES) {
    if (!c.typequ) deprecatedCodes.add(c.flag);
  }
  if (deprecatedCodes.size > 0) {
    console.warn(`[ingest-bpe] Codes sans équivalent BPE 2024 (toujours false) : ${[...deprecatedCodes].join(', ')}`);
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
    education_count:      agg.education_count,
    sante_count:          agg.sante_count,
    commerces_count:      agg.commerces_count,
    transport_count:      agg.transport_count,
    culture_sport_count:  agg.culture_sport_count,
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

  if (TEST_MODE) console.log('[ingest-bpe] MODE TEST — lecture limitée à 50 000 lignes CSV');
  if (FILTER_DEPTS) console.log(`[ingest-bpe] Départements ciblés : ${FILTER_DEPTS.join(', ')}`);

  // 1. Téléchargement avec fallback
  const zipBuf = await downloadZipWithFallback();

  // 2. Localise DS_BPE_2024_data.csv dans le ZIP via Central Directory
  const { start: dataStart, compressedSize, method } = findZipEntry(zipBuf, DATA_FILENAME);
  console.log(
    `[ingest-bpe] Entrée ZIP trouvée (${DATA_FILENAME}) : offset=${dataStart}, ` +
    `taille compressée=${(compressedSize / 1_048_576).toFixed(1)} Mo, méthode=${method}`,
  );

  // 3. Parsing CSV en streaming
  const byCommune = await parseCsvStream(zipBuf, dataStart, compressedSize, method);

  // 4. Communes connues en base
  const knownRows = await prisma.commune.findMany({ select: { code_insee: true } });
  const knownCommunes = new Set(knownRows.map(r => r.code_insee));
  console.log(`[ingest-bpe] ${knownCommunes.size} communes référencées en base`);
  // BPE 2024 COM-level : ~23 500 communes (~68%) — les communes sans aucun des 29 équipements dans leur territoire
  // obtiennent un score BPE de 0, ce qui est sémantiquement correct pour de très petites communes rurales.
  console.log(`[ingest-bpe] Communes avec >=1 équipement : ${byCommune.size.toLocaleString()} / ${knownCommunes.size}`);

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
    source: 'BPE INSEE 2024 (DS_BPE_CSV_FR.zip)',
    communes_processed:         inserted,
    communes_inserted:          inserted,
    communes_errored:           errors.length,
    total_equip_essentiels_avg: avgEssentiels,
    coverage_pct:               coveragePct,
    duration_ms:                Date.now() - start,
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
