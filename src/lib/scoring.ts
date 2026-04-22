/**
 * scoring.ts — v3.1
 *
 * Algorithme de score composite 0-100 par commune (ADR-IS-002, ADR-IS-005).
 *
 * Changements v3.1 vs v3 :
 *   DVF prix   : gaussienne centrée sur médiane nationale — exp(-coef × |delta/médiane|)
 *                Coef par défaut : 0.7 (modifiable via audit-gaussian).
 *   DVF liq    : fenêtre 3 ans glissants + floor à 5 + seuil minimum 5 transactions
 *                (évite faux positifs sur communes rurales à faible population).
 *   Risques    : floor à 10 quand score brut ≤ 0 — évite l'annihilation géométrique.
 *   Imputation : communes sans DVF (Alsace-Moselle, Mayotte) → médiane régionale DVF prix
 *                puis fallback médiane nationale. Traçable via DvfDetails.imputed.
 *
 * Pondérations v3.1 : DVF 45%, DPE 10%, Risques 20%, BPE 25% (inchangées).
 * Agrégation géométrique pondérée — poids renormalisés sur dimensions présentes.
 * Dimensions manquantes → null (aucune imputation), sauf DVF avec fallback régional.
 */

import { PrismaClient, NiveauRisque } from '@prisma/client';
import { BPE_TOTAL } from './bpe-codes';
import { getRegionFromCodeInsee } from './geo-regions';

// ─── Constantes DVF ───────────────────────────────────────────────────────────

/** Coefficient par défaut de la gaussienne prix (audit peut le faire varier). */
export const DVF_GAUSSIAN_COEF = 0.7;
/** Minimum de transactions sur 3 ans pour que le signal liquidité soit fiable. */
const MIN_TX_RECENT = 5;
/** tx/hab sur 3 ans ≥ → score liquidité 100. */
const DVF_LIQ_FULL  = 0.05;
/** Plancher liquidité — commune active au minimum, ou marché trop peu observé. */
const DVF_LIQ_FLOOR = 5;
/** Population minimale pour que le ratio tx/hab soit statistiquement fiable (seuil INSEE bassin de vie autonome). */
const MIN_POP_FOR_LIQ_RATIO = 500;

// ─── Constantes DPE ───────────────────────────────────────────────────────────

const DPE_NP_FLOOR = 40;
const DPE_NP_CEIL  = 100;

// ─── Pondérations v3.1 ────────────────────────────────────────────────────────

const W     = { dvf: 0.45, dpe: 0.10, risques: 0.20, bpe: 0.25 } as const;
const W_DVF = { prix: 0.70, liq: 0.30 }                           as const;

// ─── Malus risques ────────────────────────────────────────────────────────────

