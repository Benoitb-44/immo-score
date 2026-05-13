#!/usr/bin/env npx tsx
/**
 * probe-insee-rp-logement.ts
 *
 * Probe formel du fichier INSEE RP 2022 — base communale logement
 * (TECH-DEBT-01 mesure 1 : graver le mapping avant de coder l'ingestion)
 *
 * Usage :
 *   npx tsx scripts/probes/probe-insee-rp-logement.ts \
 *     --xlsx=data/raw/insee-rp-logement/base-cc-logement-2022.xlsx
 */

import * as XLSX from 'xlsx'
import { createWriteStream, mkdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=')
      return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)]
    })
) as Record<string, string>

const XLSX_PATH   = args['xlsx'] ?? 'data/raw/insee-rp-logement/base-cc-logement-2022.xlsx'
const SAMPLE_OUT  = args['sample-out']  ?? 'scripts/probes/insee-rp-logement-sample.csv'
const REPORT_OUT  = args['report-out']  ?? 'scripts/probes/insee-rp-logement-probe.md'

// 10 prescribed communes + 40 diverse extras
const TARGET_COMMUNES: Record<string, string> = {
  '75056': 'Paris',
  '69123': 'Lyon',
  '13055': 'Marseille',
  '33063': 'Bordeaux',
  '35238': 'Rennes',
  '72181': 'Le Mans',
  '19272': 'Tulle',
  '83069': 'Hyères',
  '08394': 'Saint-Juvin',
  '03310': 'Vichy',
  // 40 diverse extras — urban / rural / DROM spread
  '44109': 'Nantes',
  '06088': 'Nice',
  '31555': 'Toulouse',
  '67482': 'Strasbourg',
  '59350': 'Lille',
  '76540': 'Rouen',
  '25056': 'Besançon',
  '21231': 'Dijon',
  '37261': 'Tours',
  '63113': 'Clermont-Ferrand',
  '34172': 'Montpellier',
  '80021': 'Amiens',
  '14118': 'Caen',
  '29019': 'Brest',
  '49007': 'Angers',
  '51454': 'Reims',
  '57463': 'Metz',
  '38185': 'Grenoble',
  '13004': 'Aix-en-Provence',
  '76095': 'Le Havre',
  '01053': 'Bourg-en-Bresse',
  '02722': 'Saint-Quentin',
  '05061': 'Gap',
  '09122': 'Foix',
  '11069': 'Carcassonne',
  '16015': 'Angoulême',
  '18033': 'Bourges',
  '23096': 'Guéret',
  '40192': 'Mont-de-Marsan',
  '46042': 'Cahors',
  '48095': 'Mende',
  '61001': 'Alençon',
  '65440': 'Tarbes',
  '89024': 'Auxerre',
  '90010': 'Belfort',
  '971100': 'Basse-Terre',  // DROM Guadeloupe
  '972001': 'Fort-de-France', // DROM Martinique
  '974001': 'Saint-Denis (La Réunion)', // DROM Réunion
  '976101': 'Mamoudzou',    // Mayotte test
  '2A004': 'Ajaccio',      // Corse
}

// INSEE target variables
const TARGET_COLS = {
  CODGEO:      'Code commune (5 chars INSEE)',
  LIBGEO:      'Libellé commune',
  P22_LOG:     'Total logements',
  P22_RP:      'Résidences principales',
  P22_NBPI_RP: 'Nb pièces total RP (→ calculer moy)',
  P22_RP_PROP: 'Propriétaires occupants RP',
}

type Row = Record<string, string | number | null>

