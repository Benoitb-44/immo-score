/**
 * ingest-cerema-accessibilite.ts — Sprint 4-A patch
 *
 * Ingestion des données Cerema DV3F d'accessibilité financière par commune.
 *
 * Source : fichier local déposé manuellement (Box Cerema bloque les bots).
 * Fichier : dv3f_accessibilite_aav_2022_2024.xlsx
 * Millésime : 2022-2024
 *
 * Colonnes XLSX attendues (doc Cerema officiel) :
 *   insee_com, libgeo, aav, libaav,
 *   pxmed_appartement, pxmed_maison,
 *   d3, d5, d7,
 *   d3_appartement, d5_appartement, d7_appartement,
 *   d3_maison, d5_maison, d7_maison
 *
 * Stockage : table cerema_accessibilite (commune_id = clé unique)
 *   aav_code, commune_id, d3_appart, d5_appart, d7_appart,
 *   d3_maison, d5_maison, d7_maison, year=2024, source='cerema-2022-2024'
 *
 * Variable d'environnement :
 *   CEREMA_XLSX_PATH=/chemin/vers/fichier.xlsx
 *   (défaut : /app/data/cerema/current/dv3f_accessibilite_aav_2022_2024.xlsx)
 *
 * Usage :
 *   npm run ingest:cerema
 *   CEREMA_XLSX_PATH=/tmp/cerema.xlsx npm run ingest:cerema
 *
 * Exclusions : communes des depts 57/67/68 (Alsace-Moselle) et 976 (Mayotte)
 * — données non couvertes par le périmètre Cerema DV3F France métropolitaine.
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';

const prisma = new PrismaClient();

const XLSX_PATH = process.env['CEREMA_XLSX_PATH']
  ?? '/app/data/cerema/current/dv3f_accessibilite_aav_2022_2024.xlsx';

const BATCH_SIZE  = 200;
const ANNEE_CIBLE = 2024;
const SOURCE      = 'cerema-2022-2024';

// Départements exclus du périmètre Cerema DV3F
const EXCLUDED_DEPT_PREFIXES = ['57', '67', '68', '976'];

function isExcluded(inseeCode: string): boolean {
  return EXCLUDED_DEPT_PREFIXES.some(p => inseeCode.startsWith(p));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeremaRow {
  commune_id: string;   // insee_com
  aav_code:   string | null;
  d3_appart:  number | null;
  d5_appart:  number | null;
  d7_appart:  number | null;
  d3_maison:  number | null;
  d5_maison:  number | null;
  d7_maison:  number | null;
}

// ─── Acquisition ─────────────────────────────────────────────────────────────

function acquireFile(): Buffer {
  if (!existsSync(XLSX_PATH)) {
    throw new Error(
      `Fichier Cerema introuvable : ${XLSX_PATH}\n` +
      `Déposer le fichier sur le VPS dans ~/cityrank/data/cerema/current/\n` +
      `puis relancer : npm run ingest:cerema\n` +
      `Ou surcharger le chemin : CEREMA_XLSX_PATH=/chemin/vers/fichier.xlsx npm run ingest:cerema`,
    );
  }
  const buf = readFileSync(XLSX_PATH);
  console.log(`  → Fichier local : ${XLSX_PATH} (${(buf.length / 1024).toFixed(0)} KB)`);
  return buf;
}

// ─── Parsing XLSX (OpenXML = ZIP + XML, sans dépendance externe) ──────────────

interface SheetRow { [key: string]: string | number | null }

async function parseXlsx(buf: Buffer): Promise<SheetRow[]> {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Le fichier ne semble pas être un XLSX valide (magic bytes ZIP attendus).');
  }
  const files = await extractZipFiles(buf);

  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml'] ?? '');
  const workbookXml   = files['xl/workbook.xml'] ?? '';
  const relsXml       = files['xl/_rels/workbook.xml.rels'] ?? '';

  // Construire la map rId → chemin de feuille
  const relsMap: Record<string, string> = {};
  const relsPattern = /Id="(rId\d+)"[^>]+Target="([^"]+)"/g;
  let relM: RegExpExecArray | null;
  while ((relM = relsPattern.exec(relsXml)) !== null) relsMap[relM[1]] = relM[2];

  // Lister toutes les feuilles dans l'ordre du workbook
  const sheets: Array<{ rId: string; name: string }> = [];
  const sheetPattern = /<sheet\s[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g;
  let sM: RegExpExecArray | null;
  while ((sM = sheetPattern.exec(workbookXml)) !== null) sheets.push({ name: sM[1], rId: sM[2] });
  if (sheets.length === 0) sheets.push({ rId: 'rId1', name: 'sheet1' });

  console.log(`  → Feuilles XLSX : ${sheets.map(s => `"${s.name}"`).join(', ')}`);

  // Noms de colonnes connus pour les fichiers Cerema (en majuscule pour la comparaison)
  // Le fichier 2022-2024 utilise 'codgeo', les versions antérieures 'insee_com'
  const CEREMA_HINTS = ['CODGEO', 'INSEE_COM', 'CODE_INSEE', 'CODE_COM', 'COMMUNE'];

  for (const { rId, name } of sheets) {
    const target   = relsMap[rId] ?? '';
    const path     = 'xl/' + target.replace(/^\/xl\//, '');
    const sheetXml = files[path] ?? files['xl/worksheets/sheet1.xml'] ?? '';
    if (!sheetXml) continue;

    // 1er essai : avec hints pour sauter les lignes de titre
    let rows = parseSheetXml(sheetXml, sharedStrings, CEREMA_HINTS);

    if (rows.length === 0) {
      // Hint non trouvé — parse sans hint pour voir les colonnes réelles
      const rowsRaw = parseSheetXml(sheetXml, sharedStrings);
      const sample  = Object.keys(rowsRaw[0] ?? {}).slice(0, 10).join(', ');
      console.log(`  → Feuille "${name}" : hint absent. Colonnes brutes (1ère ligne) : ${sample || '(vide)'}`);
      // Réessayer sans hint — si 1ère ligne = headers réels
      if (rowsRaw.length > 0) rows = rowsRaw;
      else continue;
    }

    const keys = Object.keys(rows[0] ?? {});
    // Chercher la clé qui ressemble à un code INSEE (insensible à la casse)
    const inseeKey = keys.find(k => ['insee_com', 'code_insee', 'codgeo', 'code_com', 'commune'].includes(k));
    if (!inseeKey) {
      console.log(`  → Feuille "${name}" ignorée (colonnes: ${keys.slice(0, 8).join(', ')}…)`);
      continue;
    }

    if (inseeKey !== 'insee_com') {
      console.log(`  → Colonne INSEE trouvée sous le nom "${inseeKey}" — renommage vers "insee_com"`);
      rows = rows.map(r => { const n = { ...r }; n['insee_com'] = n[inseeKey]; delete n[inseeKey]; return n; });
    }

    console.log(`  → Feuille sélectionnée : "${name}" (${rows.length} lignes, clé: "${inseeKey}")`);
    return rows;
  }

  throw new Error('Aucune feuille ne contient de colonne commune INSEE dans le XLSX');
}

async function extractZipFiles(buf: Buffer): Promise<Record<string, string>> {
  const { createInflateRaw } = await import('zlib');
  const files: Record<string, string> = {};
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error('EOCD ZIP introuvable');
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
    const lfnLen    = buf.readUInt16LE(localOffset + 26);
    const lexLen    = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lfnLen + lexLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSz);
    if (method === 0) {
      files[filename] = compressed.toString('utf8');
    } else if (method === 8) {
      files[filename] = await new Promise((resolve, reject) => {
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

// headerHints : liste de noms de colonnes attendus (en MAJUSCULE) — ignore les
// lignes de titre INSEE jusqu'à trouver la vraie ligne d'en-têtes.
function parseSheetXml(xml: string, sharedStrings: string[], headerHints?: string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  let headers: string[] = [];
  const rowPattern = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const rowXml = rowMatch[1];
    const cells: Array<{ col: number; value: string | number | null }> = [];
    // Capture tous les attributs du tag <c> d'un coup — évite le [^>]* greedy
    // qui consomme t="s" avant que le groupe optionnel puisse le capturer.
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cellPattern.exec(rowXml)) !== null) {
      const attrs      = cMatch[1];
      const inner      = cMatch[2];
      const rAttr      = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!rAttr) continue;
      const colLetters = rAttr.replace(/\d+$/, '');
      const cellType   = attrs.match(/\bt="([^"]*)"/)?.[1] ?? '';
      const colNum     = colLettersToNum(colLetters);
      // Cerema utilise t="inlineStr" avec <is><t>...</t></is> au lieu de <v>
      const vMatch   = inner.match(/<v>([^<]*)<\/v>/);
      const isMatch  = inner.match(/<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/);
      const rawVal   = vMatch?.[1] ?? (cellType === 'inlineStr' ? (isMatch?.[1] ?? null) : null);
      let value: string | number | null = null;
      if (rawVal !== null) {
        if (cellType === 's')                              value = sharedStrings[parseInt(rawVal)] ?? '';
        else if (cellType === 'str' || cellType === 'inlineStr') value = rawVal;
        else { const n = parseFloat(rawVal); value = isNaN(n) ? rawVal : n; }
      }
      cells.push({ col: colNum, value });
    }
    if (cells.length === 0) continue;

    if (headers.length === 0) {
      const cellValuesUpper = cells.map(c => String(c.value ?? '').trim().toUpperCase());
      if (headerHints && !headerHints.some(h => cellValuesUpper.includes(h))) continue;
      const maxCol = Math.max(...cells.map(c => c.col));
      headers = new Array(maxCol + 1).fill('');
      // Cerema : headers en minuscule (transformRows attend 'insee_com', 'd3_appartement'…)
      for (const c of cells) headers[c.col] = String(c.value ?? '').trim().toLowerCase();
      continue;
    }

    const row: SheetRow = {};
    for (const c of cells) { if (headers[c.col]) row[headers[c.col]] = c.value; }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

function colLettersToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// ─── Transformation ───────────────────────────────────────────────────────────

function toNum(val: string | number | null | undefined): number | null {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
  return isNaN(n) || n <= 0 ? null : Math.round(n * 100) / 100;
}

function toString(val: string | number | null | undefined): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

function transformRows(rawRows: SheetRow[]): {
  rows: CeremaRow[];
  nbExclus: number;
  nbHorsAav: number;
} {
  if (rawRows.length === 0) throw new Error('Aucune ligne dans le fichier Excel.');

  // Vérification colonnes attendues (noms lowercase)
  const sample = rawRows[0];
  const cols   = Object.keys(sample);
  if (!cols.includes('insee_com')) {
    throw new Error(
      `Colonne 'insee_com' non trouvée. Colonnes disponibles : ${cols.join(', ')}\n` +
      `Vérifier que le bon fichier Cerema 2022-2024 est utilisé.`,
    );
  }

  const rows: CeremaRow[] = [];
  let nbExclus  = 0;
  let nbHorsAav = 0;

  for (const row of rawRows) {
    const inseeRaw = toString(row['insee_com']);
    if (!inseeRaw) continue;

    // Normalisation : 5 caractères (certaines communes DOM ont 6)
    const insee = inseeRaw.length === 4 ? '0' + inseeRaw : inseeRaw;

    if (isExcluded(insee)) { nbExclus++; continue; }

    // Cerema 2022-2024 : 'aav2020' (anciens fichiers : 'aav')
    const aavRaw = toString(row['aav2020'] ?? row['aav']);
    if (!aavRaw) nbHorsAav++;

    rows.push({
      commune_id: insee,
      aav_code:   aavRaw,
      // cod111 = maisons individuelles, cod121 = appartements collectifs (DV3F Cerema)
      // Anciens fichiers : 'd3_maison'/'d3_appartement' — fichier 2022-2024 : 'd3_cod111'/'d3_cod121'
      d3_appart:  toNum(row['d3_cod121'] ?? row['d3_appartement']),
      d5_appart:  toNum(row['d5_cod121'] ?? row['d5_appartement']),
      d7_appart:  toNum(row['d7_cod121'] ?? row['d7_appartement']),
      d3_maison:  toNum(row['d3_cod111'] ?? row['d3_maison']),
      d5_maison:  toNum(row['d5_cod111'] ?? row['d5_maison']),
      d7_maison:  toNum(row['d7_cod111'] ?? row['d7_maison']),
    });
  }

  return { rows, nbExclus, nbHorsAav };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

async function upsertBatch(rows: CeremaRow[]): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await prisma.$executeRaw`
        INSERT INTO immo_score.cerema_accessibilite
          (id, commune_id, aav_code,
           d3_appart, d5_appart, d7_appart,
           d3_maison, d5_maison, d7_maison,
           annee, source, updated_at)
        SELECT
          gen_random_uuid()::text,
          t.commune_id, t.aav_code,
          t.d3_appart, t.d5_appart, t.d7_appart,
          t.d3_maison, t.d5_maison, t.d7_maison,
          ${ANNEE_CIBLE}::int, ${SOURCE}::text, NOW()
        FROM UNNEST(
          ${batch.map(r => r.commune_id)}::text[],
          ${batch.map(r => r.aav_code)}::text[],
          ${batch.map(r => r.d3_appart)}::float8[],
          ${batch.map(r => r.d5_appart)}::float8[],
          ${batch.map(r => r.d7_appart)}::float8[],
          ${batch.map(r => r.d3_maison)}::float8[],
          ${batch.map(r => r.d5_maison)}::float8[],
          ${batch.map(r => r.d7_maison)}::float8[]
        ) AS t(commune_id, aav_code, d3_appart, d5_appart, d7_appart, d3_maison, d5_maison, d7_maison)
        ON CONFLICT (commune_id) DO UPDATE
          SET aav_code   = EXCLUDED.aav_code,
              d3_appart  = EXCLUDED.d3_appart,
              d5_appart  = EXCLUDED.d5_appart,
              d7_appart  = EXCLUDED.d7_appart,
              d3_maison  = EXCLUDED.d3_maison,
              d5_maison  = EXCLUDED.d5_maison,
              d7_maison  = EXCLUDED.d7_maison,
              annee      = EXCLUDED.annee,
              source     = EXCLUDED.source,
              updated_at = NOW()
      `;
      updated += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Batch ${i}–${i + batch.length} : ${msg}`);
    }
  }

  return { updated, errors };
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('=== Cerema DV3F Accessibilité — ingestion (2022-2024) ===');
  console.log(`  Fichier : ${XLSX_PATH}`);

  // 1. Acquisition (local uniquement — Box Cerema bloque les bots)
  console.log('\n[1/3] Lecture du fichier XLSX...');
  const buf = acquireFile();

  // 2. Parsing
  console.log('\n[2/3] Parsing XLSX...');
  const rawRows = await parseXlsx(buf);
  console.log(`  → ${rawRows.length} lignes brutes lues`);

  const { rows, nbExclus, nbHorsAav } = transformRows(rawRows);
  console.log(`  → Communes ingérées : ${rows.length}`);
  console.log(`  → Exclues (57/67/68/976) : ${nbExclus}`);
  console.log(`  → Hors AAV (sans code AAV) : ${nbHorsAav}`);

  if (rows.length === 0) {
    console.error('  ✗ Aucune ligne valide. Vérifier le format du fichier.');
    process.exit(1);
  }

  // 3. Upsert
  console.log(`\n[3/3] Upsert de ${rows.length} communes...`);
  const { updated, errors } = await upsertBatch(rows);

  const total = await prisma.$queryRaw<[{ cnt: string }]>`
    SELECT COUNT(*)::text AS cnt FROM immo_score.cerema_accessibilite
  `;

  console.log('\n=== Résultat ===');
  console.log(`  Communes upsertées : ${updated}`);
  console.log(`  Total en base      : ${total[0].cnt}`);
  console.log(`  Erreurs            : ${errors.length}`);
  console.log(`  Durée              : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (errors.length > 0) {
    console.error('\n  Détail erreurs (3 premiers) :');
    errors.slice(0, 3).forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

main()
  .catch(err => { console.error('ERREUR FATALE :', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