const MALUS: Record<NiveauRisque, number> = {
  [NiveauRisque.FAIBLE]:    0,
  [NiveauRisque.MOYEN]:     5,
  [NiveauRisque.FORT]:     15,
  [NiveauRisque.TRES_FORT]: 20,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Agrégation géométrique pondérée ─────────────────────────────────────────

function geometricScore(dims: Array<{ score: number; weight: number }>): number {
  if (dims.length === 0) return 0;
  const totalW = dims.reduce((s, d) => s + d.weight, 0);
  const product = dims.reduce((p, d) => {
    const w = d.weight / totalW;
    const s = clamp(d.score, 1, 100);
    return p * Math.pow(s / 100, w);
  }, 1);
  return round1(product * 100);
}

// ─── Types publics ────────────────────────────────────────────────────────────

export interface NationalMedians {
  appart: number | null;
  maison: number | null;
}

export interface DvfDetails {
  score: number | null;
  score_prix: number | null;
  score_liq: number | null;
  prix_m2_median: number | null;
  tx_per_hab: number | null;
  nb_transactions: number | null;
  /** true si score_dvf est une imputation régionale/nationale (pas de données DVF réelles) */
  imputed?: boolean;
  imputed_method?: 'regional_median' | 'national_median';
  imputed_region?: string;
  imputed_value?: number;
}

export interface DpeDetails {
  score: number | null;
  pct_non_passoire: number | null;
  pct_ab: number | null;
  total_logements: number | null;
}

export interface RisquesDetails {
  score: number | null;
  tres_fort: number;
  fort: number;
  moyen: number;
  faible: number;
}

export interface BpeDetails {
  score: number | null;
  total_equip_essentiels: number | null;
}

export interface ScoreDetails {
  score: number;
  details: {
    dvf: DvfDetails;
    dpe: DpeDetails;
    risques: RisquesDetails;
    bpe: BpeDetails;
  };
}

// ─── Médianes nationales DVF (lazy cache) ────────────────────────────────────

let _cachedNationalMedians: NationalMedians | null = null;

export async function fetchNationalMedians(client: PrismaClient): Promise<NationalMedians> {
  if (_cachedNationalMedians) return _cachedNationalMedians;

  const rows = await client.$queryRaw<Array<{ type_local: string; national_median: string | null }>>`
    SELECT type_local,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_prix)::text AS national_median
    FROM (
      SELECT code_commune, type_local,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2) AS median_prix
      FROM immo_score.dvf_prix
      WHERE type_local IN ('Appartement', 'Maison')
        AND prix_m2 IS NOT NULL AND prix_m2 > 0
      GROUP BY code_commune, type_local
    ) sub
    GROUP BY type_local
  `;

  const appartRow = rows.find(r => r.type_local === 'Appartement');
  const maisonRow = rows.find(r => r.type_local === 'Maison');

  _cachedNationalMedians = {
    appart: appartRow?.national_median ? parseFloat(appartRow.national_median) : null,
    maison: maisonRow?.national_median ? parseFloat(maisonRow.national_median) : null,
  };

  return _cachedNationalMedians;
}

// ─── Requête DVF ──────────────────────────────────────────────────────────────

interface DvfPrixByTypeRow {
  type_local: string;
  prix_m2_median: string | null;
}

interface DvfLiqRow {
  tx_per_hab:      string | null;
  nb_transactions: string;
  population:      string | null;
}

async function fetchDvfDetails(
  communeId: string,
  client: PrismaClient,
  nationalMedians: NationalMedians,
  gaussianCoef: number = DVF_GAUSSIAN_COEF,
): Promise<DvfDetails> {
  const [prixRows, liqRows] = await Promise.all([
    client.$queryRaw<DvfPrixByTypeRow[]>`
      SELECT type_local,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2)::text AS prix_m2_median
      FROM immo_score.dvf_prix
      WHERE code_commune = ${communeId}
        AND type_local IN ('Appartement', 'Maison')
        AND prix_m2 IS NOT NULL AND prix_m2 > 0
      GROUP BY type_local
    `,
    client.$queryRaw<DvfLiqRow[]>`
      SELECT (COUNT(*)::float / NULLIF(c.population, 0))::text AS tx_per_hab,
             COUNT(*)::text                                     AS nb_transactions,
             c.population::text                                 AS population
      FROM immo_score.dvf_prix d
      JOIN immo_score.communes c ON c.code_insee = d.code_commune
      WHERE d.code_commune = ${communeId}
        AND d.prix_m2 IS NOT NULL AND d.prix_m2 > 0
        AND d.date_mutation >= NOW() - INTERVAL '3 years'
      GROUP BY c.population
    `,
  ]);

  const appartRow = prixRows.find(r => r.type_local === 'Appartement');
  const maisonRow = prixRows.find(r => r.type_local === 'Maison');

  if (!appartRow && !maisonRow) {
    return {
      score: null, score_prix: null, score_liq: null,
      prix_m2_median: null, tx_per_hab: null, nb_transactions: null,
    };
  }

  const prixAppart = appartRow?.prix_m2_median ? parseFloat(appartRow.prix_m2_median) : null;
  const prixMaison = maisonRow?.prix_m2_median ? parseFloat(maisonRow.prix_m2_median) : null;

  let prixCommune: number;
  let medianeRef: number;

  if (prixAppart != null && prixMaison != null) {
    prixCommune = (prixAppart + prixMaison) / 2;
    medianeRef  = ((nationalMedians.appart ?? prixAppart) + (nationalMedians.maison ?? prixMaison)) / 2;
  } else if (prixAppart != null) {
    prixCommune = prixAppart;
    medianeRef  = nationalMedians.appart ?? prixAppart;
  } else {
    prixCommune = prixMaison!;
    medianeRef  = nationalMedians.maison ?? prixMaison!;
  }

  // Gaussienne : communes proches de la médiane nationale → ~100 ; écart 100% → ~50 avec coef=0.7
  const delta     = medianeRef > 0 ? Math.abs(prixCommune - medianeRef) / medianeRef : 0;
  const scorePrix = round1(100 * Math.exp(-gaussianCoef * delta));

  const txPerHab  = liqRows.length > 0 && liqRows[0].tx_per_hab != null
    ? parseFloat(liqRows[0].tx_per_hab)
    : null;
  const nbTx      = liqRows.length > 0 ? parseInt(liqRows[0].nb_transactions) : 0;
  const population = liqRows.length > 0 && liqRows[0].population != null
    ? parseInt(liqRows[0].population)
    : 0;

  // Si tx_per_hab null (population=0 ou null) → signal liquidité absent, renormalisé sur prix uniquement.
  // Si nbTx < MIN_TX_RECENT ou population < MIN_POP_FOR_LIQ_RATIO → volume insuffisant, floor liquidité.
  // Évite que quelques ventes dans une commune rurale créent un ratio tx/pop artificiellement élevé.
  let scoreLiq: number | null;
  if (txPerHab == null) {
    scoreLiq = null;
  } else if (nbTx < MIN_TX_RECENT || population < MIN_POP_FOR_LIQ_RATIO) {
    scoreLiq = DVF_LIQ_FLOOR;
  } else {
    scoreLiq = round1(Math.max(DVF_LIQ_FLOOR, clamp(txPerHab / DVF_LIQ_FULL * 100, 0, 100)));
  }

  const score = scoreLiq != null
    ? round1(W_DVF.prix * scorePrix + W_DVF.liq * scoreLiq)
    : scorePrix;

  return {
    score,
    score_prix:      scorePrix,
    score_liq:       scoreLiq,
    prix_m2_median:  Math.round(prixCommune),
    tx_per_hab:      txPerHab,
    nb_transactions: nbTx,
  };
}

// ─── Requête DPE ──────────────────────────────────────────────────────────────

interface DpeRow {
  pct_non_passoire: string | null;
  pct_ab:           string | null;
  total_logements:  string | null;
}

async function fetchDpeDetails(
  communeId: string,
  client: PrismaClient,
): Promise<DpeDetails> {
  const rows = await client.$queryRaw<DpeRow[]>`
    SELECT
      (SUM(CASE WHEN classe_dpe IN ('A','B','C','D','E') THEN nb_logements ELSE 0 END)::float
        / NULLIF(SUM(nb_logements), 0) * 100)::text  AS pct_non_passoire,
      (SUM(CASE WHEN classe_dpe IN ('A','B') THEN nb_logements ELSE 0 END)::float
        / NULLIF(SUM(nb_logements), 0) * 100)::text  AS pct_ab,
      COALESCE(SUM(nb_logements), 0)::text            AS total_logements
    FROM immo_score.dpe_communes
    WHERE code_commune = ${communeId}
  `;

  const total = rows[0]?.total_logements ? parseInt(rows[0].total_logements) : 0;
  if (total === 0 || rows[0]?.pct_non_passoire == null) {
    return { score: null, pct_non_passoire: null, pct_ab: null, total_logements: null };
  }

  const pctNp = parseFloat(rows[0].pct_non_passoire);
  const pctAb = rows[0].pct_ab != null ? round1(parseFloat(rows[0].pct_ab)) : null;
  const score = round1(clamp((pctNp - DPE_NP_FLOOR) / (DPE_NP_CEIL - DPE_NP_FLOOR) * 100, 0, 100));

  return { score, pct_non_passoire: round1(pctNp), pct_ab: pctAb, total_logements: total };
}

// ─── Requête Risques ──────────────────────────────────────────────────────────

interface RisqueRow {
  niveau: NiveauRisque;
  cnt:    string;
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
    return { score: null, tres_fort: 0, fort: 0, moyen: 0, faible: 0 };
  }

  const counts = { tres_fort: 0, fort: 0, moyen: 0, faible: 0 };
  let malus = 0;

  for (const row of rows) {
    const cnt = parseInt(row.cnt);
    malus += MALUS[row.niveau] * cnt;
    if      (row.niveau === NiveauRisque.TRES_FORT) counts.tres_fort += cnt;
    else if (row.niveau === NiveauRisque.FORT)      counts.fort      += cnt;
    else if (row.niveau === NiveauRisque.MOYEN)     counts.moyen     += cnt;
    else if (row.niveau === NiveauRisque.FAIBLE)    counts.faible    += cnt;
  }

  const rawScore = 100 - malus;
  // Floor à 10 : cumul de risques très forts peut amener rawScore ≤ 0, ce qui
  // annulerait le score global en agrégation géométrique (0^w = 0 → global ≈ 0).
  const score = rawScore <= 0 ? 10 : rawScore;

  return { score, ...counts };
}