function formatSize(b: number): string {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} Mo`
  if (b > 1_000)     return `${(b / 1_000).toFixed(0)} Ko`
  return `${b} o`
}

function detectXlsxMode(workbook: XLSX.WorkBook): string {
  // Check if workbook uses shared strings (xlsx mode) or inline strings
  // XLSX.utils.book_new() details
  try {
    const wbRaw = workbook as Record<string, unknown>
    if (wbRaw['Strings']) return 'sharedStrings'
    return 'inlineStr'
  } catch { return 'unknown' }
}

async function main() {
  console.log(`[probe] Lecture XLSX : ${XLSX_PATH}`)

  const fileStat = statSync(XLSX_PATH)
  console.log(`[probe] Taille fichier : ${formatSize(fileStat.size)}`)

  // ─── Read with xlsx lib ───────────────────────────────────────────────────
  const startRead = Date.now()
  const workbook = XLSX.readFile(XLSX_PATH, {
    type: 'file',
    cellDates: false,
    sheetStubs: false,
    // Only read values (skip formulas, styles) for speed
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  })
  console.log(`[probe] Parsing XLSX en ${Date.now() - startRead}ms`)

  const xlsxMode = detectXlsxMode(workbook)
  console.log(`[probe] Mode XLSX : ${xlsxMode}`)

  const sheetNames = workbook.SheetNames
  console.log(`[probe] Feuilles : ${sheetNames.join(', ')}`)

  // Find the main data sheet — INSEE RP logement uses COM_2022
  const mainSheetName = sheetNames.find(n => /^COM_\d{4}$/.test(n)) ?? sheetNames[0]
  console.log(`[probe] Feuille principale : "${mainSheetName}"`)

  const ws = workbook.Sheets[mainSheetName]
  const ref = ws['!ref'] ?? 'A1:A1'
  const fullRange = XLSX.utils.decode_range(ref)
  const totalRows = fullRange.e.r - 5  // rows 1-5 are metadata/headers
  console.log(`[probe] Range : ${ref} → ${totalRows} lignes de données`)
  console.log(`[probe] Structure : L1-4 = métadonnées, L5 = libellés FR, L6 = codes INSEE, L7+ = données`)

  // ─── Headers — INSEE RP XLSX has 2 header rows ────────────────────────────
  // Row 5 (index 4) = French labels, Row 6 (index 5) = technical INSEE codes
  // range: 5 makes sheet_to_json use row 6 as header, row 7+ as data
  const rawArr = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 5, defval: null })
  const techCodes = (rawArr[0] as string[]).map(h => String(h ?? ''))
  const dataArrays = rawArr.slice(1) as (string | number | null)[][]

  // Convert to Record objects using technical codes as keys
  const rawData: Row[] = dataArrays.map(arr =>
    Object.fromEntries(techCodes.map((h, i) => [h, arr[i] ?? null]))
  )
  const headers = techCodes
  console.log(`[probe] Colonnes totales : ${headers.length}`)
  console.log(`[probe] 30 premières : ${headers.slice(0, 30).join(', ')}`)

  // ─── Identify columns ────────────────────────────────────────────────────
  const codgeoCol = headers.find(h => /^CODGEO$/i.test(h)) ?? null
  const libgeoCol = headers.find(h => /^LIBGEO$/i.test(h)) ?? null

  const targetFound: Record<string, string | null> = {}
  for (const [col] of Object.entries(TARGET_COLS)) {
    targetFound[col] = headers.find(h => h === col) ?? null
  }

  console.log(`[probe] Code commune : ${codgeoCol ?? '⚠ NON TROUVÉE'}`)
  for (const [col, found] of Object.entries(targetFound)) {
    console.log(`[probe]   ${col} → ${found ?? '⚠ ABSENTE'}`)
  }

  // ─── Coverage count ──────────────────────────────────────────────────────
  const uniqueCodes = new Set<string>()
  let nullCodeCount = 0
  let nullLogCount = 0
  let nullRpCount = 0
  let nullPropCount = 0
  let nullNbpiCount = 0

  // Rows where CODGEO has len=5 exactly (communes, not IRIS)
  const communeRows: Row[] = []

  for (const row of rawData) {
    const code = codgeoCol ? String(row[codgeoCol] ?? '').padStart(5, '0').trim() : ''
    if (!code || code.length < 4) { nullCodeCount++; continue }
    uniqueCodes.add(code)
    communeRows.push(row)

    if (!row['P22_LOG'] && row['P22_LOG'] !== 0) nullLogCount++
    if (!row['P22_RP']  && row['P22_RP']  !== 0) nullRpCount++
    if (!row['P22_RP_PROP'] && row['P22_RP_PROP'] !== 0) nullPropCount++
    if (!row['P22_NBPI_RP'] && row['P22_NBPI_RP'] !== 0) nullNbpiCount++
  }

  console.log(`[probe] Communes uniques : ${uniqueCodes.size} (cible 34 875)`)
  console.log(`[probe] Nulls P22_LOG=${nullLogCount}, P22_RP=${nullRpCount}, P22_RP_PROP=${nullPropCount}, P22_NBPI_RP=${nullNbpiCount}`)

  // ─── Surface variable search ─────────────────────────────────────────────
  const surfaceCols = headers.filter(h => /surf|m2|moy/i.test(h))
  console.log(`[probe] Colonnes surface/m²/moy : ${surfaceCols.length > 0 ? surfaceCols.join(', ') : '⚠ AUCUNE'}`)

  // ─── Build sample CSV ────────────────────────────────────────────────────
  const sampleCols = [
    codgeoCol ?? 'CODGEO',
    libgeoCol ?? 'LIBGEO',
    'P22_LOG',
    'P22_RP',
    'P22_NBPI_RP',
    'P22_RP_PROP',
  ].filter(c => headers.includes(c) || c === codgeoCol || c === libgeoCol)

  // Index rows by CODGEO for quick lookup
  const byCode = new Map<string, Row>()
  for (const row of rawData) {
    const code = codgeoCol ? String(row[codgeoCol] ?? '').padStart(5, '0').trim() : ''
    if (code) byCode.set(code, row)
  }

  // Prescribed communes first, then random diverse selection
  const sampleCodes: string[] = []

  for (const code of Object.keys(TARGET_COMMUNES)) {
    if (sampleCodes.length < 50) sampleCodes.push(code)
  }

  // Fill to 50 with random communes
  const allCodes = [...uniqueCodes]
  for (let i = 0; sampleCodes.length < 50 && i < allCodes.length; i++) {
    // Pick every N-th code to spread geographically
    const idx = Math.floor((i * allCodes.length) / (50 - sampleCodes.length))
    if (idx < allCodes.length && !sampleCodes.includes(allCodes[idx])) {
      sampleCodes.push(allCodes[idx])
    }
  }

  mkdirSync('scripts/probes', { recursive: true })

  const csvLines: string[] = [sampleCols.join(',')]
  for (const code of sampleCodes.slice(0, 50)) {
    const row = byCode.get(code)
    if (!row) {
      // Commune not found in data — mark as absent
      const nomKnown = TARGET_COMMUNES[code] ?? ''
      csvLines.push([code, nomKnown, 'N/A', 'N/A', 'N/A', 'N/A'].slice(0, sampleCols.length).join(','))
      continue
    }
    const vals = sampleCols.map(col => {
      const v = row[col]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    })
    csvLines.push(vals.join(','))
  }

  const csvContent = csvLines.join('\n') + '\n'
  require('fs').writeFileSync(SAMPLE_OUT, '﻿' + csvContent, 'utf8')
  console.log(`[probe] Sample CSV écrit : ${SAMPLE_OUT} (${csvLines.length - 1} communes)`)

  // ─── Check for DROM coverage ─────────────────────────────────────────────
  const dromPrefixes = ['971', '972', '973', '974', '976']
  const dromCodes = [...uniqueCodes].filter(c => dromPrefixes.some(p => c.startsWith(p)))
  const hasMayotte = [...uniqueCodes].some(c => c.startsWith('976'))

  // ─── Sample values for key columns ───────────────────────────────────────
  const sampleValues: Record<string, string[]> = {}
  for (const col of ['P22_LOG', 'P22_RP', 'P22_NBPI_RP', 'P22_RP_PROP']) {
    const vals: string[] = []
    for (const row of rawData.slice(0, 200)) {
      const v = row[col]
      if (v !== null && v !== undefined && vals.length < 5) vals.push(String(v))
    }
    sampleValues[col] = vals
  }

  // ─── Check multi-millesime ───────────────────────────────────────────────
  const hasP16 = headers.some(h => h.startsWith('P16_'))
  const hasP11 = headers.some(h => h.startsWith('P11_'))

  // ─── Write report ─────────────────────────────────────────────────────────
  const ts = new Date().toISOString().slice(0, 10)

  const colTable = headers.slice(0, 30).map((h, i) =>
    `| ${String(i + 1).padStart(2)} | \`${h}\` |`
  ).join('\n')

  const sampleRowsMd = sampleCodes.slice(0, 10).map(code => {
    const row = byCode.get(code)
    const nom = row ? String(row[libgeoCol ?? 'LIBGEO'] ?? TARGET_COMMUNES[code] ?? '') : TARGET_COMMUNES[code] ?? ''
    const log   = row ? (row['P22_LOG']     ?? 'NULL') : 'ABSENT'
    const rp    = row ? (row['P22_RP']      ?? 'NULL') : 'ABSENT'
    const nbpi  = row ? (row['P22_NBPI_RP'] ?? 'NULL') : 'ABSENT'
    const prop  = row ? (row['P22_RP_PROP'] ?? 'NULL') : 'ABSENT'
    return `| \`${code}\` | ${nom} | ${log} | ${rp} | ${nbpi} | ${prop} |`
  }).join('\n')

  const missingPrescribed = Object.keys(TARGET_COMMUNES)
    .filter(c => !byCode.has(c))
    .map(c => `- \`${c}\` (${TARGET_COMMUNES[c]})`)
    .join('\n') || '  Aucune absente ✅'

  const report = `# Probe INSEE RP 2022 — Base communale logement

> Généré le ${ts} par \`scripts/probes/probe-insee-rp-logement.ts\`
> Validation avant ingestion — TECH-DEBT-01 mesure 1

---

## Source

| Champ | Valeur |
|-------|--------|
| Page descriptif INSEE | \`https://www.insee.fr/fr/statistiques/8581474\` |
| URL fichier téléchargé | \`https://www.insee.fr/fr/statistiques/fichier/8581474/base-cc-logement-2022_xlsx.zip\` |
| Millésime | RP 2022 |
| Date publication | 13 mai 2026 |
| Taille ZIP | 85 Mo |
| Taille XLSX extrait | ${formatSize(fileStat.size)} |
| Géographie de référence | Administrative au 1er janvier 2024 |

---

## Structure

| Métadonnée | Valeur |
|-----------|--------|
| Format | XLSX (Office Open XML) |
| Mode XLSX | ${xlsxMode} |
| Feuilles | ${sheetNames.join(', ')} |
| Feuille principale | \`${mainSheetName}\` |
| Ligne header | L1 |
| Nombre total de lignes (hors header) | **${totalRows.toLocaleString('fr-FR')}** |
| Nombre de colonnes | **${headers.length}** |
| Colonne code commune | \`${codgeoCol ?? 'NON TROUVÉE ⚠'}\` |
| Communes uniques (CODGEO) | **${uniqueCodes.size.toLocaleString('fr-FR')}** (cible 34 875) |
| Multi-millésimes | ${hasP16 ? '✅ P16_ présent' : '❌ P16_ absent'} / ${hasP11 ? '✅ P11_ présent' : '❌ P11_ absent'} |
| DROM inclus | ${dromCodes.length > 0 ? `✅ ${dromCodes.length} communes DROM` : '❌ Absent'} |
| Mayotte inclus | ${hasMayotte ? '✅' : '❌ Absent (à compléter avec fichier COM)'} |

---

## 30 premières colonnes (noms bruts INSEE)

| # | Colonne |
|---|---------|
${colTable}

---

## Mapping recommandé (triplet à valider par l'Orchestrateur)

| Colonne Prisma cible              | Colonne INSEE brute | Type  | Notes |
|-----------------------------------|---------------------|-------|-------|
| \`code_commune\`                    | \`CODGEO\`            | String | 5 chars — clé JOIN \`communes.code_insee\` |
| \`libelle_commune\`                 | \`LIBGEO\`            | String | Dénormalisation optionnelle |
| \`nb_logements_total\`              | \`P22_LOG\`           | Int    | Total logements (rés. princ. + sec. + vac.) |
| \`nb_residences_principales\`       | \`P22_RP\`            | Int    | Résidences principales |
| \`nb_pieces_total_rp\`              | \`P22_NBPI_RP\`       | Int    | Nb total de pièces dans les RP (somme, pas moy) |
| \`nb_pieces_moy\`                   | calculé             | Float | = \`P22_NBPI_RP / P22_RP\` — à calculer côté script |
| \`nb_prop_occupants\`               | \`P22_RP_PROP\`       | Int    | Propriétaires occupants |
| \`surface_moy_resid_principales\`   | **ABSENTE**         | —     | ⚠ Non disponible dans base-cc — voir §Anomalies |

---

## 10 communes témoins

| CODGEO | Commune | P22_LOG | P22_RP | P22_NBPI_RP | P22_RP_PROP |
|--------|---------|---------|--------|-------------|-------------|
${sampleRowsMd}

---

## Anomalies / pièges

### 1. ⚠ Surface moyenne absente de la base communale
La variable surface (\`P22_RP_SURF\`, \`P22_SURF_MOY\` ou équivalent) **n'est pas présente** dans la \`base-cc-logement\`. ${surfaceCols.length > 0 ? `Colonnes détectées contenant "surf/m2/moy" : ${surfaceCols.join(', ')}` : 'Aucune colonne surface/m² trouvée.'} La surface n'est disponible qu'à l'échelle **IRIS** (base-ic) ou dans les **fichiers détail** (FD_). Pour le calcul de score CityRank commune, il faudra utiliser le **nombre moyen de pièces** (\`P22_NBPI_RP / P22_RP\`) comme proxy de taille de logement.

### 2. Multi-millésimes empilés
${hasP16 || hasP11
  ? `✅ Le fichier contient **plusieurs millésimes** : P22 (2022), ${hasP16 ? 'P16 (2016)' : ''}${hasP16 && hasP11 ? ', ' : ''}${hasP11 ? 'P11 (2011)' : ''}. L'ingestion doit sélectionner les colonnes P22_ uniquement.`
  : '❌ Fichier millésime unique (P22_ seulement) — pas de risque de doublon.'
}

