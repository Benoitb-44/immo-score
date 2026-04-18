/**
 * scoring.ts — v3
 *
 * Algorithme de score composite 0-100 par commune (ADR-IS-002, ADR-IS-005).
 *
 * Goalposts absolus :
 *   DVF prix   : [≤800 →100, ≥6000 →0] €/m² (inverse)
 *   DVF liq    : [0 →0, ≥0.05 →100] tx/hab
 *   DPE        : [≤40% →0, 100% →100] pct_non_passoire (logements ≤ classe E)
 *   Risques    : départ 100, malus MOYEN−5 / FORT−15 / TRES_FORT−20
 *   BPE        : totalEquipEssentiels / 30 × 100, capé à 100
 *
 * Pondérations v3 : DVF 45%, DPE 10%, Risques 20%, BPE 25%.
 * Agrégation géométrique pondérée — poids renormalisés sur dimensions présentes.
 * Dimensions manquantes → null (aucune imputation médiane).
 * Clip [1, 100] avant exponentiation pour éviter l'annihilation par zéro.
 */

import { PrismaClient, NiveauRisque } from '@prisma/client';
import { BPE_TOTAL } from './bpe-codes';

// ─── Goalposts ────────────────────────────────────────────────────────────────

const DVF_PRIX_BEST  = 800;   // ≤ → score 100
const DVF_PRIX_WORST = 6000;  // ≥ → score 0
const DVF_LIQ_FULL   = 0.05;  // ≥ → score 100
const DPE_NP_FLOOR   = 40;    // % non-passoire ≤ → score 0
const DPE_NP_CEIL    = 100;   // % non-passoire = → score 100

// ─── Pondérations v3 ──────────────────────────────────────────────────────────

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
    // Clip [1, 100] : un score de 0 ne doit pas annuler tout le produit
    const s = clamp(d.score, 1, 100);
    return p * Math.pow(s / 100, w);
  }, 1);
  return round1(product * 100);
}

// ─── Types publics ────────────────────────────────────────────────────────────

export interface DvfDetails {
  /** Score dimension DVF 0-100 (null = pas de données DVF pour cette commune) */
  score: number | null;
  /** Score sous-dimension prix (goalpost inverse, 0-100) */
  score_prix: number | null;
  /** Score sous-dimension liquidité (goalpost, 0-100) */
  score_liq: number | null;
  /** Prix m² médian observé (€) */
  prix_m2_median: number | null;
  /** Transactions par habitant */
  tx_per_hab: number | null;
  /** Nombre de transactions brutes */
  nb_transactions: number | null;
}

export interface DpeDetails {
  /** Score dimension DPE 0-100 (null = pas de données DPE) */
  score: number | null;
  /** % logements classés A, B, C, D ou E (non-passoires) */
  pct_non_passoire: number | null;
  /** % logements classés A ou B (conservé pour affichage) */
  pct_ab: number | null;
  /** Nombre total de logements avec DPE dans la commune */
  total_logements: number | null;
}

export interface RisquesDetails {
  /** Score dimension risques 0-100 (null = commune absente de Géorisques) */
  score: number | null;
  tres_fort: number;
  fort: number;
  moyen: number;
  faible: number;
}

export interface BpeDetails {
  /** Score dimension BPE 0-100 (absent du dataset → 10 ; présent 0 équipement → 0) */
  score: number | null;
  /** Nombre d'équipements essentiels présents sur 30 (null si absent du dataset) */
  total_equip_essentiels: number | null;
}

export interface ScoreDetails {
  /** Score composite final 0-100 (arrondi à 1 décimale) */
  score: number;
  details: {
    dvf: DvfDetails;
    dpe: DpeDetails;
    risques: RisquesDetails;
    bpe: BpeDetails;
  };
}

// ─── Requête DVF ──────────────────────────────────────────────────────────────

interface DvfRow {
  prix_m2_median: string | null;
  tx_per_hab:     string | null;
  nb_transactions: string | null;
}

