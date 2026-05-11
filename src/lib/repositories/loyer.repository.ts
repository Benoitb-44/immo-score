import type { PrismaClient } from '@prisma/client';

export interface LoyerCommuneData {
  loyer_m2: number;
  q1_m2: number | null;
  q3_m2: number | null;
  nb_obs: number | null;
  source: string;
  niveau: string;
  millesime: number;
}

/**
 * Retourne le loyer médian pour une commune depuis LoyerCommune.
 *
 * Cascade : commune_id est UNIQUE (1 ligne/commune, meilleure source résolue au
 * moment de l'ingestion via UPSERT). ORDER BY niveau ASC LIMIT 1 = 1 round-trip
 * BDD, défensif si la contrainte UNIQUE était assouplie.
 *
 * Retourne null si la commune est absente ou si loyer_m2 est NULL.
 */
export async function getLoyerForCommune(
  codeInsee: string,
  prisma: PrismaClient,
): Promise<LoyerCommuneData | null> {
  const row = await prisma.loyerCommune.findFirst({
    where: { commune_id: codeInsee },
    orderBy: { niveau: 'asc' },
    select: {
      loyer_m2: true,
      q1M2: true,
      q3M2: true,
      nbObs: true,
      source: true,
      niveau: true,
      millesime: true,
    },
  });

  if (!row || row.loyer_m2 == null) return null;

  return {
    loyer_m2: row.loyer_m2,
    q1_m2: row.q1M2 != null ? Number(row.q1M2) : null,
    q3_m2: row.q3M2 != null ? Number(row.q3M2) : null,
    nb_obs: row.nbObs ?? null,
    source: row.source,
    niveau: row.niveau,
    millesime: row.millesime,
  };
}
