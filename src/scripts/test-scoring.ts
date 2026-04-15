/**
 * test-scoring.ts
 * Validation de calculateScore() sur 10 communes représentatives.
 *
 * Communes choisies pour couvrir différents profils :
 *   - Grandes villes (Paris, Lyon, Bordeaux)
 *   - Villes moyennes (Rennes, Montpellier)
 *   - Communes rurales avec et sans risques
 *   - Communes sans données DVF
 *
 * Usage : tsx src/scripts/test-scoring.ts
 */

import { PrismaClient } from '@prisma/client';
import { calculateScore } from '../lib/scoring';

const prisma = new PrismaClient();

// Communes à tester : Paris, Lyon, Bordeaux, Rennes, Montpellier
// + 5 communes issues de la base (une par tranche de population)
const COMMUNES_CIBLES = [
  '75056', // Paris
  '69123', // Lyon
  '33063', // Bordeaux
  '35238', // Rennes
  '34172', // Montpellier
];

async function getRepresentativeCommunes(): Promise<string[]> {
  // 5 communes supplémentaires : une par décile (petites, moyennes, grandes)
  const rows = await prisma.$queryRaw<{ code_insee: string }[]>`
    SELECT code_insee
    FROM immo_score.communes
    WHERE population IS NOT NULL
    ORDER BY population
    OFFSET (SELECT COUNT(*) FROM immo_score.communes WHERE population IS NOT NULL) / 10
    LIMIT 1
    UNION ALL
    SELECT code_insee FROM immo_score.communes WHERE population IS NOT NULL ORDER BY population
    OFFSET (SELECT COUNT(*) FROM immo_score.communes WHERE population IS NOT NULL) * 3 / 10 LIMIT 1
    UNION ALL
    SELECT code_insee FROM immo_score.communes WHERE population IS NOT NULL ORDER BY population
    OFFSET (SELECT COUNT(*) FROM immo_score.communes WHERE population IS NOT NULL) * 5 / 10 LIMIT 1
    UNION ALL
    SELECT code_insee FROM immo_score.communes WHERE population IS NOT NULL ORDER BY population
    OFFSET (SELECT COUNT(*) FROM immo_score.communes WHERE population IS NOT NULL) * 7 / 10 LIMIT 1
    UNION ALL
    SELECT code_insee FROM immo_score.communes WHERE population IS NOT NULL ORDER BY population
    OFFSET (SELECT COUNT(*) FROM immo_score.communes WHERE population IS NOT NULL) * 9 / 10 LIMIT 1
  `;
  return rows.map(r => r.code_insee);
}

async function run() {
  console.log('=== Test calculateScore() — 10 communes ===\n');

  let extraCommunes: string[] = [];
  try {
    extraCommunes = await getRepresentativeCommunes();
  } catch {
    // Fallback si la requête UNION échoue (ex : population NULL sur toutes)
    const rows = await prisma.commune.findMany({
      select: { code_insee: true },
      take: 5,
      orderBy: { code_insee: 'asc' },
    });
    extraCommunes = rows.map(r => r.code_insee);
  }

  const allCommunes = [...new Set([...COMMUNES_CIBLES, ...extraCommunes])].slice(0, 10);

  // Récupère les noms pour affichage
  const infoMap = await prisma.commune.findMany({
    where: { code_insee: { in: allCommunes } },
    select: { code_insee: true, nom: true, departement: true, population: true },
  });
  const info = Object.fromEntries(infoMap.map(c => [c.code_insee, c]));

  let success = 0;
  let errors = 0;

  for (const code of allCommunes) {
    const commune = info[code];
    const label = commune
      ? `${commune.nom} (${commune.departement}, pop. ${commune.population ?? 'N/A'})`
      : code;

    try {
      const result = await calculateScore(code, prisma);

      if (result === null) {
        console.log(`❌  ${label} → commune introuvable`);
        errors++;
        continue;
      }

      const { score, details } = result;

      // Validation des invariants
      if (score < 0 || score > 100) throw new Error(`Score hors plage : ${score}`);
      if (details.dvf.score != null && (details.dvf.score < 0 || details.dvf.score > 100))
        throw new Error(`Score DVF hors plage : ${details.dvf.score}`);
      if (details.dpe.score != null && (details.dpe.score < 0 || details.dpe.score > 100))
        throw new Error(`Score DPE hors plage : ${details.dpe.score}`);
      if (details.risques.score != null && (details.risques.score < 0 || details.risques.score > 100))
        throw new Error(`Score Risques hors plage : ${details.risques.score}`);

      const dvfStr = details.dvf.score != null
        ? `${details.dvf.score} (${details.dvf.prix_m2_median}€/m², ${details.dvf.nb_transactions} tx)`
        : 'N/A (médiane=50)';

      const dpeStr = details.dpe.score != null
        ? `${details.dpe.score}% A+B (${details.dpe.total_logements} logements)`
        : 'N/A (médiane=50)';

      const risquesStr = details.risques.score != null
        ? `${details.risques.score} (fort:${details.risques.fort} moyen:${details.risques.moyen} faible:${details.risques.faible})`
        : 'N/A (médiane=50)';

      console.log(`✓  ${label}`);
      console.log(`   Score global : ${score}/100`);
      console.log(`   DVF          : ${dvfStr}`);
      console.log(`   DPE          : ${dpeStr}`);
      console.log(`   Risques      : ${risquesStr}`);
      console.log('');

      success++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`❌  ${label} → ERREUR: ${msg}`);
      errors++;
    }
  }

  console.log(`=== Résultat : ${success}/${allCommunes.length} OK, ${errors} erreur(s) ===`);
  process.exit(errors > 0 ? 1 : 0);
}

run()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
