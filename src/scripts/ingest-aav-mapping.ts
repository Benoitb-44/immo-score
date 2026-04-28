/**
 * ingest-aav-mapping.ts
 * Mise à jour du champ aav_code sur la table communes depuis la correspondance
 * commune × AAV 2020 publiée par l'INSEE.
 *
 * Source : https://www.insee.fr/fr/information/4803954
 * Fichier : AAV2020_au_01-01-2023.zip → contient .csv OU .xlsx selon millésime
 *   (INSEE a basculé en XLSX pour les fichiers de zonage géographique ~2023)
 * Colonnes : CODGEO (code INSEE 5 car.), AAV2020 (code AAV 3 car.), CATEAAV2020
 *
 * Usage :
 *   npm run ingest:aav
 *   LOCAL_AAV_PATH=/tmp/aav2020.zip  npm run ingest:aav
 *   LOCAL_AAV_PATH=/tmp/aav2020.csv  npm run ingest:aav
 *   LOCAL_AAV_PATH=/tmp/aav2020.xlsx npm run ingest:aav
 */

import { PrismaClient } from '@prisma/client';
import { createInterface } from 'readline';
import { createInflateRaw } from 'zlib';
import { Readable } from 'stream';
import { readFileSync, existsSync } from 'fs';

const prisma = new PrismaClient();

const INSEE_AAV_URL =
  'https://www.insee.fr/fr/statistiques/fichier/4803954/AAV2020_au_01-01-2023.zip';

const LOCAL_PATH = process.env['LOCAL_AAV_PATH'] ?? null;
const BATCH_SIZE = 1_000;

// ─── Acquisition ─────────────────────────────────────────────────────────────

type FileKind = 'zip' | 'csv' | 'xlsx';
interface AcquiredFile { buf: Buffer; kind: FileKind; source: string }