async function fetchDvfDetails(
  communeId: string,
  client: PrismaClient,
): Promise<DvfDetails> {
  const rows = await client.$queryRaw<DvfRow[]>`
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.prix_m2)::text   AS prix_m2_median,
      (COUNT(*)::float / NULLIF(c.population, 0))::text               AS tx_per_hab,
      COUNT(*)::text                                                   AS nb_transactions
    FROM immo_score.dvf_prix d
    JOIN immo_score.communes c ON c.code_insee = d.code_commune
    WHERE d.code_commune = ${communeId}
      AND d.prix_m2 IS NOT NULL
      AND d.prix_m2 > 0
    GROUP BY c.population
  `;

  if (rows.length === 0 || rows[0].prix_m2_median == null) {
    return {
      score: null, score_prix: null, score_liq: null,
      prix_m2_median: null, tx_per_hab: null, nb_transactions: null,
    };
  }

  const prix    = parseFloat(rows[0].prix_m2_median);
  const txPerHab = rows[0].tx_per_hab != null ? parseFloat(rows[0].tx_per_hab) : null;
  const nbTx     = rows[0].nb_transactions != null ? parseInt(rows[0].nb_transactions) : null;

  const scorePrix = round1(
    clamp((DVF_PRIX_WORST - prix) / (DVF_PRIX_WORST - DVF_PRIX_BEST) * 100, 0, 100),
  );
  const scoreLiq = txPerHab != null
    ? round1(clamp(txPerHab / DVF_LIQ_FULL * 100, 0, 100))
    : null;

  // Si tx_per_hab est null (population absente ou 0), le signal liquidité est indisponible.
  // On renormalise DVF sur score_prix uniquement — le poids global DVF (0.45) reste inchangé.
  const score = scoreLiq != null
    ? round1(W_DVF.prix * scorePrix + W_DVF.liq * scoreLiq)
    : scorePrix;

  return {
    score,
    score_prix:      scorePrix,
    score_liq:       scoreLiq,
    prix_m2_median:  Math.round(prix),
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

  const score = round1(
    clamp((pctNp - DPE_NP_FLOOR) / (DPE_NP_CEIL - DPE_NP_FLOOR) * 100, 0, 100),
  );

  return {
    score,
    pct_non_passoire: round1(pctNp),
    pct_ab:           pctAb,
    total_logements:  total,
  };
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
    // Aucune entrée Géorisques = commune non couverte (pas "sans risque")
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

  return { score: Math.max(0, 100 - malus), ...counts };
}

// ─── Requête BPE ──────────────────────────────────────────────────────────────

/**
 * Calcule le score BPE d'une commune.
 * Formule : totalEquipEssentiels / BPE_TOTAL × 100, capé à 100.
 *
 * Cas absent du dataset BPE 2024 niveau commune : floor à 10.
 * Motif : ~11 000 communes rurales (31%) ne figurent pas dans le fichier BPE
 * à maille commune — cela ne signifie pas "zéro équipement" mais "non mesuré".
 * Un floor à 10 évite que 0^0.25 = 0 annule le score global en agrégation
 * géométrique. Cas distinct des communes présentes avec 0 équipement essentiel
 * (vrai absence locale, score 0 justifié, < 500 communes).
 */
async function fetchBpeDetails(
  communeId: string,
  client: PrismaClient,
): Promise<BpeDetails> {
  const bpe = await client.bpeCommune.findUnique({
    where:  { code_commune: communeId },
    select: { total_equip_essentiels: true },
  });

  if (!bpe) {
    // Commune absente du dataset BPE 2024 → présence minimale non mesurée
    return { score: 10, total_equip_essentiels: null };
  }

  if (bpe.total_equip_essentiels === 0) {
    // Présente dans BPE mais aucun des 30 équipements essentiels → vrai zéro
    return { score: 0, total_equip_essentiels: 0 };
  }

  const score = round1(Math.min(100, (bpe.total_equip_essentiels / BPE_TOTAL) * 100));
  return { score, total_equip_essentiels: bpe.total_equip_essentiels };
}

// ─── Fonction principale ──────────────────────────────────────────────────────

const defaultClient = new PrismaClient();

/**
 * Calcule le score composite (0-100) d'une commune française.
 *
 * @param communeId  Code INSEE de la commune (ex. "75056" pour Paris)
 * @param client     PrismaClient (optionnel, utilise le client par défaut)
 * @returns          ScoreDetails ou null si la commune n'existe pas
 */
export async function calculateScore(
  communeId: string,
  client: PrismaClient = defaultClient,
): Promise<ScoreDetails | null> {
  const commune = await client.commune.findUnique({
    where:  { code_insee: communeId },
    select: { code_insee: true },
  });
  if (!commune) return null;

  const [dvf, dpe, risques, bpe] = await Promise.all([
    fetchDvfDetails(communeId, client),
    fetchDpeDetails(communeId, client),
    fetchRisquesDetails(communeId, client),
    fetchBpeDetails(communeId, client),
  ]);

  // Seules les dimensions avec données participent au score (pas d'imputation)
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