// ─── Requête BPE ──────────────────────────────────────────────────────────────

/**
 * Calcule le score BPE. Floor à 10 pour communes absentes du dataset BPE 2024
 * (~11 000 communes rurales non mesurées, distinct de "0 équipement").
 */
async function fetchBpeDetails(
  communeId: string,
  client: PrismaClient,
): Promise<BpeDetails> {
  const bpe = await client.bpeCommune.findUnique({
    where:  { code_commune: communeId },
    select: { total_equip_essentiels: true },
  });

  if (!bpe) return { score: 10, total_equip_essentiels: null };

  if (bpe.total_equip_essentiels === 0) return { score: 0, total_equip_essentiels: 0 };

  const score = round1(Math.min(100, (bpe.total_equip_essentiels / BPE_TOTAL) * 100));
  return { score, total_equip_essentiels: bpe.total_equip_essentiels };
}

// ─── Accessibilité financière (Median Multiple) ───────────────────────────────

export interface AccessibiliteDetails {
  score: number | null;
  median_multiple: number | null;
  prix_median_logement: number | null;
  prix_median_m2: number | null;
  revenu_median: number | null;
}

/** Surface proxy pour estimer le prix d'un logement médian à partir du prix m². */
const SURFACE_PROXY_M2 = 65;

/**
 * Goalpost inversé : MM=2 → 100, MM=10 → 0.
 * Un Median Multiple faible = logement accessible → score élevé.
 */