async function acquireFile(): Promise<AcquiredFile> {
  if (LOCAL_PATH) {
    if (!existsSync(LOCAL_PATH)) throw new Error(`LOCAL_AAV_PATH="${LOCAL_PATH}" introuvable.`);
    const buf = readFileSync(LOCAL_PATH);
    const ext = LOCAL_PATH.toLowerCase();
    let kind: FileKind;
    if (ext.endsWith('.xlsx'))     kind = 'xlsx';
    else if (ext.endsWith('.csv')) kind = 'csv';
    else {
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      kind = isZip ? 'zip' : 'csv';
    }
    console.log(`  → Fichier local : ${LOCAL_PATH} (${(buf.length / 1024).toFixed(0)} KB, ${kind})`);
    return { buf, kind, source: LOCAL_PATH };
  }

  console.log(`  → Téléchargement INSEE : ${INSEE_AAV_URL}`);
  const res = await fetch(INSEE_AAV_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  → OK (${(buf.length / 1024).toFixed(0)} KB)`);
  return { buf, kind: 'zip', source: INSEE_AAV_URL };
}

// ─── Extraction ZIP (Central Directory) ──────────────────────────────────────

type ExtractedFile =
  | { format: 'csv'; stream: Readable }
  | { format: 'xlsx'; buffer: Buffer };

async function extractFileFromZip(buf: Buffer): Promise<ExtractedFile> {
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('EOCD ZIP introuvable');

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize   = buf.readUInt32LE(eocdPos + 12);
  let pos = cdOffset;

  let csvEntry:  { method: number; start: number; size: number; name: string } | null = null;
  let xlsxEntry: { method: number; start: number; size: number; name: string } | null = null;

  while (pos + 46 <= cdOffset + cdSize) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method   = buf.readUInt16LE(pos + 10);
    const compSz   = buf.readUInt32LE(pos + 20);
    const fnLen    = buf.readUInt16LE(pos + 28);
    const exLen    = buf.readUInt16LE(pos + 30);
    const comLen   = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name     = buf.toString('utf8', pos + 46, pos + 46 + fnLen);
    pos += 46 + fnLen + exLen + comLen;

    if (name.includes('__MACOSX')) continue;
    const lfn   = buf.readUInt16LE(localOff + 26);
    const lex   = buf.readUInt16LE(localOff + 28);
    const entry = { method, start: localOff + 30 + lfn + lex, size: compSz, name };

    if (name.toLowerCase().endsWith('.xlsx') && !xlsxEntry) xlsxEntry = entry;
    if (name.toLowerCase().endsWith('.csv')  && !csvEntry)  csvEntry  = entry;
  }

  // Préférer XLSX si présent ; sinon CSV
  const entry  = xlsxEntry ?? csvEntry;
  const format = xlsxEntry ? 'xlsx' : 'csv';

  if (!entry) throw new Error('Aucun fichier CSV ou XLSX dans le ZIP');
  console.log(`  → Fichier extrait : ${entry.name} (format: ${format})`);

  const compressed = buf.subarray(entry.start, entry.start + entry.size);
  const rawBuf = entry.method === 0
    ? compressed
    : await new Promise<Buffer>((resolve, reject) => {
        const inflate = createInflateRaw();
        const chunks: Buffer[] = [];
        inflate.on('data', (c: Buffer) => chunks.push(c));
        inflate.on('end',  () => resolve(Buffer.concat(chunks)));
        inflate.on('error', reject);
        inflate.write(compressed);
        inflate.end();
      });

  if (format === 'xlsx') return { format: 'xlsx', buffer: rawBuf };
  return { format: 'csv', stream: Readable.from(rawBuf) };
}

// ─── Parsing XLSX (OpenXML = ZIP + XML, sans dépendance externe) ──────────────

interface SheetRow { [key: string]: string | number | null }

async function parseXlsx(buf: Buffer): Promise<SheetRow[]> {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Le fichier XLSX ne semble pas être un ZIP valide.');
  }
  const files = await extractXlsxZipFiles(buf);

  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml'] ?? '');
  const workbookXml   = files['xl/workbook.xml'] ?? '';
  const sheetMatch    = workbookXml.match(/<sheet[^>]+r:id="(rId\d+)"[^>]*\/>/);
  const rId           = sheetMatch?.[1] ?? 'rId1';
  const relsXml       = files['xl/_rels/workbook.xml.rels'] ?? '';
  const relMatch      = new RegExp(`Id="${rId}"[^>]+Target="([^"]+)"`).exec(relsXml);
  const sheetPath     = 'xl/' + (relMatch?.[1]?.replace(/^\/xl\//, '') ?? 'worksheets/sheet1.xml');
  const sheetXml      = files[sheetPath] ?? files['xl/worksheets/sheet1.xml'] ?? '';

  if (!sheetXml) throw new Error(`Feuille introuvable dans le XLSX (cherché : ${sheetPath})`);

  const sheetNames = Object.keys(files).filter(k => k.startsWith('xl/worksheets/'));
  console.log(`  → Feuilles XLSX disponibles : ${sheetNames.join(', ')}`);

  return parseSheetXml(sheetXml, sharedStrings);
}

async function extractXlsxZipFiles(buf: Buffer): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('EOCD ZIP introuvable dans le XLSX');
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize   = buf.readUInt32LE(eocdPos + 12);
  let   pos      = cdOffset;
  while (pos + 46 <= cdOffset + cdSize) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method       = buf.readUInt16LE(pos + 10);
    const compressedSz = buf.readUInt32LE(pos + 20);
    const filenameLen  = buf.readUInt16LE(pos + 28);
    const extraLen     = buf.readUInt16LE(pos + 30);
    const commentLen   = buf.readUInt16LE(pos + 32);
    const localOffset  = buf.readUInt32LE(pos + 42);
    const filename     = buf.toString('utf8', pos + 46, pos + 46 + filenameLen);
    pos += 46 + filenameLen + extraLen + commentLen;
    if (!filename.match(/\.(xml|rels)$/i) || filename.includes('__MACOSX')) continue;
    const lfnLen     = buf.readUInt16LE(localOffset + 26);
    const lexLen     = buf.readUInt16LE(localOffset + 28);
    const dataStart  = localOffset + 30 + lfnLen + lexLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSz);
    if (method === 0) {
      files[filename] = compressed.toString('utf8');
    } else if (method === 8) {
      files[filename] = await new Promise<string>((resolve, reject) => {
        const inflate = createInflateRaw();
        const chunks: Buffer[] = [];
        inflate.on('data', (c: Buffer) => chunks.push(c));
        inflate.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
        inflate.on('error', reject);
        inflate.write(compressed);
        inflate.end();
      });
    }
  }
  return files;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const pattern = /<si>[\s\S]*?<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(xml)) !== null) {
    strings.push(m[0].replace(/<[^>]+>/g, '').trim());
  }
  return strings;
}

