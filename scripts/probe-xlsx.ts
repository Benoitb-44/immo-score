#!/usr/bin/env npx tsx
/**
 * probe-xlsx.ts — Probe générique CSV/XLSX (TECH-DEBT-01 mesure 1)
 *
 * Télécharge un fichier depuis une URL (ou lit un fichier local),
 * analyse sa structure et génère un rapport markdown.
 *
 * Usage :
 *   npx tsx scripts/probe-xlsx.ts \
 *     --url=https://...                 # URL source (suit les redirections)
 *     --output=docs/probes/rapport.md   # fichier markdown de sortie (stdout si absent)
 *     --name="Nom du jeu de données"    # titre dans le rapport
 *     [--file=chemin/local.csv]         # alternative à --url
 *     [--sep=;]                         # séparateur CSV (auto-détect si absent)
 *     [--max-rows=10]                   # nb de lignes dans l'échantillon
 *     [--download-dir=data/probe]       # répertoire où sauvegarder le téléchargement
 *
 * Formats supportés : CSV, TSV, TXT (streaming)
 * XLSX/XLS : nécessite le package `xlsx` — déclenche un avertissement si absent
 */

import { createInterface } from 'readline'
import { createReadStream, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

// ─── Encoding detection ───────────────────────────────────────────────────────

function detectEncoding(filePath: string): BufferEncoding {
  const sample = readFileSync(filePath).subarray(0, 4096)
  // UTF-8 BOM
  if (sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) return 'utf8'
  // Check for Windows-1252 / Latin-1 signatures (bytes 0x80-0x9F are win1252-specific)
  let highBytes = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]
    if (b > 0x7F && b < 0xA0) return 'latin1' // Windows-1252 control range
    if (b > 0x7F) highBytes++
  }
  // Validate as UTF-8: if high bytes parse cleanly as UTF-8 sequences, it's UTF-8
  try {
    const str = new TextDecoder('utf-8', { fatal: true }).decode(sample)
    return highBytes > 0 && str.length > 0 ? 'utf8' : 'utf8'
  } catch {
    return 'latin1'
  }
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eqIdx = a.indexOf('=')
      if (eqIdx === -1) return [a.slice(2), 'true']
      return [a.slice(2, eqIdx), a.slice(eqIdx + 1)]
    })
) as Record<string, string>

const URL_ARG      = args['url']
const FILE_ARG     = args['file']
const OUTPUT_ARG   = args['output']
const SEP_FORCED   = args['sep']
const MAX_ROWS     = parseInt(args['max-rows'] || '10', 10)
const DOWNLOAD_DIR = args['download-dir'] || 'data/probe'
const NAME_ARG     = args['name']

if (!URL_ARG && !FILE_ARG) {
  console.error('Usage: npx tsx scripts/probe-xlsx.ts --url=URL [--output=path.md] [--name="..."]')
  console.error('       npx tsx scripts/probe-xlsx.ts --file=path.csv  [--output=path.md]')
  process.exit(1)
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function downloadFile(url: string, destDir: string): Promise<{ path: string; sizeBytes: number; finalUrl: string }> {
  console.log(`[probe] Téléchargement : ${url}`)

  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'CityRank-DataProbe/1.0 (+https://cityrank.fr)' },
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)

  const finalUrl = res.url || url
  const urlPath  = new URL(finalUrl).pathname
  const filename = decodeURIComponent(urlPath.split('/').pop() || 'probe-download.csv')

  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, filename)

  const buffer = await res.arrayBuffer()
  writeFileSync(destPath, Buffer.from(buffer))
  console.log(`[probe] Fichier sauvegardé : ${destPath} (${formatSize(buffer.byteLength)})`)

  return { path: destPath, sizeBytes: buffer.byteLength, finalUrl }
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function detectSeparator(header: string): string {
  if (SEP_FORCED) return SEP_FORCED
  const counts: Record<string, number> = {
    ';': (header.match(/;/g)  ?? []).length,
    ',': (header.match(/,/g)  ?? []).length,
    '\t': (header.match(/\t/g) ?? []).length,
    '|': (header.match(/\|/g) ?? []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

function parseLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === sep && !inQ) { out.push(cur); cur = '' }
    else { cur += ch }
  }
  out.push(cur)
  return out.map(v => v.replace(/^"|"$/g, '').trim())
}

// ─── Probe result ─────────────────────────────────────────────────────────────

