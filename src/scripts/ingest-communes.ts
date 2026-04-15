/**
 * ingest-communes.ts
 * Peuple la table communes depuis le COG INSEE via geo.api.gouv.fr
 * Idempotent : upsert sur code_insee
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface GeoCommune {
  nom: string;
  code: string;
  codeDepartement: string;
  codeRegion: string;
  population?: number;
}

interface IngestResult {
  source: string;
  communes_processed: number;
  communes_updated: number;
  communes_errored: number;
  duration_ms: number;
  errors: string[];
}

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Génère des slugs uniques pour toutes les communes :
 * - Noms uniques → slug de base (ex: "paris")
 * - Noms dupliqués → slug + dept (ex: "saint-martin-97")
 * - Collisions résiduelles → slug + code_insee
 */
function buildSlugs(communes: GeoCommune[]): Map<string, string> {
  const slugCount = new Map<string, number>();
  for (const c of communes) {
    const base = toSlug(c.nom);
    slugCount.set(base, (slugCount.get(base) ?? 0) + 1);
  }

  const slugMap = new Map<string, string>(); // code_insee → slug
  const assigned = new Set<string>();

  for (const c of communes) {
    const base = toSlug(c.nom);
    let slug = base;

    if ((slugCount.get(base) ?? 0) > 1) {
      slug = `${base}-${toSlug(c.codeDepartement)}`;
    }

    // Fallback ultime : code_insee si encore en conflit
    if (assigned.has(slug)) {
      slug = `${base}-${c.code}`;
    }

    assigned.add(slug);
    slugMap.set(c.code, slug);
  }

  return slugMap;
}

async function fetchCommunesByDept(codeDept: string): Promise<GeoCommune[]> {
  const url = `https://geo.api.gouv.fr/departements/${codeDept}/communes?fields=nom,code,codeDepartement,codeRegion,population`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour département ${codeDept}`);
  return res.json() as Promise<GeoCommune[]>;
}

async function fetchAllDepartements(): Promise<string[]> {
  const res = await fetch('https://geo.api.gouv.fr/departements?fields=code');
  if (!res.ok) throw new Error(`HTTP ${res.status} pour la liste des départements`);
  const data = await res.json() as { code: string }[];
  return data.map(d => d.code);
}

async function ingest(): Promise<IngestResult> {
  const start = Date.now();
  const errors: string[] = [];
  let processed = 0;
  let updated = 0;

  console.log('Récupération des départements...');
  const departements = await fetchAllDepartements();
  console.log(`  → ${departements.length} départements`);

  console.log('Récupération des communes par département...');
  const allCommunes: GeoCommune[] = [];

  for (const dept of departements) {
    try {
      const communes = await fetchCommunesByDept(dept);
      allCommunes.push(...communes);
      process.stdout.write(`\r  Chargé : ${allCommunes.length} communes...`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Dept ${dept}: ${msg}`);
    }
    // Rate limiting léger
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  console.log(`\n  → ${allCommunes.length} communes au total`);

  console.log('Génération des slugs...');
  const slugMap = buildSlugs(allCommunes);

  console.log('Upsert en base...');
  for (const commune of allCommunes) {
    try {
      const slug = slugMap.get(commune.code)!;

      await prisma.commune.upsert({
        where: { code_insee: commune.code },
        create: {
          code_insee: commune.code,
          nom: commune.nom,
          departement: commune.codeDepartement,
          region: commune.codeRegion,
          population: commune.population ?? null,
          slug,
        },
        update: {
          nom: commune.nom,
          departement: commune.codeDepartement,
          region: commune.codeRegion,
          population: commune.population ?? null,
          slug,
        },
      });
      updated++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${commune.code}: ${msg}`);
    }
    processed++;

    if (processed % 1000 === 0) {
      process.stdout.write(`\r  Inséré : ${processed}/${allCommunes.length}`);
    }
  }

  console.log(`\n  Terminé.`);

  return {
    source: 'geo.api.gouv.fr (COG INSEE)',
    communes_processed: processed,
    communes_updated: updated,
    communes_errored: errors.length,
    duration_ms: Date.now() - start,
    errors: errors.slice(0, 20),
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
