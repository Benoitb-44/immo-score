/**
 * ingest-dvf.ts
 * Ingestion des transactions DVF depuis files.data.gouv.fr
 * Source : https://files.data.gouv.fr/geo-dvf/latest/csv/2024/departements/{dept}.csv.gz
 *
 * Stratégie :
 * - Téléchargement du CSV.gz par département (101 req. au lieu de 35 000)
 * - Décompression streaming (zlib) + parsing ligne par ligne (readline)
 * - Filtre : Appartement + Maison, surface > 0, valeur > 0
 * - Idempotent : deleteMany + createMany par commune
 */

import { PrismaClient } from '@prisma/client';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const prisma = new PrismaClient();
const DVF_URL = 'https://files.data.gouv.fr/geo-dvf/latest/csv/2024/departements';

interface DvfRecord {
  code_commune: string;
  date_mutation: Date;
  type_local: string;
  surface_reelle_bati: number;
  valeur_fonciere: number;
  prix_m2: number;
  adresse: string | null;
}

interface IngestResult {
  source: string;
  communes_processed: number;
  communes_updated: number;
  communes_errored: number;
  duration_ms: number;
  errors: string[];
}

/** Parser CSV minimal robuste aux champs quotés */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Télécharge + parse le CSV.gz d'un département.
 * Retourne les transactions groupées par code_commune.
 */
async function parseDeptCsv(dept: string): Promise<Map<string, DvfRecord[]>> {
  const url = `${DVF_URL}/${dept}.csv.gz`;
  const res = await fetch(url);

  if (res.status === 404) return new Map(); // pas de données DVF pour ce dept
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);

  const byCommune = new Map<string, DvfRecord[]>();

  // Streaming : ReadableStream Web → Node.js Readable → gunzip → readline
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  const gunzip = createGunzip();
  const rl = createInterface({ input: nodeStream.pipe(gunzip), crlfDelay: Infinity });

  let isHeader = true;
  let headerMap: Record<string, number> = {};

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (isHeader) {
      parseCSVLine(line).forEach((col, i) => { headerMap[col.trim()] = i; });
      isHeader = false;
      continue;
    }

    const row = parseCSVLine(line);

    const typeLocal = row[headerMap['type_local']]?.trim();
    if (typeLocal !== 'Appartement' && typeLocal !== 'Maison') continue;

    const surfaceStr = row[headerMap['surface_reelle_bati']]?.trim();
    const surface = parseFloat(surfaceStr);
    if (!surface || surface <= 0 || isNaN(surface)) continue;

    const valeurStr = row[headerMap['valeur_fonciere']]?.trim().replace(',', '.');
    const valeur = parseFloat(valeurStr);
    if (!valeur || valeur <= 0 || isNaN(valeur)) continue;

    const codeCommune = row[headerMap['code_commune']]?.trim();
    if (!codeCommune) continue;

    const dateStr = row[headerMap['date_mutation']]?.trim();
    let dateMutation: Date;
    try {
      dateMutation = new Date(dateStr + 'T00:00:00.000Z');
      if (isNaN(dateMutation.getTime())) continue;
    } catch {
      continue;
    }

    const prixM2 = valeur / surface;
    // Filtre anti-aberrations : prix m² entre 50€ et 100 000€
    if (prixM2 < 50 || prixM2 > 100_000) continue;

    const records = byCommune.get(codeCommune) ?? [];
    records.push({
      code_commune: codeCommune,
      date_mutation: dateMutation,
      type_local: typeLocal,
      surface_reelle_bati: surface,
      valeur_fonciere: valeur,
      prix_m2: Math.round(prixM2 * 100) / 100,
      adresse: row[headerMap['adresse_nom_voie']]?.trim() || null,
    });
    byCommune.set(codeCommune, records);
  }

  return byCommune;
}

/**
 * Upsert les transactions DVF d'un département dans PostgreSQL.
 * Pattern idempotent : deleteMany + createMany par commune.
 */
async function upsertDeptData(
  byCommune: Map<string, DvfRecord[]>,
  knownCommunes: Set<string>,
): Promise<{ inserted: number; communes: number; errors: string[] }> {
  let inserted = 0;
  let communes = 0;
  const errors: string[] = [];

  for (const [codeCommune, records] of byCommune) {
    // On ne traite que les communes présentes dans notre référentiel
    if (!knownCommunes.has(codeCommune)) continue;

    try {
      const [, created] = await prisma.$transaction([
        prisma.dvfPrix.deleteMany({ where: { code_commune: codeCommune } }),
        prisma.dvfPrix.createMany({ data: records }),
      ]);
      inserted += created.count;
      communes++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${codeCommune}: ${msg}`);
    }
  }

  return { inserted, communes, errors };
}

async function ingest(): Promise<IngestResult> {
  const start = Date.now();
  const allErrors: string[] = [];
  let totalCommunes = 0;
  let totalInserted = 0;

  // Récupère la liste des départements depuis notre table communes
  const deptRows = await prisma.commune.findMany({
    select: { departement: true, code_insee: true },
    orderBy: { departement: 'asc' },
  });

  const departements = [...new Set(deptRows.map(r => r.departement))];
  const knownCommunes = new Set(deptRows.map(r => r.code_insee));

  console.log(`Ingestion DVF pour ${departements.length} départements, ${knownCommunes.size} communes référencées`);

  for (const dept of departements) {
    try {
      process.stdout.write(`  Dept ${dept.padEnd(3)}... `);
      const byCommune = await parseDeptCsv(dept);

      if (byCommune.size === 0) {
        process.stdout.write('no data\n');
        continue;
      }

      const { inserted, communes, errors } = await upsertDeptData(byCommune, knownCommunes);
      allErrors.push(...errors);
      totalCommunes += communes;
      totalInserted += inserted;

      process.stdout.write(`${communes} communes, ${inserted} transactions\n`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      allErrors.push(`Dept ${dept}: ${msg}`);
      process.stdout.write(`ERREUR: ${msg}\n`);
    }
  }

  return {
    source: 'DVF (files.data.gouv.fr, année 2024)',
    communes_processed: totalCommunes,
    communes_updated: totalCommunes,
    communes_errored: allErrors.length,
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