interface ProbeResult {
  filename:            string
  sourceUrl:           string
  finalUrl:            string
  fileSize:            number
  format:              string
  encoding:            string
  separator:           string
  totalDataLines:      number
  headers:             string[]
  sampleRows:          string[][]
  codeInseeColumn:     string | null
  uniqueCommunes:      number
  columnStats:         Record<string, { nullCount: number; uniqueSample: string[] }>
}

const INSEE_CANDIDATES = ['INSEE_C', 'code_insee', 'CODGEO', 'cod_com', 'depcom', 'COM', 'insee', 'code_commune', 'inseecom', 'code_com']

async function probeCsv(filePath: string, sourceUrl: string, finalUrl: string, fileSize: number): Promise<ProbeResult> {
  const detectedEncoding = detectEncoding(filePath)
  console.log(`[probe] Encodage détecté : ${detectedEncoding}`)

  return new Promise((resolve, reject) => {
    let lineCount = 0
    let headers: string[] = []
    let sep = ','
    const sample: string[][] = []
    let codeInseeColumn: string | null = null
    let codeInseeIdx = -1
    const codeInseeSet = new Set<string>()
    const colStats: Record<string, { nulls: number; sample: Set<string> }> = {}

    const rl = createInterface({ input: createReadStream(filePath, { encoding: detectedEncoding }), crlfDelay: Infinity })

    rl.on('line', line => {
      lineCount++

      if (lineCount === 1) {
        sep = detectSeparator(line)
        headers = parseLine(line, sep)

        // Detect code INSEE column
        for (const cand of INSEE_CANDIDATES) {
          const idx = headers.findIndex(h => h.toLowerCase() === cand.toLowerCase())
          if (idx !== -1) { codeInseeColumn = headers[idx]; codeInseeIdx = idx; break }
        }

        // Init column stats (first 5 cols + last col + code INSEE)
        const statCols = [...new Set([
          ...headers.slice(0, 5),
          headers[headers.length - 1],
          ...(codeInseeColumn ? [codeInseeColumn] : []),
        ])]
        for (const col of statCols) colStats[col] = { nulls: 0, sample: new Set() }
        return
      }

      const row = parseLine(line, sep)

      // Collect sample rows
      if (sample.length < MAX_ROWS) sample.push(row)

      // Code INSEE unique count
      if (codeInseeIdx >= 0 && row[codeInseeIdx]) codeInseeSet.add(row[codeInseeIdx])

      // Column stats
      headers.forEach((col, i) => {
        if (!colStats[col]) return
        const val = row[i] ?? ''
        if (!val || val === 'null' || val === 'NULL') colStats[col].nulls++
        else if (colStats[col].sample.size < 5) colStats[col].sample.add(val)
      })
    })

    rl.on('close', () => {
      const columnStats: Record<string, { nullCount: number; uniqueSample: string[] }> = {}
      for (const [col, s] of Object.entries(colStats)) {
        columnStats[col] = { nullCount: s.nulls, uniqueSample: [...s.sample] }
      }

      resolve({
        filename:        filePath.split('/').pop()!,
        sourceUrl,
        finalUrl,
        fileSize,
        format:          'CSV',
        encoding:        detectedEncoding === 'latin1' ? 'Latin-1/Windows-1252' : 'UTF-8',
        separator:       sep === '\t' ? 'tabulation (\\t)' : sep === ';' ? 'point-virgule (;)' : `virgule (,)`,
        totalDataLines:  lineCount - 1,
        headers,
        sampleRows:      sample,
        codeInseeColumn,
        uniqueCommunes:  codeInseeSet.size,
        columnStats,
      })
    })

    rl.on('error', reject)
  })
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function formatSize(b: number): string {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} Mo`
  if (b > 1_000)     return `${(b / 1_000).toFixed(0)} Ko`
  return `${b} o`
}

function toMd(result: ProbeResult, probeName: string): string {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const headerRows = result.headers.map((h, i) => `| ${i + 1} | \`${h}\` |`).join('\n')

  const sampleHeader = '| ' + result.headers.join(' | ') + ' |'
  const sampleSep    = '| ' + result.headers.map(() => '---').join(' | ') + ' |'
  const sampleData   = result.sampleRows.map(r => '| ' + r.map(v => v.replace(/\|/g, '\\|')).join(' | ') + ' |').join('\n')
  const sampleTable  = [sampleHeader, sampleSep, sampleData].join('\n')

  const statsRows = Object.entries(result.columnStats).map(([col, s]) =>
    `| \`${col}\` | ${s.nullCount} | \`${s.uniqueSample.slice(0, 3).join('`, `') || '—'}\` |`
  ).join('\n')

  return `# Probe : ${probeName}

> Généré le ${ts} par \`scripts/probe-xlsx.ts\`

## Source

| Champ | Valeur |
|-------|--------|
| URL appelée | \`${result.sourceUrl}\` |
| URL finale (après redirect) | \`${result.finalUrl}\` |
| Fichier local | \`${result.filename}\` |

## Méta-fichier

| Métadonnée | Valeur |
|-----------|--------|
| Format | ${result.format} |
| Taille | ${formatSize(result.fileSize)} |
| Encodage | ${result.encoding} |
| Séparateur CSV | ${result.separator} |
| Nb lignes (hors en-tête) | **${result.totalDataLines.toLocaleString('fr-FR')}** |
| Nb colonnes | **${result.headers.length}** |
| Colonne code INSEE détectée | \`${result.codeInseeColumn ?? 'non trouvée — voir pièges'}\` |
| Communes uniques (code INSEE) | **${result.uniqueCommunes.toLocaleString('fr-FR')}** |

## En-têtes (${result.headers.length} colonnes)

| # | Nom de colonne |
|---|----------------|
${headerRows}

## Échantillon (${result.sampleRows.length} premières lignes)

${sampleTable}

## Stats colonnes clés (nulls + échantillon valeurs)

| Colonne | Nb nulls | Exemple valeurs |
|---------|----------|-----------------|
${statsRows}

## Colonnes cibles pour l'ingestion

> À compléter manuellement après analyse

| Colonne source | Rôle | Type Prisma cible | Notes |
|----------------|------|-------------------|-------|
| *(à identifier)* | code commune | \`String\` | 5 chars INSEE |
| *(à identifier)* | valeur principale | \`Float?\` | |

## Pièges identifiés

> À compléter après analyse

- [ ] *(à documenter)*

## Prochaine étape

Rédiger la spec d'ingestion en session suivante.
`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let filePath: string
  let fileSize: number
  let sourceUrl = URL_ARG || FILE_ARG || ''
  let finalUrl  = sourceUrl

  if (URL_ARG) {
    const dl = await downloadFile(URL_ARG, DOWNLOAD_DIR)
    filePath  = dl.path
    fileSize  = dl.sizeBytes
    finalUrl  = dl.finalUrl
  } else {
    filePath = FILE_ARG!
    if (!existsSync(filePath)) { console.error(`Fichier introuvable : ${filePath}`); process.exit(1) }
    fileSize = statSync(filePath).size
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls'].includes(ext)) {
    console.warn(`[probe] ⚠ Format XLSX/XLS détecté. Ce script ne supporte que CSV.`)
    console.warn(`[probe]   → Installer le package 'xlsx' et étendre ce script pour le support Excel.`)
    console.warn(`[probe]   → Pour l'instant, tentative de lecture comme CSV (peut échouer).`)
  }

  console.log('[probe] Analyse en cours...')
  const result = await probeCsv(filePath, sourceUrl, finalUrl, fileSize)

  const probeName = NAME_ARG || result.filename

  if (OUTPUT_ARG) {
    const dir = dirname(OUTPUT_ARG)
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(OUTPUT_ARG, toMd(result, probeName), 'utf8')
    console.log(`[probe] Rapport : ${OUTPUT_ARG}`)
  } else {
    process.stdout.write(toMd(result, probeName) + '\n')
  }

  console.log('\n=== Résumé probe ===')
  console.log(`Fichier  : ${result.filename} (${formatSize(result.fileSize)})`)
  console.log(`Format   : ${result.format}, sep=${result.separator}`)
  console.log(`Lignes   : ${result.totalDataLines.toLocaleString('fr-FR')} (hors en-tête)`)
  console.log(`Colonnes : ${result.headers.length} — [${result.headers.join(', ')}]`)
  if (result.codeInseeColumn) {
    console.log(`INSEE    : colonne="${result.codeInseeColumn}", communes uniques=${result.uniqueCommunes.toLocaleString('fr-FR')}`)
  } else {
    console.log(`INSEE    : colonne non détectée automatiquement`)
  }
}

main().catch(e => {
  console.error('[probe] ERREUR :', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
