import type { PrismaClient } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvestisseurKPIData {
  prix_m2_median: number | null;
  loyer_m2: number | null;
  loyer_source: string | null;
  loyer_niveau: string | null;
  yield_brut: number | null;
  taxe_fonciere_total: number | null;
  taux_tf_pct: number | null;
  rang_national: number | null;
  rang_departement: number | null;
  nb_communes_dept: number | null;
}

export interface InvestisseurRankRow {
  code_insee: string;
  nom: string;
  slug: string;
  departement: string;
  population: number | null;
  prix_m2_median: number | null;
  loyer_m2: number | null;
  yield_brut: number | null;
  rang_national: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Retourne les 4 KPI investisseur + rangs national/département pour une commune.
 *
 * Logique :
 * - prix_m2_median : médiane DVF toutes transactions (prix_m2 non-null, >0)
 * - loyer_m2       : depuis loyer_communes (meilleure source déjà résolue à l'ingestion)
 * - yield_brut     : (loyer_m2 × 12) / prix_m2_median × 100 (%)
 * - taxe_fonciere  : montant_tfb_total depuis taxe_fonciere_communes (brut, non secret)
 * - rangs          : window functions sur l'ensemble des communes avec yield calculable
 */
export async function getInvestisseurKPI(
  codeInsee: string,
  prisma: PrismaClient,
): Promise<InvestisseurKPIData | null> {
  // Récupère prix DVF médian + loyer + TF pour cette commune
  const [dvfRows, loyerRow, tfRow] = await Promise.all([
    prisma.$queryRaw<{ prix_m2_median: string | null }[]>`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2)::text AS prix_m2_median
      FROM immo_score.dvf_prix
      WHERE code_commune = ${codeInsee}
        AND prix_m2 IS NOT NULL
        AND prix_m2 > 0
    `,
    prisma.loyerCommune.findFirst({
      where: { commune_id: codeInsee },
      orderBy: { niveau: 'asc' },
      select: { loyer_m2: true, source: true, niveau: true },
    }),
    prisma.taxeFonciereCommune.findUnique({
      where: { code_commune: codeInsee },
      select: { montant_tfb_total: true, taux_communal_pct: true, secret_statistique: true },
    }),
  ]);

  const prixM2Median = dvfRows[0]?.prix_m2_median ? parseFloat(dvfRows[0].prix_m2_median) : null;
  const loyerM2 = loyerRow?.loyer_m2 ?? null;
  const yieldBrut =
    prixM2Median != null && prixM2Median > 0 && loyerM2 != null
      ? Math.round(((loyerM2 * 12) / prixM2Median) * 1000) / 10
      : null;

  const tfData =
    tfRow && !tfRow.secret_statistique && tfRow.montant_tfb_total != null
      ? { montant: tfRow.montant_tfb_total, taux: tfRow.taux_communal_pct }
      : null;

  // Calcule les rangs uniquement si yield calculable
  let rangNational: number | null = null;
  let rangDepartement: number | null = null;
  let nbCommunesDept: number | null = null;

  if (yieldBrut != null) {
    const commune = await prisma.commune.findUnique({
      where: { code_insee: codeInsee },
      select: { departement: true },
    });
    const dept = commune?.departement ?? null;

    if (dept) {
      const rankRows = await prisma.$queryRaw<{
        rang_national: string;
        rang_departement: string;
        nb_communes_dept: string;
      }[]>`
        WITH yield_calc AS (
          SELECT
            c.code_insee,
            c.departement,
            CASE
              WHEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2) > 0
                THEN (lc.loyer_m2 * 12.0 / PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2)) * 100
              ELSE NULL
            END AS yield_brut
          FROM immo_score.communes c
          JOIN immo_score.loyer_communes lc ON lc.commune_id = c.code_insee
          JOIN immo_score.dvf_prix d ON d.code_commune = c.code_insee
          WHERE d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
            AND lc.loyer_m2 IS NOT NULL
          GROUP BY c.code_insee, c.departement, lc.loyer_m2
        ),
        ranked AS (
          SELECT
            code_insee,
            departement,
            yield_brut,
            RANK() OVER (ORDER BY yield_brut DESC NULLS LAST)::text AS rang_national,
            RANK() OVER (PARTITION BY departement ORDER BY yield_brut DESC NULLS LAST)::text AS rang_departement,
            COUNT(*) OVER (PARTITION BY departement)::text AS nb_communes_dept
          FROM yield_calc
        )
        SELECT rang_national, rang_departement, nb_communes_dept
        FROM ranked
        WHERE code_insee = ${codeInsee}
        LIMIT 1
      `;

      if (rankRows[0]) {
        rangNational = parseInt(rankRows[0].rang_national, 10);
        rangDepartement = parseInt(rankRows[0].rang_departement, 10);
        nbCommunesDept = parseInt(rankRows[0].nb_communes_dept, 10);
      }
    }
  }

  return {
    prix_m2_median: prixM2Median != null ? Math.round(prixM2Median) : null,
    loyer_m2: loyerM2,
    loyer_source: loyerRow?.source ?? null,
    loyer_niveau: loyerRow?.niveau ?? null,
    yield_brut: yieldBrut,
    taxe_fonciere_total: tfData ? Math.round(tfData.montant) : null,
    taux_tf_pct: tfData?.taux ?? null,
    rang_national: rangNational,
    rang_departement: rangDepartement,
    nb_communes_dept: nbCommunesDept,
  };
}

/**
 * Retourne le top N communes nationales par yield brut calculable.
 * Utilisé par la page pillar /profil/investisseur.
 */
export async function getTopInvestisseurCommunes(
  limit: number,
  prisma: PrismaClient,
): Promise<InvestisseurRankRow[]> {
  const rows = await prisma.$queryRaw<{
    code_insee: string;
    nom: string;
    slug: string;
    departement: string;
    population: string | null;
    prix_m2_median: string | null;
    loyer_m2: string | null;
    yield_brut: string | null;
    rang_national: string;
  }[]>`
    WITH yield_calc AS (
      SELECT
        c.code_insee,
        c.nom,
        c.slug,
        c.departement,
        c.population,
        lc.loyer_m2,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2) AS prix_m2_median,
        CASE
          WHEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2) > 0
            THEN (lc.loyer_m2 * 12.0 / PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2)) * 100
          ELSE NULL
        END AS yield_brut
      FROM immo_score.communes c
      JOIN immo_score.loyer_communes lc ON lc.commune_id = c.code_insee
      JOIN immo_score.dvf_prix d ON d.code_commune = c.code_insee
      WHERE d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
        AND lc.loyer_m2 IS NOT NULL
      GROUP BY c.code_insee, c.nom, c.slug, c.departement, c.population, lc.loyer_m2
    ),
    ranked AS (
      SELECT *, RANK() OVER (ORDER BY yield_brut DESC NULLS LAST)::text AS rang_national
      FROM yield_calc
      WHERE yield_brut IS NOT NULL
    )
    SELECT * FROM ranked
    ORDER BY yield_brut DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    code_insee: r.code_insee,
    nom: r.nom,
    slug: r.slug,
    departement: r.departement,
    population: r.population != null ? parseInt(r.population, 10) : null,
    prix_m2_median: r.prix_m2_median != null ? Math.round(parseFloat(r.prix_m2_median)) : null,
    loyer_m2: r.loyer_m2 != null ? parseFloat(r.loyer_m2) : null,
    yield_brut: r.yield_brut != null ? Math.round(parseFloat(r.yield_brut) * 10) / 10 : null,
    rang_national: parseInt(r.rang_national, 10),
  }));
}

/**
 * Retourne le top N communes d'un département par yield brut.
 * Utilisé par /departements/[code]/investisseur.
 */
export async function getTopInvestisseurByDept(
  deptCode: string,
  limit: number,
  prisma: PrismaClient,
): Promise<InvestisseurRankRow[]> {
  const rows = await prisma.$queryRaw<{
    code_insee: string;
    nom: string;
    slug: string;
    departement: string;
    population: string | null;
    prix_m2_median: string | null;
    loyer_m2: string | null;
    yield_brut: string | null;
    rang_national: string;
  }[]>`
    WITH yield_calc AS (
      SELECT
        c.code_insee,
        c.nom,
        c.slug,
        c.departement,
        c.population,
        lc.loyer_m2,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2) AS prix_m2_median,
        CASE
          WHEN PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2) > 0
            THEN (lc.loyer_m2 * 12.0 / PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2)) * 100
          ELSE NULL
        END AS yield_brut
      FROM immo_score.communes c
      JOIN immo_score.loyer_communes lc ON lc.commune_id = c.code_insee
      JOIN immo_score.dvf_prix d ON d.code_commune = c.code_insee
      WHERE d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
        AND lc.loyer_m2 IS NOT NULL
        AND c.departement = ${deptCode}
      GROUP BY c.code_insee, c.nom, c.slug, c.departement, c.population, lc.loyer_m2
    ),
    ranked AS (
      SELECT *, RANK() OVER (ORDER BY yield_brut DESC NULLS LAST)::text AS rang_national
      FROM yield_calc
      WHERE yield_brut IS NOT NULL
    )
    SELECT * FROM ranked
    ORDER BY yield_brut DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    code_insee: r.code_insee,
    nom: r.nom,
    slug: r.slug,
    departement: r.departement,
    population: r.population != null ? parseInt(r.population, 10) : null,
    prix_m2_median: r.prix_m2_median != null ? Math.round(parseFloat(r.prix_m2_median)) : null,
    loyer_m2: r.loyer_m2 != null ? parseFloat(r.loyer_m2) : null,
    yield_brut: r.yield_brut != null ? Math.round(parseFloat(r.yield_brut) * 10) / 10 : null,
    rang_national: parseInt(r.rang_national, 10),
  }));
}

/**
 * Retourne les slugs des 500 communes avec le plus de transactions DVF
 * ayant aussi un loyer disponible — pour generateStaticParams.
 */
export async function getStaticParamsTop500(
  prisma: PrismaClient,
): Promise<{ slug: string }[]> {
  const rows = await prisma.$queryRaw<{ slug: string }[]>`
    SELECT c.slug
    FROM immo_score.communes c
    JOIN immo_score.loyer_communes lc ON lc.commune_id = c.code_insee
    WHERE lc.loyer_m2 IS NOT NULL
    ORDER BY (
      SELECT COUNT(*) FROM immo_score.dvf_prix d
      WHERE d.code_commune = c.code_insee AND d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
    ) DESC
    LIMIT 500
  `;
  return rows;
}
