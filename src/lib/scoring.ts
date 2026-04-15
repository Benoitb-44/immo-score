/**
 * scoring.ts
 * Algorithme de score composite 0-100 pour les communes françaises.
 *
 * Dimensions actives (3 sources disponibles sur 6) — pondérations normalisées :
 *   DVF      50% — prix m² médian (percentile rank inverse, 70%) + liquidité (percentile rank, 30%)
 *   DPE      30% — % logements classe A+B (bâti performant)
 *   Risques  20% — départ 100, malus par risque recensé (MOYEN −5, FORT −15, TRES_FORT −20)
 *
 * Méthode : PERCENT_RANK() via window functions SQL pour DVF (comparaison nationale).
 * Communes sans données sur une dimension → score médiane nationale = 50.
 */

import { PrismaClient, NiveauRisque } from '@prisma/client';

// ─── Pondérations ────────────────────────────────────────────────────────────

/** Poids de chaque dimension dans le score global (somme = 1.0) */
const W = {
  dvf: 0.50,
  dpe: 0.30,
  risques: 0.20,
} as const;

/** Split DVF : prix attractif vs volume de transactions */
const W_DVF = {
  prix: 0.70,
  liquidite: 0.30,
} as const;

/** Malus appliqué par risque recensé (déduit de 100) */
const MALUS: Record<NiveauRisque, number> = {
  [NiveauRisque.FAIBLE]: 0,
  [NiveauRisque.MOYEN]: 5,
  [NiveauRisque.FORT]: 15,
  [NiveauRisque.TRES_FORT]: 20,
};

/** Score substitué pour une dimension sans données (médiane nationale) */
const SCORE_DEFAUT = 50;

// ─── Types publics ───────────────────────────────────────────────────────────

export interface DvfDetails {
  /** Score dimension DVF 0-100 (null si commune absente de DVF) */
  score: number | null;
  /** Percentile rang prix (0 = plus cher, 100 = moins cher) */
  prix_percentile: number | null;
  /** Percentile rang liquidité (0 = moins actif, 100 = plus actif) */
  liquidite_percentile: number | null;
  /** Prix m² médian de la commune (€) */
  prix_m2_median: number | null;
  /** Nombre de transactions (appartements + maisons, 2024) */
  nb_transactions: number | null;
}

export interface DpeDetails {
  /** Score dimension DPE 0-100 = % logements A+B (null si commune absente de DPE) */
  score: number | null;
  /** Pourcentage de logements classés A ou B */
  pct_ab: number | null;
  /** Total logements avec DPE dans la commune */
  total_logements: number | null;
}

export interface RisquesDetails {
  /** Score dimension risques 0-100 (null si commune absente de Géorisques) */
  score: number | null;
  /** Nombre de risques de niveau TRES_FORT */
  tres_fort: number;
  /** Nombre de risques de niveau FORT */
  fort: number;
  /** Nombre de risques de niveau MOYEN */
  moyen: number;
  /** Nombre de risques de niveau FAIBLE */
  faible: number;
}

export interface ScoreDetails {
  /** Score composite final 0-100 (arrondi à 1 décimale) */
  score: number;
  details: {
    dvf: DvfDetails;
    dpe: DpeDetails;
    risques: RisquesDetails;
  };
}

// ─── Requête DVF ─────────────────────────────────────────────────────────────

interface DvfRow {
  score_prix: string | null;       // PERCENT_RANK retourné comme numeric → string par node-postgres
  score_liquidite: string | null;
  prix_m2_median: string | null;
  nb_transactions: string | null;
}

async function fetchDvfDetails(
  communeId: string,
  client: PrismaClient,
): Promise<DvfDetails> {
  const rows = await client.$queryRaw<DvfRow[]>`
    WITH commune_stats AS (
      SELECT
        code_commune,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2) AS prix_m2_median,
        COUNT(*)::bigint                                       AS nb_transactions
      FROM immo_score.dvf_prix
      WHERE prix_m2 IS NOT NULL
      GROUP BY code_commune
    ),
    ranked AS (
      SELECT
        code_commune,
        prix_m2_median,
        nb_transactions,
        PERCENT_RANK() OVER (ORDER BY prix_m2_median DESC) * 100 AS score_prix,
        PERCENT_RANK() OVER (ORDER BY nb_transactions  ASC) * 100 AS score_liquidite
      FROM commune_stats
    )
    SELECT score_prix, score_liquidite, prix_m2_median, nb_transactions
    FROM ranked
    WHERE code_commune = ${communeId}
  `;

  if (rows.length === 0) {
    return { score: null, prix_percentile: null, liquidite_percentile: null, prix_m2_median: null, nb_transactions: null };
  }

  const row = rows[0];
  const scorePrix = row.score_prix != null ? parseFloat(row.score_prix) : null;
  const scoreLiquidite = row.score_liquidite != null ? parseFloat(row.score_liquidite) : null;

  let score: number | null = null;
  if (scorePrix != null && scoreLiquidite != null) {
    score = W_DVF.prix * scorePrix + W_DVF.liquidite * scoreLiquidite;
  } else if (scorePrix != null) {
    score = scorePrix;
  }

  return {
    score: score != null ? round1(score) : null,
    prix_percentile: scorePrix != null ? round1(scorePrix) : null,
    liquidite_percentile: scoreLiquidite != null ? round1(scoreLiquidite) : null,
    prix_m2_median: row.prix_m2_median != null ? Math.round(parseFloat(row.prix_m2_median)) : null,
    nb_transactions: row.nb_transactions != null ? parseInt(row.nb_transactions) : null,
  };
}