function parseSheetXml(xml: string, sharedStrings: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let headers: string[] = [];
  const rowPattern = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const rowXml = rowMatch[1];
    const cells: Array<{ col: number; value: string | number | null }> = [];
    const cellPattern = /<c\s[^>]*r="([A-Z]+)(\d+)"[^>]*(?:\s+t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cellPattern.exec(rowXml)) !== null) {
      const colLetters = cMatch[1];
      const cellType   = cMatch[3] ?? '';
      const cellInner  = cMatch[4];
      const colNum     = colLettersToNum(colLetters);
      const vMatch     = cellInner.match(/<v>([^<]*)<\/v>/);
      const rawVal     = vMatch?.[1] ?? null;
      let value: string | number | null = null;
      if (rawVal !== null) {
        if (cellType === 's')        value = sharedStrings[parseInt(rawVal)] ?? '';
        else if (cellType === 'str') value = rawVal;
        else { const n = parseFloat(rawVal); value = isNaN(n) ? rawVal : n; }
      }
      cells.push({ col: colNum, value });
    }
    if (cells.length === 0) continue;
    if (headers.length === 0) {
      const maxCol = Math.max(...cells.map(c => c.col));
      headers = new Array(maxCol + 1).fill('');
      // Uppercase pour matcher CODGEO / AAV2020
      for (const c of cells) headers[c.col] = String(c.value ?? '').trim().toUpperCase();
    } else {
      const row: SheetRow = {};
      for (const c of cells) { if (headers[c.col]) row[headers[c.col]] = c.value; }
      if (Object.keys(row).length > 0) rows.push(row);
    }
  }
  return rows;
}

function colLettersToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// ─── Parsing CSV ──────────────────────────────────────────────────────────────

interface AavRow {
  code_commune: string;
  aav_code:     string;
}

async function parseCsv(stream: Readable): Promise<AavRow[]> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const rows: AavRow[] = [];
  let headers: string[] = [];
  let lineCount = 0;
  let codgeoIdx = -1, aavIdx = -1;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) {
      const sep = line.includes(';') ? ';' : ',';
      headers = line.split(sep).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
      codgeoIdx = headers.findIndex(h => ['CODGEO', 'COM', 'CODE_COM', 'CODE'].includes(h));
      aavIdx    = headers.findIndex(h => ['AAV2020', 'AAV', 'CODE_AAV'].includes(h));
      if (codgeoIdx === -1 || aavIdx === -1) {
        throw new Error(`Colonnes CODGEO/AAV2020 non trouvées. Disponibles : ${headers.join(', ')}`);
      }
      console.log(`  → Colonnes : CODGEO=${headers[codgeoIdx]}, AAV=${headers[aavIdx]}`);
      continue;
    }

    const sep = line.includes(';') ? ';' : ',';
    const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length <= Math.max(codgeoIdx, aavIdx)) continue;

    const codgeo = cols[codgeoIdx];
    const aav    = cols[aavIdx];

    if (codgeo.length !== 5) continue;
    if (!aav || aav === 'n/a' || aav === 'NA' || aav === '') continue;

    const aavCode = aav.length < 3 ? aav.padStart(3, '0') : aav;
    rows.push({ code_commune: codgeo, aav_code: aavCode });
  }

  console.log(`  → ${lineCount} lignes lues, ${rows.length} communes avec AAV`);
  return rows;
}