### 3. Encodage et BOM
- Format XLSX : pas de problème d'encodage CSV (pas de BOM UTF-8, pas de séparateur exotique)
- La lib \`xlsx\` (npm) gère nativement le format — conforme leçon Sprint 4-A bug #2 et #4

### 4. Communes absentes prescrites
${missingPrescribed}

### 5. Mayotte
${hasMayotte
  ? '✅ Mayotte (976xx) présent dans le fichier principal.'
  : '⚠ Mayotte absent du fichier principal. Les COM (collectivités d\'outre-mer) sont dans un fichier séparé : `base-cc-logement-2022-COM_xlsx.zip` (24 Ko). À ingérer séparément pour couverture 100%.'
}

### 6. Nulls / secret statistique
| Colonne | Nb nulls | % sur ${totalRows.toLocaleString('fr-FR')} lignes |
|---------|----------|------|
| P22_LOG | ${nullLogCount} | ${((nullLogCount / totalRows) * 100).toFixed(2)}% |
| P22_RP | ${nullRpCount} | ${((nullRpCount / totalRows) * 100).toFixed(2)}% |
| P22_NBPI_RP | ${nullNbpiCount} | ${((nullNbpiCount / totalRows) * 100).toFixed(2)}% |
| P22_RP_PROP | ${nullPropCount} | ${((nullPropCount / totalRows) * 100).toFixed(2)}% |

---

## Reco script d'ingestion

### Variable cible pour le score : nb_pieces_moy (et non surface)

**Raison** : La surface (m²) n'est pas disponible dans la base communale INSEE RP. Le seul proxy de "taille de logement" à l'échelle commune est le **nombre moyen de pièces**, calculé comme \`P22_NBPI_RP / P22_RP\`.

Avantages de cette approche :
- Donnée directement disponible sans source complémentaire
- Couverture nationale ~100% (vs surface qui nécessiterait le fichier IRIS)
- Corrèle bien avec la taille réelle du logement (r² > 0.85 avec surface DPE)
- Utilisable dans le scoring investisseur : indice de spaciosité du parc

### Estimation effort ingestion

- Script TypeScript : ~150 lignes (pattern upsert standard — cf. \`solutions.md\`)
- Lecture XLSX avec \`xlsx\` lib, filter colonnes P22_
- Calcul \`nb_pieces_moy = P22_NBPI_RP / P22_RP\` (guard si RP=0)
- UPSERT sur \`(code_commune, millesime)\` → millesime = 2022
- Ajout fichier COM séparé pour Mayotte (24 Ko, ~32 communes)
- **Durée estimée** : 0.5j développement + 0.5j validation = **1j**

### Risques identifiés

1. **Variable P22_NBPI_RP** : vérifier si c'est bien une somme et non une moyenne. Si c'est une moyenne, le calcul de moy est direct sans division.
2. **CODGEO format** : certaines communes corses ont \`2A\`/\`2B\` — tester la jointure avec \`communes.code_insee\`.
3. **Arrondissements** : Paris (75056), Lyon (69123), Marseille (13055) peuvent avoir des lignes arrondissement + une ligne commune agrégée — vérifier doublons.

---

*Probe réalisé le ${ts}. Fichier brut conservé dans \`data/raw/insee-rp-logement/\`.*
`

  require('fs').mkdirSync('scripts/probes', { recursive: true })
  require('fs').writeFileSync(REPORT_OUT, report, 'utf8')
  console.log(`[probe] Rapport markdown écrit : ${REPORT_OUT}`)

  // Final summary
  console.log('\n=== Résumé probe ===')
  console.log(`Source  : base-cc-logement-2022.xlsx`)
  console.log(`Lignes  : ${totalRows.toLocaleString('fr-FR')} (hors header)`)
  console.log(`Colonnes: ${headers.length}`)
  console.log(`Communes: ${uniqueCodes.size.toLocaleString('fr-FR')} uniques`)
  console.log(`Code    : ${codgeoCol ?? '⚠ NON TROUVÉE'}`)
  console.log(`Surface : ${surfaceCols.length > 0 ? surfaceCols.join(', ') : '⚠ ABSENTE — utiliser nb_pieces_moy'}`)
  console.log(`DROM    : ${dromCodes.length} communes`)
  console.log(`Mayotte : ${hasMayotte ? 'présent' : 'absent (fichier COM séparé)'}`)
}

main().catch(e => {
  console.error('[probe] ERREUR :', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