// ─── Requête DPE ─────────────────────────────────────────────────────────────

interface DpeRow {
  ab_count: string;
  total_count: string;
}

async function fetchDpeDetails(
  communeId: string,
  client: PrismaClient,
): Promise<DpeDetails> {
  const rows = await client.$queryRaw<DpeRow[]>`
    SELECT
      COALESCE(SUM(CASE WHEN classe_dpe IN ('A','B') THEN nb_logements ELSE 0 END), 0)::text AS ab_count,
      COALESCE(SUM(nb_logements), 0)::text                                                    AS total_count
    FROM immo_score.dpe_communes
    WHERE code_commune = ${communeId}
  `;

  const total = rows[0]?.total_count ? parseInt(rows[0].total_count) : 0;
  if (total === 0) {
    return { score: null, pct_ab: null, total_logements: null };
  }

  const ab = parseInt(rows[0].ab_count);
  const pct = round1((ab / total) * 100);

  return { score: pct, pct_ab: pct, total_logements: total };
}

// ─── Requête Risques ─────────────────────────────────────────────────────────

interface RisqueRow {
  niveau: NiveauRisque;
  cnt: string;
}

async function fetchRisquesDetails(
  communeId: string,
  client: PrismaClient,
): Promise<RisquesDetails> {
  const rows = await client.$queryRaw<RisqueRow[]>`
    SELECT niveau, COUNT(*)::text AS cnt
    FROM immo_score.risques
    WHERE code_commune = ${communeId}
    GROUP BY niveau
  `;

  if (rows.length === 0) {
    // Aucune entrée = commune non couverte par Géorisques (pas "sans risque")
    return { score: null, tres_fort: 0, fort: 0, moyen: 0, faible: 0 };
  }

  const counts = { tres_fort: 0, fort: 0, moyen: 0, faible: 0 };
  let malus = 0;

  for (const row of rows) {
    const cnt = parseInt(row.cnt);
    malus += MALUS[row.niveau] * cnt;
    if (row.niveau === NiveauRisque.TRES_FORT) counts.tres_fort += cnt;
    else if (row.niveau === NiveauRisque.FORT) counts.fort += cnt;
    else if (row.niveau === NiveauRisque.MOYEN) counts.moyen += cnt;
    else if (row.niveau === NiveauRisque.FAIBLE) counts.faible += cnt;
  }

  return {
    score: Math.max(0, 100 - malus),
    ...counts,
  };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

const defaultClient = new PrismaClient();

/**
 * Calcule le score composite (0-100) d'une commune française.
 *
 * @param communeId  - Code INSEE de la commune (ex : "75056" pour Paris)
 * @param client     - Instance PrismaClient (optionnel, utilise le client par défaut)
 * @returns          - Objet {score, details} ou null si la commune n'existe pas
 */
export async function calculateScore(
  communeId: string,
  client: PrismaClient = defaultClient,
): Promise<ScoreDetails | null> {
  // Vérification existence de la commune
  const commune = await client.commune.findUnique({
    where: { code_insee: communeId },
    select: { code_insee: true },
  });
  if (!commune) return null;

  // Requêtes parallèles sur les 3 dimensions
  const [dvf, dpe, risques] = await Promise.all([
    fetchDvfDetails(communeId, client),
    fetchDpeDetails(communeId, client),
    fetchRisquesDetails(communeId, client),
  ]);

  // Dimensions manquantes → médiane nationale (50) pour le calcul global
  const effectiveDvf = dvf.score ?? SCORE_DEFAUT;
  const effectiveDpe = dpe.score ?? SCORE_DEFAUT;
  const effectiveRisques = risques.score ?? SCORE_DEFAUT;

  const scoreGlobal = round1(
    W.dvf * effectiveDvf +
    W.dpe * effectiveDpe +
    W.risques * effectiveRisques,
  );

  return {
    score: scoreGlobal,
    details: { dvf, dpe, risques },
  };
}

// ─── Utilitaire ──────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