// ─── Transformation XLSX → AavRow[] ──────────────────────────────────────────

function transformXlsxRows(rawRows: SheetRow[]): AavRow[] {
  if (rawRows.length === 0) throw new Error('Aucune ligne dans le XLSX.');

  const cols = Object.keys(rawRows[0]);
  console.log(`  → Colonnes XLSX : ${cols.join(', ')}`);

  if (!cols.includes('CODGEO')) {
    throw new Error(`Colonne 'CODGEO' non trouvée. Colonnes disponibles : ${cols.join(', ')}`);
  }

  const rows: AavRow[] = [];
  for (const raw of rawRows) {
    const codgeo = String(raw['CODGEO'] ?? '').trim();
    const aav    = String(raw['AAV2020'] ?? '').trim();

    if (codgeo.length !== 5) continue;
    if (!aav || aav === 'n/a' || aav === 'NA' || aav === '') continue;

    const aavCode = aav.length < 3 ? aav.padStart(3, '0') : aav;
    rows.push({ code_commune: codgeo, aav_code: aavCode });
  }

  console.log(`  → ${rawRows.length} lignes lues, ${rows.length} communes avec AAV`);
  return rows;
}

// ─── Mise à jour en base ──────────────────────────────────────────────────────

async function updateBatch(rows: AavRow[]): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.$executeRaw`
        UPDATE immo_score.communes AS c
        SET aav_code   = t.aav_code,
            updated_at = NOW()
        FROM UNNEST(
          ${batch.map(r => r.code_commune)}::text[],
          ${batch.map(r => r.aav_code)}::text[]
        ) AS t(code_commune, aav_code)
        WHERE c.code_insee = t.code_commune
      `;
      updated += Number(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}–${i + batch.length} : ${msg}`);
    }

    if ((i / BATCH_SIZE) % 20 === 0 && i > 0) {
      process.stdout.write(`  → ${updated} communes mises à jour...\r`);
    }
  }

  return { updated, errors };
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== INSEE AAV 2020 — mapping communes → AAV ===');

  // 1. Acquisition
  console.log('\n[1/3] Acquisition...');
  const file = await acquireFile();

  // 2. Parsing (CSV ou XLSX, direct ou extrait d'un ZIP)
  console.log(`\n[2/3] Parsing (source: ${file.kind})...`);
  let rows: AavRow[];

  if (file.kind === 'zip') {
    const extracted = await extractFileFromZip(file.buf);
    if (extracted.format === 'xlsx') {
      console.log('  → XLSX dans le ZIP — parsing XML...');
      const rawRows = await parseXlsx(extracted.buffer);
      rows = transformXlsxRows(rawRows);
    } else {
      rows = await parseCsv(extracted.stream);
    }
  } else if (file.kind === 'xlsx') {
    console.log('  → Fichier XLSX direct — parsing XML...');
    const rawRows = await parseXlsx(file.buf);
    rows = transformXlsxRows(rawRows);
  } else {
    rows = await parseCsv(Readable.from(file.buf));
  }

  if (rows.length === 0) {
    console.error('  ✗ Aucune ligne valide.');
    process.exit(1);
  }

  // 3. Update
  console.log(`\n[3/3] Mise à jour de ${rows.length} communes...`);
  const { updated, errors } = await updateBatch(rows);

  const stats = await prisma.$queryRaw<[{ total: string; with_aav: string }]>`
    SELECT COUNT(*)::text AS total,
           COUNT(aav_code)::text AS with_aav
    FROM immo_score.communes
  `;
  const { total, with_aav } = stats[0];
  const pct = parseInt(total) > 0 ? ((parseInt(with_aav) / parseInt(total)) * 100).toFixed(1) : '0';

  console.log('\n=== Résultat ===');
  console.log(`  Communes mises à jour : ${updated}`);
  console.log(`  Couverture AAV        : ${with_aav} / ${total} communes (${pct}%)`);
  console.log(`  Erreurs               : ${errors.length}`);
  console.log(`  Durée                 : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    errors.slice(0, 3).forEach(e => console.error(`  - ${e}`));
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
