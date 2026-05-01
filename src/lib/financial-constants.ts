// ─── Frais d'acquisition ───────────────────────────────────────────────────

/** 7.5% — droits de mutation + honoraires notaire, bien ancien (notaires.fr 2024) */
export const FRAIS_NOTAIRE_ANCIEN = 0.075;
/** 2.5% — VEFA / bien neuf, droits réduits (notaires.fr 2024) */
export const FRAIS_NOTAIRE_NEUF = 0.025;

// ─── Fiscalité locative ────────────────────────────────────────────────────

/** 17.2% — CSG 9.2% + CRDS 0.5% + PS 7.5% — CGI art. 1600-0C */
export const TAUX_PS = 0.172;
/** 30% — abattement forfaitaire revenus fonciers micro-foncier — CGI art. 32 */
export const ABATTEMENT_MICRO_FONCIER = 0.30;
/** 50% — abattement forfaitaire BIC micro, LMNP — CGI art. 50-0 */
export const ABATTEMENT_LMNP_MICRO_BIC = 0.50;
/** 15 000 €/an — seuil revenus fonciers bruts pour éligibilité micro-foncier — CGI art. 32 */
export const SEUIL_MICRO_FONCIER = 15_000;
/** 10 700 €/an — plafond déficit foncier imputable sur revenu global — CGI art. 156 */
export const PLAFOND_DEFICIT_FONCIER = 10_700;

// ─── Crédit immobilier ─────────────────────────────────────────────────────

/** 0.3%/an du capital emprunté — taux moyen marché assurance emprunteur (ACPR 2024) */
export const TAUX_ASSURANCE_EMPRUNTEUR = 0.003;

// ─── Charges propriétaire-bailleur ────────────────────────────────────────

/** 1 mois/an — taux vacance locative moyen France (FNAIM 2023) */
export const TAUX_VACANCE = 1 / 12;
/** 8% des loyers encaissés — commission gestion locative agence (usage marché) */
export const TAUX_GESTION_LOCATIVE = 0.08;
/** 0.5%/an du prix d'acquisition — provision entretien et réparations */
export const TAUX_ENTRETIEN = 0.005;
/** 20 €/m²/an — charges copropriété moyenne France (ANAH 2022) */
export const CHARGES_COPRO_M2_AN = 20;