const MM_BEST  = 2;
const MM_WORST = 10;

/**
 * Calcule le sous-score "Accessibilité financière" basé sur le Median Multiple.
 *
 * Median Multiple = (prix_m2_médian × surface_proxy) / revenu_médian_UC
 * Goalpost inversé : MM=2 → 100, MM=10 → 0.
 */
export async function calculateAccessibiliteScore(
  communeId: string,
  client: PrismaClient = defaultClient,
): Promise<AccessibiliteDetails> {
  const [dvfRows, filosofiRow] = await Promise.all([
    client.$queryRaw<Array<{ prix_m2_median: string | null }>>`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY prix_m2)::text AS prix_m2_median
      FROM immo_score.dvf_prix
      WHERE code_commune = ${communeId}
        AND prix_m2 IS NOT NULL AND prix_m2 > 0
    `,
    client.$queryRaw<Array<{ revenu_median: string | null }>>`
      SELECT revenu_median::text
      FROM immo_score.insee_filosofi
      WHERE code_commune = ${communeId}
    `,
  ]);

  const prixM2Row     = dvfRows[0]?.prix_m2_median;
  const revenuRow     = filosofiRow[0]?.revenu_median;

  if (!prixM2Row || !revenuRow) {
    return { score: null, median_multiple: null, prix_median_logement: null, prix_median_m2: null, revenu_median: null };
  }

  const prixM2              = parseFloat(prixM2Row);
  const revenu              = parseFloat(revenuRow);
  const prixLogement        = Math.round(prixM2 * SURFACE_PROXY_M2);
  const medianMultiple      = round1(prixLogement / revenu);

  // Goalpost inversé : score = (MM_WORST - MM) / (MM_WORST - MM_BEST) × 100
  const score = round1(clamp((MM_WORST - medianMultiple) / (MM_WORST - MM_BEST) * 100, 0, 100));

  return {
    score,
    median_multiple:      medianMultiple,
    prix_median_logement: prixLogement,
    prix_median_m2:       Math.round(prixM2),
    revenu_median:        Math.round(revenu),
  };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

const defaultClient = new PrismaClient();

/**
 * Calcule le score composite (0-100) d'une commune française.
 *
 * @param communeId          Code INSEE de la commune (ex. "75056" pour Paris)
 * @param client             PrismaClient (optionnel)
 * @param nationalMedians    Médianes nationales DVF pré-calculées (lazy cache sinon)
 * @param dvfFallbackByRegion Map région → score DVF prix médian (imputation pour communes sans DVF)
 * @param dvfFallbackGlobal  Médiane nationale DVF prix (fallback ultime)
 * @param gaussianCoef       Coefficient gaussien DVF prix (défaut 0.7, modifiable pour audit)
 */
export async function calculateScore(
  communeId: string,
  client: PrismaClient = defaultClient,
  nationalMedians?: NationalMedians,
  dvfFallbackByRegion?: Map<string, number>,
  dvfFallbackGlobal?: number,
  gaussianCoef: number = DVF_GAUSSIAN_COEF,
): Promise<ScoreDetails | null> {
  const commune = await client.commune.findUnique({
    where:  { code_insee: communeId },
    select: { code_insee: true },
  });
  if (!commune) return null;

  const medians = nationalMedians ?? await fetchNationalMedians(client);

  const [dvfRaw, dpe, risques, bpe] = await Promise.all([
    fetchDvfDetails(communeId, client, medians, gaussianCoef),
    fetchDpeDetails(communeId, client),
    fetchRisquesDetails(communeId, client),
    fetchBpeDetails(communeId, client),
  ]);

  // Imputation DVF pour communes sans données (Alsace-Moselle, Mayotte)
  let dvf: DvfDetails = dvfRaw;
  if (dvf.score === null && (dvfFallbackByRegion != null || dvfFallbackGlobal != null)) {
    const region = getRegionFromCodeInsee(communeId);
    const imputedPrix = (region != null ? dvfFallbackByRegion?.get(region) : undefined)
      ?? dvfFallbackGlobal;

    if (imputedPrix != null) {
      const method: 'regional_median' | 'national_median' =
        region != null && dvfFallbackByRegion?.has(region)
          ? 'regional_median'
          : 'national_median';

      dvf = {
        score:           round1(W_DVF.prix * imputedPrix + W_DVF.liq * DVF_LIQ_FLOOR),
        score_prix:      round1(imputedPrix),
        score_liq:       DVF_LIQ_FLOOR,
        prix_m2_median:  null,
        tx_per_hab:      null,
        nb_transactions: null,
        imputed:         true,
        imputed_method:  method,
        imputed_region:  region ?? undefined,
        imputed_value:   round1(imputedPrix),
      };
    }
  }

  const dims: Array<{ score: number; weight: number }> = [];
  if (dvf.score     != null) dims.push({ score: dvf.score,     weight: W.dvf     });
  if (dpe.score     != null) dims.push({ score: dpe.score,     weight: W.dpe     });
  if (risques.score != null) dims.push({ score: risques.score, weight: W.risques });
  if (bpe.score     != null) dims.push({ score: bpe.score,     weight: W.bpe     });

  return {
    score:   geometricScore(dims),
    details: { dvf, dpe, risques, bpe },
  };
}
