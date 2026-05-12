import type { PrismaClient } from '@prisma/client';

export interface TaxeFonciereData {
  montant_tfb_total: number | null;
  taux_communal_pct: number | null;
  taux_epci_pct: number | null;
  source: string;
  secret_statistique: boolean;
  fallback_used: 'none' | 'departement_median' | 'national_median';
}

export interface FilosofiEstimData {
  nb_logements: number | null;
  surface_moy: number | null;
}

/**
 * Retourne les données TFB pour une commune.
 *
 * Cascade :
 * 1. Ligne directe si secret_statistique = false et montant_tfb_total non null
 * 2. Médiane départementale (AVG sur communes non secrètes même département)
 * 3. Médiane nationale
 *
 * Retourne null si aucune donnée disponible.
 */
export async function getTaxeFonciereForCommune(
  codeCommune: string,
  prisma: PrismaClient,
): Promise<TaxeFonciereData | null> {
  const row = await prisma.taxeFonciereCommune.findUnique({
    where: { code_commune: codeCommune },
    select: {
      montant_tfb_total: true,
      taux_communal_pct: true,
      taux_epci_pct: true,
      source: true,
      secret_statistique: true,
    },
  });

  if (row && !row.secret_statistique && row.montant_tfb_total != null) {
    return {
      montant_tfb_total: row.montant_tfb_total,
      taux_communal_pct: row.taux_communal_pct,
      taux_epci_pct: row.taux_epci_pct,
      source: row.source,
      secret_statistique: false,
      fallback_used: 'none',
    };
  }

  const dept = codeCommune.slice(0, 2);
  const deptRows = await prisma.$queryRaw<{ avg_tfb: string | null }[]>`
    SELECT AVG(montant_tfb_total)::text AS avg_tfb
    FROM immo_score.taxe_fonciere_communes
    WHERE LEFT(code_commune, 2) = ${dept}
      AND secret_statistique = false
      AND montant_tfb_total IS NOT NULL
  `;

  const deptMedian = deptRows[0]?.avg_tfb != null ? parseFloat(deptRows[0].avg_tfb) : null;

  if (deptMedian != null && isFinite(deptMedian)) {
    return {
      montant_tfb_total: deptMedian,
      taux_communal_pct: row?.taux_communal_pct ?? null,
      taux_epci_pct: row?.taux_epci_pct ?? null,
      source: 'ofgl-rei',
      secret_statistique: row?.secret_statistique ?? false,
      fallback_used: 'departement_median',
    };
  }

  const nationalRows = await prisma.$queryRaw<{ avg_tfb: string | null }[]>`
    SELECT AVG(montant_tfb_total)::text AS avg_tfb
    FROM immo_score.taxe_fonciere_communes
    WHERE secret_statistique = false
      AND montant_tfb_total IS NOT NULL
  `;

  const nationalMedian =
    nationalRows[0]?.avg_tfb != null ? parseFloat(nationalRows[0].avg_tfb) : null;

  if (nationalMedian != null && isFinite(nationalMedian)) {
    return {
      montant_tfb_total: nationalMedian,
      taux_communal_pct: null,
      taux_epci_pct: null,
      source: 'ofgl-rei',
      secret_statistique: row?.secret_statistique ?? false,
      fallback_used: 'national_median',
    };
  }

  return null;
}

/**
 * Estime la TFB annuelle pour un bien simulé en m².
 *
 * Formule D4 (spec Data Scientist 12/05/2026) :
 *   tfb_par_logement = montant_tfb_total / nb_logements
 *   tf_estim = tfb_par_logement × (surfaceSimulée / surface_moy)
 *
 * Retourne null si données filosofi absentes ou invalides.
 */
export function estimateTfbForBien(
  tfbData: TaxeFonciereData,
  filosofiData: FilosofiEstimData | null,
  surfaceSimulee: number,
): number | null {
  if (tfbData.montant_tfb_total == null) return null;
  if (!filosofiData) return null;
  if (!filosofiData.nb_logements || filosofiData.nb_logements <= 0) return null;
  if (!filosofiData.surface_moy || filosofiData.surface_moy <= 0) return null;

  const tfb_par_logement = tfbData.montant_tfb_total / filosofiData.nb_logements;
  return tfb_par_logement * (surfaceSimulee / filosofiData.surface_moy);
}
